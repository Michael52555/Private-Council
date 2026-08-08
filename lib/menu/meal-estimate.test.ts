import assert from "node:assert/strict";
import test from "node:test";
import {
  hasReliableMealEstimate,
  mealEstimateConfidence,
  summarizeTypicalMealPrices,
} from "@/lib/menu/meal-estimate";
import type { MenuItem } from "@/lib/menu/types";

function item(id: string, name: string, price: number, section?: string): MenuItem {
  return { id, name, price, section, currency: "USD", sourceId: "source" };
}

test("prefers explicit meals and combos over sauces, drinks, and sides", () => {
  const summary = summarizeTypicalMealPrices([
    item("sauce", "Fire Sauce", 0.25, "Sauces"),
    item("drink", "Medium Soda", 2.49, "Drinks"),
    item("side", "Nacho Fries", 3.49, "Sides"),
    item("combo-1", "Taco Combo Meal", 8.99, "Combos"),
    item("combo-2", "Burrito Box", 10.99, "Combos"),
    item("combo-3", "Chicken Bowl", 12.99, "Meals"),
    item("family", "Family Meal for 4", 39.99, "Meals"),
  ]);

  assert.equal(summary.basis, "explicit_meals");
  assert.equal(summary.sampleItemCount, 3);
  assert.equal(summary.lowerQuartile, 8.99);
  assert.equal(summary.upperQuartile, 12.99);
  assert.equal(summary.median, 10.99);
  assert.equal(summary.excludedItemCount, 4);
  assert.equal(mealEstimateConfidence(summary), "high");
});

test("falls back to ordinary non-accessory menu items when meal labels are absent", () => {
  const summary = summarizeTypicalMealPrices([
    item("a", "Orange Chicken", 9),
    item("b", "Kung Pao Chicken", 11),
    item("c", "Broccoli Beef", 13),
    item("d", "Side of Rice", 3, "Sides"),
  ]);

  assert.equal(summary.basis, "filtered_menu_items");
  assert.equal(summary.sampleItemCount, 3);
  assert.equal(summary.median, 11);
  assert.equal(mealEstimateConfidence(summary), "medium");
});

test("rejects unit-priced sushi pieces as a per-person meal estimate", () => {
  const summary = summarizeTypicalMealPrices(
    [
      item("salmon", "Salmon Nigiri", 3, "Nigiri"),
      item("tuna", "Tuna Nigiri", 3.5, "Nigiri"),
      item("yellowtail", "Yellowtail Nigiri", 4, "Nigiri"),
      item("hand-roll", "Spicy Tuna Hand Roll", 7.7, "Hand Rolls"),
      item("sashimi", "Salmon Sashimi", 6.5, "Sashimi"),
    ],
    { restaurantName: "Kiyo Sushi & Sake" },
  );

  assert.equal(summary.basis, "none");
  assert.equal(summary.sampleItemCount, 0);
  assert.equal(summary.median, null);
  assert.equal(summary.excludedItemCount, 5);
  assert.equal(hasReliableMealEstimate(summary), false);
});

test("accepts complete meals from a sushi restaurant", () => {
  const summary = summarizeTypicalMealPrices(
    [
      item("salmon", "Salmon Nigiri", 3, "Nigiri"),
      item("lunch", "Sushi Lunch Special", 18, "Lunch Specials"),
      item("bento", "Sashimi Bento", 24, "Dinner"),
      item("combo", "Chef Sushi Combination", 30, "Combinations"),
    ],
    { restaurantName: "Kiyo Sushi & Sake" },
  );

  assert.equal(summary.basis, "explicit_meals");
  assert.equal(summary.sampleItemCount, 3);
  assert.equal(summary.lowerQuartile, 18);
  assert.equal(summary.upperQuartile, 30);
  assert.equal(summary.median, 24);
  assert.equal(mealEstimateConfidence(summary), "high");
});
