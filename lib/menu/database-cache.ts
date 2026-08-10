import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  OrderingDiscoveryDiagnostics,
  OrderingSource,
  RestaurantMenuResult,
} from "@/lib/menu/types";
import {
  hasReliableMealEstimate,
  summarizeTypicalMealPrices,
} from "@/lib/menu/meal-estimate";

const orderingSchemaVersion = 8;
// Kept only for reading the pre-split cache during the automatic migration.
export const menuSchemaVersion = 4;
const menuAttemptVersion = 15;
const rawMenuSchemaVersion = 1;
export const mealEstimatorVersion = 2;
const orderingSuccessLifetimeMs = 14 * 24 * 60 * 60 * 1000;
const orderingEmptyLifetimeMs = 5 * 60 * 1000;
const failureRetryMs = 3 * 60 * 60 * 1000;
const transientProviderFailureRetryMs = 5 * 60 * 1000;

export function isTransientProviderFailureReason(reason: string): boolean {
  return /(?:HTTP\s*429|too many requests|rate[ -]?limit|temporar(?:y|ily) unavailable)/i.test(
    reason,
  );
}

export function menuFailureRetryDelayMs(reason: string): number {
  return isTransientProviderFailureReason(reason)
    ? transientProviderFailureRetryMs
    : failureRetryMs;
}

export function isRestaurantCacheDisabled(): boolean {
  return /^(?:1|true|yes|on)$/i.test(
    process.env.RESTAURANT_CACHE_DISABLED?.trim() ?? "",
  );
}

export type OrderingDiscoveryCacheValue = {
  sources: OrderingSource[];
  websiteFallbackSources: OrderingSource[];
  warnings: string[];
  diagnostics: OrderingDiscoveryDiagnostics;
};

export type MenuCacheLookup =
  | { status: "success"; result: RestaurantMenuResult; storedAt: string }
  | { status: "recent_failure"; reason: string; retryAfter: string }
  | { status: "miss" };

export type SuccessfulMenuCacheValue = {
  result: RestaurantMenuResult;
  storedAt: string;
};

type CacheDatabaseGlobal = typeof globalThis & {
  restaurantCacheDatabase?: DatabaseSync;
};

function databasePath(): string {
  return process.env.RESTAURANT_CACHE_DB_PATH?.trim()
    || join(process.cwd(), ".data", "restaurant-cache.sqlite");
}

