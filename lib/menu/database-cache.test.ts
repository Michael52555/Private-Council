import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { OrderingSource, RestaurantMenuResult } from "@/lib/menu/types";
import {
  menuSourceFingerprint,
  menuFailureRetryDelayMs,
  isTransientProviderFailureReason,
  readMenuCache,
  readSuccessfulMenuCacheBatch,
  storeMenuFailure,
  storeMenuSuccessOnce,
} from "@/lib/menu/database-cache";

process.env.RESTAURANT_CACHE_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "private-council-cache-test-")),
  "cache.sqlite",
);

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

test("keeps stale raw items but retries when they no longer yield a meal estimate", () => {
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

  assert.equal(readMenuCache("place-kiyo").status, "miss");
  assert.equal(readSuccessfulMenuCacheBatch(["place-kiyo"]).size, 0);

  storeMenuFailure(
    "place-kiyo",
    [orderingSource],
    "No alternative provider produced a reliable meal estimate.",
  );
  assert.equal(readMenuCache("place-kiyo").status, "recent_failure");

  const recoveredResult: RestaurantMenuResult = {
    ...staleResult,
    items: [18, 24, 30].map((price, index) => ({
      id: `complete-meal-${index}`,
      name: `Sushi Combination Meal ${index + 1}`,
      section: "Complete Meals",
      price,
      currency: "USD",
      sourceId: "alternative-source",
    })),
  };
  storeMenuSuccessOnce("place-kiyo", [orderingSource], recoveredResult);
  const recovered = readMenuCache("place-kiyo");
  assert.equal(recovered.status, "success");
  if (recovered.status === "success") {
    assert.equal(recovered.result.priceSummary.median, 24);
  }
});
