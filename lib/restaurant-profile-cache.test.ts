import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type {
  RestaurantApiProfile,
  RestaurantProfileInput,
} from "@/lib/restaurant-profile";
import {
  readRestaurantProfileCacheBatch,
  restaurantProfileInputFingerprint,
  storeRestaurantProfileCacheBatch,
} from "@/lib/restaurant-profile-cache";

process.env.RESTAURANT_CACHE_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "private-council-profile-cache-test-")),
  "cache.sqlite",
);

const input: RestaurantProfileInput = {
  placeId: "place-cache",
  name: "Cache Cafe",
  address: "123 Main St",
  primaryType: "cafe",
  placeTypes: ["food", "cafe"],
};
const profile: RestaurantApiProfile = {
  placeId: input.placeId,
  foodTypes: ["cafe_bakery"],
  typeConfidence: "high",
  estimatedPriceMin: 10,
  estimatedPriceMax: 24,
  priceConfidence: "medium",
};

test("profile fingerprints are stable across Google type ordering", () => {
  assert.equal(
    restaurantProfileInputFingerprint(input),
    restaurantProfileInputFingerprint({
      ...input,
      placeTypes: ["cafe", "food", "cafe"],
    }),
  );
});

test("profile cache keys include model and invalidate changed restaurant metadata", () => {
  storeRestaurantProfileCacheBatch(
    [input],
    new Map([[input.placeId, profile]]),
    "model-a",
  );

  assert.deepEqual(
    readRestaurantProfileCacheBatch([input], "model-a").get(input.placeId),
    profile,
  );
  assert.equal(readRestaurantProfileCacheBatch([input], "model-b").size, 0);
  assert.equal(readRestaurantProfileCacheBatch([{
    ...input,
    name: "Renamed Cafe",
  }], "model-a").size, 0);
});

test("restaurant cache debugging bypasses profile reads and writes", () => {
  process.env.RESTAURANT_CACHE_DISABLED = "1";
  try {
    storeRestaurantProfileCacheBatch(
      [{ ...input, placeId: "disabled-place" }],
      new Map([["disabled-place", { ...profile, placeId: "disabled-place" }]]),
      "model-a",
    );
    assert.equal(
      readRestaurantProfileCacheBatch(
        [{ ...input, placeId: "disabled-place" }],
        "model-a",
      ).size,
      0,
    );
  } finally {
    delete process.env.RESTAURANT_CACHE_DISABLED;
  }
});
