import assert from "node:assert/strict";
import test from "node:test";
import { FOOD_TYPE_OPTIONS } from "@/lib/planning-types";
import { googleSearchTypesForFoodPreferences } from "@/lib/restaurant-search-types";

test("maps UI food preferences to deduplicated Google search types", () => {
  assert.deepEqual(
    googleSearchTypesForFoodPreferences(["chinese", "noodles", "chinese"]),
    [
      "chinese_restaurant",
      "cantonese_restaurant",
      "chinese_noodle_restaurant",
      "dim_sum_restaurant",
      "noodle_shop",
      "ramen_restaurant",
    ],
  );
});

test("every UI food label can seed preference-aware candidate discovery", () => {
  for (const option of FOOD_TYPE_OPTIONS) {
    assert.ok(
      googleSearchTypesForFoodPreferences([option.value]).length > 0,
      `${option.value} should map to at least one Google place type`,
    );
  }
});
