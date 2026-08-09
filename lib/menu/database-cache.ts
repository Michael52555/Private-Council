import { mkdirSync } from "node:fs";
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

const orderingSchemaVersion = 5;
export const menuSchemaVersion = 2;
const menuAttemptVersion = 5;
const orderingSuccessLifetimeMs = 14 * 24 * 60 * 60 * 1000;
const orderingEmptyLifetimeMs = 5 * 60 * 1000;
const failureRetryMs = 3 * 60 * 60 * 1000;

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
    }),
  };
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
  const row = database().prepare(`
    SELECT status, source_fingerprint, result_json, failure_reason, stored_at, retry_after
    FROM restaurant_menu_cache
    WHERE place_id = ? AND schema_version = ?
  `).get(placeId, menuSchemaVersion) as Record<string, unknown> | undefined;

  if (!row) return { status: "miss" };
  const currentSourceFingerprint = sources
    ? menuSourceFingerprint(sources)
    : null;
  const failureMatchesCurrentSources =
    currentSourceFingerprint === null ||
    row.source_fingerprint === currentSourceFingerprint;
  if (row.status === "success") {
    const result = parseJson<RestaurantMenuResult>(row.result_json);
    if (result && typeof row.stored_at === "string") {
      const currentResult = withCurrentPriceEstimate(result);
      if (!hasReliableMealEstimate(currentResult.priceSummary)) {
        if (!failureMatchesCurrentSources) {
          database().prepare(`
            UPDATE restaurant_menu_cache
            SET failure_reason = NULL, retry_after = NULL
            WHERE place_id = ? AND schema_version = ? AND status = 'success'
          `).run(placeId, menuSchemaVersion);
          return { status: "miss" };
        }
        if (
          !options.ignoreRecentFailure &&
          typeof row.retry_after === "string" &&
          Date.parse(row.retry_after) > Date.now()
        ) {
          return {
            status: "recent_failure",
            reason: typeof row.failure_reason === "string"
              ? row.failure_reason
              : "The cached raw menu does not currently produce a reliable meal estimate.",
            retryAfter: row.retry_after,
          };
        }
        database().prepare(`
          UPDATE restaurant_menu_cache
          SET failure_reason = NULL, retry_after = NULL
          WHERE place_id = ? AND schema_version = ? AND status = 'success'
        `).run(placeId, menuSchemaVersion);
        return { status: "miss" };
      }
      return {
        status: "success",
        result: currentResult,
        storedAt: row.stored_at,
      };
    }
    return { status: "miss" };
  }
  if (row.status === "failure" && options.ignoreRecentFailure) {
    database().prepare(`
      DELETE FROM restaurant_menu_cache
      WHERE place_id = ? AND schema_version = ? AND status = 'failure'
    `).run(placeId, menuSchemaVersion);
    return { status: "miss" };
  }
  if (row.status === "failure" && !failureMatchesCurrentSources) {
    database().prepare(`
      DELETE FROM restaurant_menu_cache
      WHERE place_id = ? AND schema_version = ? AND status = 'failure'
    `).run(placeId, menuSchemaVersion);
    return { status: "miss" };
  }
  if (
    row.status === "failure"
    && typeof row.retry_after === "string"
    && Date.parse(row.retry_after) > Date.now()
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
    DELETE FROM restaurant_menu_cache
    WHERE place_id = ? AND schema_version = ? AND status = 'failure'
  `).run(placeId, menuSchemaVersion);
  return { status: "miss" };
}

export function readSuccessfulMenuCacheBatch(
  placeIds: string[],
): Map<string, SuccessfulMenuCacheValue> {
  if (isRestaurantCacheDisabled()) return new Map();
  const uniquePlaceIds = [...new Set(placeIds.filter(Boolean))].slice(0, 100);
  if (uniquePlaceIds.length === 0) return new Map();

  const placeholders = uniquePlaceIds.map(() => "?").join(", ");
  const rows = database().prepare(`
    SELECT place_id, result_json, stored_at
    FROM restaurant_menu_cache
    WHERE schema_version = ?
      AND status = 'success'
      AND place_id IN (${placeholders})
  `).all(menuSchemaVersion, ...uniquePlaceIds) as Array<Record<string, unknown>>;

  const results = new Map<string, SuccessfulMenuCacheValue>();
  for (const row of rows) {
    if (typeof row.place_id !== "string" || typeof row.stored_at !== "string") continue;
    const result = parseJson<RestaurantMenuResult>(row.result_json);
    if (!result) continue;
    const currentResult = withCurrentPriceEstimate(result);
    if (!hasReliableMealEstimate(currentResult.priceSummary)) continue;
    results.set(row.place_id, {
      result: currentResult,
      storedAt: row.stored_at,
    });
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
    FROM restaurant_menu_cache
    WHERE place_id = ? AND schema_version = ? AND status = 'success'
  `).get(placeId, menuSchemaVersion) as Record<string, unknown> | undefined;
  const existingResult = parseJson<RestaurantMenuResult>(existingRow?.result_json);
  if (
    existingResult &&
    hasReliableMealEstimate(withCurrentPriceEstimate(existingResult).priceSummary)
  ) {
    return;
  }

  database().prepare(`
    INSERT INTO restaurant_menu_cache (
      place_id, schema_version, status, source_fingerprint,
      result_json, failure_reason, stored_at, retry_after
    ) VALUES (?, ?, 'success', ?, ?, NULL, ?, NULL)
    ON CONFLICT(place_id, schema_version) DO UPDATE SET
      status = 'success',
      source_fingerprint = excluded.source_fingerprint,
      result_json = excluded.result_json,
      failure_reason = NULL,
      stored_at = excluded.stored_at,
      retry_after = NULL
  `).run(
    placeId,
    menuSchemaVersion,
    menuSourceFingerprint(sources),
    JSON.stringify(withCurrentPriceEstimate(result)),
    new Date().toISOString(),
  );
}

export function storeMenuFailure(
  placeId: string,
  sources: OrderingSource[],
  reason: string,
): void {
  if (isRestaurantCacheDisabled()) return;
  const now = Date.now();
  database().prepare(`
    INSERT INTO restaurant_menu_cache (
      place_id, schema_version, status, source_fingerprint,
      result_json, failure_reason, stored_at, retry_after
    ) VALUES (?, ?, 'failure', ?, NULL, ?, ?, ?)
    ON CONFLICT(place_id, schema_version) DO UPDATE SET
      source_fingerprint = excluded.source_fingerprint,
      failure_reason = excluded.failure_reason,
      stored_at = CASE
        WHEN restaurant_menu_cache.status = 'failure' THEN excluded.stored_at
        ELSE restaurant_menu_cache.stored_at
      END,
      retry_after = excluded.retry_after
  `).run(
    placeId,
    menuSchemaVersion,
    menuSourceFingerprint(sources),
    reason,
    new Date(now).toISOString(),
    new Date(now + failureRetryMs).toISOString(),
  );
}