function database(): DatabaseSync {
  const cacheGlobal = globalThis as CacheDatabaseGlobal;
  if (cacheGlobal.restaurantCacheDatabase) return cacheGlobal.restaurantCacheDatabase;

  const path = databasePath();
  mkdirSync(dirname(path), { recursive: true });
  const nextDatabase = new DatabaseSync(path);
  nextDatabase.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS restaurant_ordering_cache (
      place_id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      stored_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS restaurant_menu_cache (
      place_id TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
      source_fingerprint TEXT NOT NULL,
      result_json TEXT,
      failure_reason TEXT,
      stored_at TEXT NOT NULL,
      retry_after TEXT,
      PRIMARY KEY (place_id, schema_version)
    );

    CREATE TABLE IF NOT EXISTS restaurant_raw_menu_cache (
      place_id TEXT PRIMARY KEY,
      raw_schema_version INTEGER NOT NULL,
      source_fingerprint TEXT NOT NULL,
      raw_revision TEXT NOT NULL,
      result_json TEXT NOT NULL,
      stored_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS restaurant_meal_estimate_cache (
      place_id TEXT NOT NULL,
      estimator_version INTEGER NOT NULL,
      raw_revision TEXT NOT NULL,
      price_summary_json TEXT NOT NULL,
      stored_at TEXT NOT NULL,
      PRIMARY KEY (place_id, estimator_version)
    );

    CREATE TABLE IF NOT EXISTS restaurant_menu_failure_cache (
      place_id TEXT PRIMARY KEY,
      attempt_version INTEGER NOT NULL,
      source_fingerprint TEXT NOT NULL,
      failure_reason TEXT NOT NULL,
      stored_at TEXT NOT NULL,
      retry_after TEXT NOT NULL
    );
  `);
  cacheGlobal.restaurantCacheDatabase = nextDatabase;
  return nextDatabase;
}

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function withCurrentPriceEstimate(
  result: RestaurantMenuResult,
): RestaurantMenuResult {
  return {
    ...result,
    priceSummary: summarizeTypicalMealPrices(result.items, {
      restaurantName: result.restaurantName,
      mealProfile: result.mealProfile,
      restaurantTags: result.restaurantTags,
    }),
  };
}

function rawMenuRevision(result: RestaurantMenuResult): string {
  return createHash("sha256")
    .update(JSON.stringify({
      restaurantName: result.restaurantName,
      mealProfile: result.mealProfile,
      restaurantTags: result.restaurantTags,
      items: result.items,
    }))
    .digest("hex");
}

function pricedItemCount(result: RestaurantMenuResult): number {
  return result.items.filter(
    (item) => typeof item.price === "number" && Number.isFinite(item.price),
  ).length;
}

function resultFromRawRow(
  placeId: string,
  row: Record<string, unknown>,
): SuccessfulMenuCacheValue | null {
  if (typeof row.stored_at !== "string") return null;
  const rawResult = parseJson<RestaurantMenuResult>(row.result_json);
  if (!rawResult || pricedItemCount(rawResult) === 0) return null;

  const revision = typeof row.raw_revision === "string"
    ? row.raw_revision
    : rawMenuRevision(rawResult);
  const estimateRow = database().prepare(`
    SELECT raw_revision, price_summary_json
    FROM restaurant_meal_estimate_cache
    WHERE place_id = ? AND estimator_version = ?
  `).get(placeId, mealEstimatorVersion) as Record<string, unknown> | undefined;
  const cachedSummary = estimateRow?.raw_revision === revision
    ? parseJson<RestaurantMenuResult["priceSummary"]>(estimateRow.price_summary_json)
    : null;
  const currentResult = cachedSummary
    ? { ...rawResult, priceSummary: cachedSummary }
    : withCurrentPriceEstimate(rawResult);

  if (!cachedSummary) {
    database().prepare(`
      INSERT INTO restaurant_meal_estimate_cache (
        place_id, estimator_version, raw_revision, price_summary_json, stored_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(place_id, estimator_version) DO UPDATE SET
        raw_revision = excluded.raw_revision,
        price_summary_json = excluded.price_summary_json,
        stored_at = excluded.stored_at
    `).run(
      placeId,
      mealEstimatorVersion,
      revision,
      JSON.stringify(currentResult.priceSummary),
      new Date().toISOString(),
    );
  }

  return { result: currentResult, storedAt: row.stored_at };
}

function readRawMenu(placeId: string): SuccessfulMenuCacheValue | null {
  const row = database().prepare(`
    SELECT raw_revision, result_json, stored_at
    FROM restaurant_raw_menu_cache
    WHERE place_id = ? AND raw_schema_version = ?
  `).get(placeId, rawMenuSchemaVersion) as Record<string, unknown> | undefined;
  return row ? resultFromRawRow(placeId, row) : null;
}

function storeRawMenu(
  placeId: string,
  sourceFingerprint: string,
  result: RestaurantMenuResult,
  storedAt = new Date().toISOString(),
): void {
  const revision = rawMenuRevision(result);
  database().prepare(`
    INSERT INTO restaurant_raw_menu_cache (
      place_id, raw_schema_version, source_fingerprint,
      raw_revision, result_json, stored_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(place_id) DO UPDATE SET
      raw_schema_version = excluded.raw_schema_version,
      source_fingerprint = excluded.source_fingerprint,
      raw_revision = excluded.raw_revision,
      result_json = excluded.result_json,
      stored_at = excluded.stored_at
  `).run(
    placeId,
    rawMenuSchemaVersion,
    sourceFingerprint,
    revision,
    JSON.stringify(result),
    storedAt,
  );
  database().prepare(`
    DELETE FROM restaurant_meal_estimate_cache
    WHERE place_id = ? AND raw_revision <> ?
  `).run(placeId, revision);
}

function migrateLegacyMenuSuccess(placeId: string): SuccessfulMenuCacheValue | null {
  const rows = database().prepare(`
    SELECT source_fingerprint, result_json, stored_at
    FROM restaurant_menu_cache
    WHERE place_id = ? AND status = 'success'
    ORDER BY schema_version DESC
  `).all(placeId) as Array<Record<string, unknown>>;

  for (const row of rows) {
    const result = parseJson<RestaurantMenuResult>(row.result_json);
    if (
      !result ||
      pricedItemCount(result) === 0 ||
      typeof row.stored_at !== "string"
    ) continue;
    storeRawMenu(
      placeId,
      typeof row.source_fingerprint === "string" ? row.source_fingerprint : "legacy",
      result,
      row.stored_at,
    );
    return readRawMenu(placeId);
  }
  return null;
}

function readOrMigrateRawMenu(placeId: string): SuccessfulMenuCacheValue | null {
  return readRawMenu(placeId) ?? migrateLegacyMenuSuccess(placeId);
}

function normalizeHostname(source: OrderingSource): string {
  try {
    return new URL(source.url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return source.provider;
  }
}

export function menuSourceFingerprint(sources: OrderingSource[]): string {
  const providers = sources
    .slice(0, 3)
    .map((source) => `${source.provider}:${normalizeHostname(source)}`)
    .join("|");
  return `attempt-v${menuAttemptVersion}|${providers}`;
}

export function readOrderingDiscoveryCache(
  placeId: string,
): OrderingDiscoveryCacheValue | null {
  if (isRestaurantCacheDisabled()) return null;
  const row = database().prepare(`
    SELECT schema_version, payload_json, expires_at
    FROM restaurant_ordering_cache
    WHERE place_id = ?
  `).get(placeId) as Record<string, unknown> | undefined;

  if (!row || row.schema_version !== orderingSchemaVersion) return null;
  if (typeof row.expires_at !== "string" || Date.parse(row.expires_at) <= Date.now()) {
    database().prepare("DELETE FROM restaurant_ordering_cache WHERE place_id = ?").run(placeId);
    return null;
  }
  return parseJson<OrderingDiscoveryCacheValue>(row.payload_json);
}

export function storeOrderingDiscoveryCache(
  placeId: string,
  value: OrderingDiscoveryCacheValue,
): void {
  if (isRestaurantCacheDisabled()) return;
  const now = Date.now();
  const lifetimeMs = value.sources.length > 0
    ? orderingSuccessLifetimeMs
    : orderingEmptyLifetimeMs;
  database().prepare(`
    INSERT INTO restaurant_ordering_cache (
      place_id, schema_version, payload_json, stored_at, expires_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(place_id) DO UPDATE SET
      schema_version = excluded.schema_version,
      payload_json = excluded.payload_json,
      stored_at = excluded.stored_at,
      expires_at = excluded.expires_at
  `).run(
    placeId,
    orderingSchemaVersion,
    JSON.stringify(value),
    new Date(now).toISOString(),
    new Date(now + lifetimeMs).toISOString(),
  );
}

export function readMenuCache(
  placeId: string,
  sources?: OrderingSource[],
  options: { ignoreRecentFailure?: boolean } = {},
): MenuCacheLookup {
  if (isRestaurantCacheDisabled()) return { status: "miss" };
  // Raw menu data is durable and is checked before any negative attempt cache.
  // This is what allows a v3 success to win over a newer v4 scrape failure.
  const rawMenu = readOrMigrateRawMenu(placeId);
  if (rawMenu && hasReliableMealEstimate(rawMenu.result.priceSummary)) {
    return { status: "success", ...rawMenu };
  }

  const currentSourceFingerprint = sources
    ? menuSourceFingerprint(sources)
    : null;
  let row = database().prepare(`
    SELECT source_fingerprint, failure_reason, stored_at, retry_after
    FROM restaurant_menu_failure_cache
    WHERE place_id = ? AND attempt_version = ?
  `).get(placeId, menuAttemptVersion) as Record<string, unknown> | undefined;

  // Import an active failure from the old combined table once. Success rows were
  // already handled above, so this migration cannot hide reusable raw menu data.
  if (!row) {
    const legacyFailure = database().prepare(`
      SELECT source_fingerprint, failure_reason, stored_at, retry_after
      FROM restaurant_menu_cache
      WHERE place_id = ? AND schema_version = ? AND status = 'failure'
    `).get(placeId, menuSchemaVersion) as Record<string, unknown> | undefined;
    if (
      legacyFailure &&
      typeof legacyFailure.source_fingerprint === "string" &&
      legacyFailure.source_fingerprint.startsWith(`attempt-v${menuAttemptVersion}|`) &&
      typeof legacyFailure.failure_reason === "string" &&
      typeof legacyFailure.stored_at === "string" &&
      typeof legacyFailure.retry_after === "string"
    ) {
      database().prepare(`
        INSERT OR REPLACE INTO restaurant_menu_failure_cache (
          place_id, attempt_version, source_fingerprint,
          failure_reason, stored_at, retry_after
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        placeId,
        menuAttemptVersion,
        legacyFailure.source_fingerprint,
        legacyFailure.failure_reason,
        legacyFailure.stored_at,
        legacyFailure.retry_after,
      );
      database().prepare(`
        DELETE FROM restaurant_menu_cache
        WHERE place_id = ? AND schema_version = ? AND status = 'failure'
      `).run(placeId, menuSchemaVersion);
      row = legacyFailure;
    }
  }

  if (!row) return { status: "miss" };
  const failureMatchesCurrentSources =
    currentSourceFingerprint === null ||
    row.source_fingerprint === currentSourceFingerprint;
  if (options.ignoreRecentFailure || !failureMatchesCurrentSources) {
    database().prepare(`
      DELETE FROM restaurant_menu_failure_cache WHERE place_id = ?
    `).run(placeId);
    database().prepare(`
      DELETE FROM restaurant_menu_cache
      WHERE place_id = ? AND schema_version = ? AND status = 'failure'
    `).run(placeId, menuSchemaVersion);
    return { status: "miss" };
  }
  if (
    typeof row.retry_after === "string" &&
    Date.parse(row.retry_after) > Date.now()
  ) {
    return {
      status: "recent_failure",
      reason: typeof row.failure_reason === "string"
        ? row.failure_reason
        : "Menu extraction recently failed.",
      retryAfter: row.retry_after,
    };
  }

  database().prepare(`
    DELETE FROM restaurant_menu_failure_cache WHERE place_id = ?
  `).run(placeId);
  return { status: "miss" };
}

export function readSuccessfulMenuCacheBatch(
  placeIds: string[],
): Map<string, SuccessfulMenuCacheValue> {
  if (isRestaurantCacheDisabled()) return new Map();
  const uniquePlaceIds = [...new Set(placeIds.filter(Boolean))].slice(0, 100);
  if (uniquePlaceIds.length === 0) return new Map();

  const results = new Map<string, SuccessfulMenuCacheValue>();
  for (const placeId of uniquePlaceIds) {
    const cached = readOrMigrateRawMenu(placeId);
    if (!cached || !hasReliableMealEstimate(cached.result.priceSummary)) continue;
    results.set(placeId, cached);
  }
  return results;
}

export function storeMenuSuccessOnce(
  placeId: string,
  sources: OrderingSource[],
  result: RestaurantMenuResult,
): void {
  if (isRestaurantCacheDisabled()) return;
  const existingRow = database().prepare(`
    SELECT result_json
    FROM restaurant_raw_menu_cache
    WHERE place_id = ? AND raw_schema_version = ?
  `).get(placeId, rawMenuSchemaVersion) as Record<string, unknown> | undefined;
  const existingResult = parseJson<RestaurantMenuResult>(existingRow?.result_json);
  const existingReliable = existingResult
    ? hasReliableMealEstimate(withCurrentPriceEstimate(existingResult).priceSummary)
    : false;
  const freshReliable = hasReliableMealEstimate(
    withCurrentPriceEstimate(result).priceSummary,
  );
  const shouldReplace =
    pricedItemCount(result) > 0 &&
    (!existingResult ||
      (!existingReliable && freshReliable) ||
      (!existingReliable && pricedItemCount(result) > pricedItemCount(existingResult)));

  if (shouldReplace) {
    storeRawMenu(placeId, menuSourceFingerprint(sources), result);
  }
  if (existingReliable || freshReliable) {
    database().prepare(`
      DELETE FROM restaurant_menu_failure_cache WHERE place_id = ?
    `).run(placeId);
  }
}

export function storeMenuFailure(
  placeId: string,
  sources: OrderingSource[],
  reason: string,
): void {
  if (isRestaurantCacheDisabled()) return;
  const now = Date.now();
  const retryDelayMs = menuFailureRetryDelayMs(reason);
  database().prepare(`
    INSERT INTO restaurant_menu_failure_cache (
      place_id, attempt_version, source_fingerprint,
      failure_reason, stored_at, retry_after
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(place_id) DO UPDATE SET
      attempt_version = excluded.attempt_version,
      source_fingerprint = excluded.source_fingerprint,
      failure_reason = excluded.failure_reason,
      stored_at = excluded.stored_at,
      retry_after = excluded.retry_after
  `).run(
    placeId,
    menuAttemptVersion,
    menuSourceFingerprint(sources),
    reason,
    new Date(now).toISOString(),
    new Date(now + retryDelayMs).toISOString(),
  );
}
