import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { OrderingSource, RestaurantMenuResult } from "@/lib/menu/types";
import {
  mealEstimatorVersion,
  menuSourceFingerprint,
  menuFailureRetryDelayMs,
  isTransientProviderFailureReason,
  readMenuCache,
  readSuccessfulMenuCacheBatch,
  storeMenuFailure,
  storeMenuSuccessOnce,
} from "@/lib/menu/database-cache";

const cachePath = join(
  mkdtempSync(join(tmpdir(), "private-council-cache-test-")),
  "cache.sqlite",
);
process.env.RESTAURANT_CACHE_DB_PATH = cachePath;

function source(url: string, provider: OrderingSource["provider"]): OrderingSource {
  return {
    id: url,
    provider,
    label: provider,
    url,
    fulfillment: "pickup",
    discoveredFrom: "google_maps",
  };
}

function bowlResult(placeId: string, prices: number[]): RestaurantMenuResult {
  return {
    placeId,
    restaurantName: "Legacy Bowl Test",
    menus: [],
    items: prices.map((price, index) => ({
      id: `${placeId}-bowl-${index}`,
      name: `Chicken Bowl ${index + 1}`,
      section: "Bowls",
      price,
      currency: "USD",
      sourceId: "legacy-source",
    })),
    priceSummary: {
      minimum: prices[0] ?? null,
      maximum: prices.at(-1) ?? null,
      lowerQuartile: prices[0] ?? null,
      upperQuartile: prices.at(-1) ?? null,
      median: prices[Math.floor(prices.length / 2)] ?? null,
      currency: "USD",
      basis: "filtered_menu_items",
      sampleItemCount: prices.length,
      excludedItemCount: 0,
      sampleItemIds: [],
    },
  };
}

test("menu source fingerprint ignores provider tracking parameters", () => {
  const first = source("https://www.doordash.com/store/123?utm_source=google", "doordash");
  const second = source("https://doordash.com/store/123?different=token", "doordash");
  assert.equal(menuSourceFingerprint([first]), menuSourceFingerprint([second]));
});

test("menu source fingerprint records provider changes for diagnostics", () => {
  const doorDash = source("https://doordash.com/store/123", "doordash");
  const toast = source("https://order.toasttab.com/online/store", "toast");
  assert.notEqual(menuSourceFingerprint([doorDash]), menuSourceFingerprint([toast]));
});

test("invalidates a negative menu cache when the provider inputs change", () => {
  const doorDash = source("https://doordash.com/store/negative", "doordash");
  const toast = source("https://order.toasttab.com/online/negative", "toast");

  storeMenuFailure("place-provider-change", [doorDash], "DoorDash was blocked.");
  assert.equal(
    readMenuCache("place-provider-change", [doorDash]).status,
    "recent_failure",
  );
  assert.equal(
    readMenuCache("place-provider-change", [toast]).status,
    "miss",
  );
});

test("allows an explicit retry to bypass an unchanged negative menu cache", () => {
  const doorDash = source("https://doordash.com/store/manual-retry", "doordash");

  storeMenuFailure("place-manual-retry", [doorDash], "DoorDash was blocked.");
  assert.equal(
    readMenuCache("place-manual-retry", [doorDash]).status,
    "recent_failure",
  );
  assert.equal(
    readMenuCache("place-manual-retry", [doorDash], {
      ignoreRecentFailure: true,
    }).status,
    "miss",
  );
});

test("uses a short cooldown for provider rate limits", () => {
  assert.equal(isTransientProviderFailureReason("Grubhub returned HTTP 429."), true);
  assert.equal(isTransientProviderFailureReason("No reliable prices were found."), false);
  assert.equal(menuFailureRetryDelayMs("HTTP 429"), 5 * 60 * 1000);
  assert.equal(menuFailureRetryDelayMs("No reliable prices were found."), 3 * 60 * 60 * 1000);
});

test("bypasses restaurant cache reads and writes when debugging is enabled", () => {
  const doorDash = source("https://doordash.com/store/no-cache", "doordash");
  process.env.RESTAURANT_CACHE_DISABLED = "1";
  try {
    storeMenuFailure("place-no-cache", [doorDash], "Should not be stored.");
    assert.equal(readMenuCache("place-no-cache", [doorDash]).status, "miss");
    assert.equal(readSuccessfulMenuCacheBatch(["place-no-cache"]).size, 0);
  } finally {
    delete process.env.RESTAURANT_CACHE_DISABLED;
  }
});

test("the central database keeps the first reliable menu result", () => {
  const orderingSource = source("https://doordash.com/store/123", "doordash");
  const result = (median: number): RestaurantMenuResult => ({
    placeId: "place-first-result",
    restaurantName: "Cache Test",
    menus: [],
    items: [median - 1, median, median + 1].map((price, index) => ({
      id: `meal-${median}-${index}`,
      name: `Chicken Bowl ${index + 1}`,
      section: "Meals",
      price,
      currency: "USD",
      sourceId: "source",
    })),
    priceSummary: {
      minimum: median,
      maximum: median,
      lowerQuartile: median,
      upperQuartile: median,
      median,
      currency: "USD",
      basis: "filtered_menu_items",
      sampleItemCount: 3,
      excludedItemCount: 0,
      sampleItemIds: [],
    },
  });

  storeMenuSuccessOnce("place-first-result", [orderingSource], result(12));
  storeMenuSuccessOnce("place-first-result", [orderingSource], result(99));

  const cached = readMenuCache("place-first-result");
  assert.equal(cached.status, "success");
  if (cached.status === "success") {
    assert.equal(cached.result.priceSummary.median, 12);
  }

  const batch = readSuccessfulMenuCacheBatch(["place-first-result", "missing-place"]);
  assert.equal(batch.size, 1);
  assert.equal(batch.get("place-first-result")?.result.priceSummary.median, 12);
});

