import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  parseRestaurantApiProfile,
  restaurantProfilePromptVersion,
  restaurantProfileSchemaVersion,
  type RestaurantApiProfile,
  type RestaurantProfileInput,
} from "@/lib/restaurant-profile";

const profileLifetimeMs = 30 * 24 * 60 * 60 * 1000;

type ProfileCacheDatabaseGlobal = typeof globalThis & {
  restaurantProfileCacheDatabase?: DatabaseSync;
};

function cacheDisabled(): boolean {
  return /^(?:1|true|yes|on)$/i.test(
    process.env.RESTAURANT_CACHE_DISABLED?.trim() ?? "",
  );
}

function databasePath(): string {
  return process.env.RESTAURANT_CACHE_DB_PATH?.trim()
    || join(process.cwd(), ".data", "restaurant-cache.sqlite");
}

function database(): DatabaseSync {
  const cacheGlobal = globalThis as ProfileCacheDatabaseGlobal;
  if (cacheGlobal.restaurantProfileCacheDatabase) {
    return cacheGlobal.restaurantProfileCacheDatabase;
  }

  const path = databasePath();
  mkdirSync(dirname(path), { recursive: true });
  const nextDatabase = new DatabaseSync(path);
  nextDatabase.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS restaurant_profile_cache (
      place_id TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      prompt_version INTEGER NOT NULL,
      model TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL,
      profile_json TEXT NOT NULL,
      stored_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (place_id, schema_version, prompt_version, model)
    );
  `);
  cacheGlobal.restaurantProfileCacheDatabase = nextDatabase;
  return nextDatabase;
}

export function restaurantProfileInputFingerprint(
  input: RestaurantProfileInput,
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      placeId: input.placeId,
      name: input.name.trim(),
      address: input.address.trim(),
      primaryType: input.primaryType?.trim() ?? null,
      placeTypes: [...new Set(input.placeTypes.map((value) => value.trim()))].sort(),
      rating: input.rating ?? null,
      userRatingCount: input.userRatingCount ?? null,
      websiteUri: input.websiteUri?.trim() ?? null,
    }))
    .digest("hex");
}

export function readRestaurantProfileCacheBatch(
  inputs: readonly RestaurantProfileInput[],
  model: string,
): Map<string, RestaurantApiProfile> {
  const results = new Map<string, RestaurantApiProfile>();
  if (cacheDisabled() || inputs.length === 0) return results;

  const statement = database().prepare(`
    SELECT input_fingerprint, profile_json, expires_at
    FROM restaurant_profile_cache
    WHERE place_id = ?
      AND schema_version = ?
      AND prompt_version = ?
      AND model = ?
  `);
  const now = Date.now();

  for (const input of inputs) {
    const row = statement.get(
      input.placeId,
      restaurantProfileSchemaVersion,
      restaurantProfilePromptVersion,
      model,
    ) as Record<string, unknown> | undefined;
    if (
      !row ||
      row.input_fingerprint !== restaurantProfileInputFingerprint(input) ||
      typeof row.expires_at !== "string" ||
      Date.parse(row.expires_at) <= now ||
      typeof row.profile_json !== "string"
    ) {
      continue;
    }

    try {
      const parsed = parseRestaurantApiProfile(
        JSON.parse(row.profile_json),
        new Set([input.placeId]),
      );
      if (parsed) results.set(input.placeId, parsed);
    } catch {
      // Corrupt or stale rows are ordinary cache misses.
    }
  }

  return results;
}

export function storeRestaurantProfileCacheBatch(
  inputs: readonly RestaurantProfileInput[],
  profiles: ReadonlyMap<string, RestaurantApiProfile>,
  model: string,
): void {
  if (cacheDisabled() || inputs.length === 0 || profiles.size === 0) return;
  const inputsByPlaceId = new Map(inputs.map((input) => [input.placeId, input]));
  const storedAt = new Date();
  const expiresAt = new Date(storedAt.getTime() + profileLifetimeMs);
  const statement = database().prepare(`
    INSERT INTO restaurant_profile_cache (
      place_id, schema_version, prompt_version, model,
      input_fingerprint, profile_json, stored_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(place_id, schema_version, prompt_version, model) DO UPDATE SET
      input_fingerprint = excluded.input_fingerprint,
      profile_json = excluded.profile_json,
      stored_at = excluded.stored_at,
      expires_at = excluded.expires_at
  `);

  for (const [placeId, profile] of profiles) {
    const input = inputsByPlaceId.get(placeId);
    if (!input) continue;
    statement.run(
      placeId,
      restaurantProfileSchemaVersion,
      restaurantProfilePromptVersion,
      model,
      restaurantProfileInputFingerprint(input),
      JSON.stringify(profile),
      storedAt.toISOString(),
      expiresAt.toISOString(),
    );
  }
}
