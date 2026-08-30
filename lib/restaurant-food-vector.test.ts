import assert from "node:assert/strict";
import test from "node:test";

import {
  activeFoodTypes,
  buildRestaurantFoodVector,
} from "@/lib/restaurant-food-vector";

test("builds the same fixed vector from Google primary and secondary types", () => {
  const vector = buildRestaurantFoodVector({
    primaryType: "korean_barbecue_restaurant",
    placeTypes: ["korean_restaurant", "restaurant", "food"],
  });

  assert.equal(vector.version, 1);
  assert.equal(vector.values.korean, 1);
  assert.equal(vector.values.barbecue, 1);
  assert.deepEqual(new Set(vector.knownFacets), new Set(["cuisine", "style"]));
});

test("keeps a category separate from an unknown country cuisine", () => {
  const vector = buildRestaurantFoodVector({
    primaryType: "hot_pot_restaurant",
    placeTypes: ["restaurant", "food"],
  });

  assert.deepEqual(activeFoodTypes(vector), ["hot_pot"]);
  assert.deepEqual(vector.knownFacets, ["style"]);
  assert.equal(vector.values.chinese, 0);
});

test("leaves generic Google restaurant types unknown", () => {
  const vector = buildRestaurantFoodVector({
    primaryType: "restaurant",
    placeTypes: ["food", "point_of_interest", "establishment"],
  });

  assert.deepEqual(activeFoodTypes(vector), []);
  assert.deepEqual(vector.knownFacets, []);
});