test("recomputes cached unit-item menus with the current basket estimator", () => {
  const orderingSource = source("https://doordash.com/store/kiyo", "doordash");
  const staleResult: RestaurantMenuResult = {
    placeId: "place-kiyo",
    restaurantName: "Kiyo Sushi & Sake",
    menus: [],
    items: [
      { id: "salmon", name: "Salmon Nigiri", section: "Nigiri", price: 3, currency: "USD", sourceId: "source" },
      { id: "tuna", name: "Tuna Nigiri", section: "Nigiri", price: 3.5, currency: "USD", sourceId: "source" },
      { id: "yellowtail", name: "Yellowtail Nigiri", section: "Nigiri", price: 4, currency: "USD", sourceId: "source" },
      { id: "hand-roll", name: "Spicy Tuna Hand Roll", section: "Hand Rolls", price: 7.7, currency: "USD", sourceId: "source" },
    ],
    priceSummary: {
      minimum: 3,
      maximum: 7.7,
      lowerQuartile: 3,
      upperQuartile: 7.7,
      median: 3.75,
      currency: "USD",
      basis: "filtered_menu_items",
      sampleItemCount: 4,
      excludedItemCount: 0,
      sampleItemIds: ["salmon", "tuna", "yellowtail", "hand-roll"],
    },
  };

  storeMenuSuccessOnce("place-kiyo", [orderingSource], staleResult);

  const cached = readMenuCache("place-kiyo");
  assert.equal(cached.status, "success");
  if (cached.status === "success") {
    assert.equal(cached.result.priceSummary.mealPattern, "unit_items");
    assert.equal(cached.result.priceSummary.median, 18.75);
  }
  assert.equal(readSuccessfulMenuCacheBatch(["place-kiyo"]).size, 1);
});

test("migrates an older successful raw menu before honoring a newer failure", () => {
  // Initialize the schema, then emulate the exact regression: v3 succeeded,
  // while a v4 cold scrape produced a negative cache entry.
  readMenuCache("schema-initializer");
  const legacyResult = bowlResult("place-legacy-success", [12, 14, 16]);
  const db = new DatabaseSync(cachePath);
  const now = new Date();
  db.prepare(`
    INSERT INTO restaurant_menu_cache (
      place_id, schema_version, status, source_fingerprint,
      result_json, failure_reason, stored_at, retry_after
    ) VALUES (?, 3, 'success', ?, ?, NULL, ?, NULL)
  `).run(
    "place-legacy-success",
    "attempt-v8|grubhub:grubhub.com",
    JSON.stringify(legacyResult),
    now.toISOString(),
  );
  db.prepare(`
    INSERT INTO restaurant_menu_cache (
      place_id, schema_version, status, source_fingerprint,
      result_json, failure_reason, stored_at, retry_after
    ) VALUES (?, 4, 'failure', ?, NULL, ?, ?, ?)
  `).run(
    "place-legacy-success",
    "attempt-v9|grubhub:grubhub.com",
    "Grubhub temporarily rate-limited menu extraction (HTTP 429).",
    now.toISOString(),
    new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
  );
  db.close();

  const grubhub = source("https://grubhub.com/restaurant/legacy", "grubhub");
  const cached = readMenuCache("place-legacy-success", [grubhub]);
  assert.equal(cached.status, "success");
  if (cached.status === "success") {
    assert.equal(cached.result.priceSummary.median, 14);
  }

  const verificationDb = new DatabaseSync(cachePath);
  const rawRow = verificationDb.prepare(`
    SELECT raw_schema_version FROM restaurant_raw_menu_cache WHERE place_id = ?
  `).get("place-legacy-success") as Record<string, unknown> | undefined;
  const estimateRow = verificationDb.prepare(`
    SELECT estimator_version FROM restaurant_meal_estimate_cache WHERE place_id = ?
  `).get("place-legacy-success") as Record<string, unknown> | undefined;
  verificationDb.close();
  assert.equal(rawRow?.raw_schema_version, 1);
  assert.equal(estimateRow?.estimator_version, mealEstimatorVersion);
  assert.equal(readSuccessfulMenuCacheBatch(["place-legacy-success"]).size, 1);
});

test("keeps priced raw facts even before they yield a reliable estimate", () => {
  const grubhub = source("https://grubhub.com/restaurant/future", "grubhub");
  storeMenuSuccessOnce(
    "place-future-estimator",
    [grubhub],
    bowlResult("place-future-estimator", [13]),
  );
  assert.equal(readMenuCache("place-future-estimator", [grubhub]).status, "miss");

  const db = new DatabaseSync(cachePath);
  const rawRow = db.prepare(`
    SELECT result_json FROM restaurant_raw_menu_cache WHERE place_id = ?
  `).get("place-future-estimator") as Record<string, unknown> | undefined;
  db.close();
  assert.ok(rawRow?.result_json);

  storeMenuSuccessOnce(
    "place-future-estimator",
    [grubhub],
    bowlResult("place-future-estimator", [13, 15, 17]),
  );
  assert.equal(readMenuCache("place-future-estimator", [grubhub]).status, "success");
});
