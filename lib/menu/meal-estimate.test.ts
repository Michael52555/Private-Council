import assert from "node:assert/strict";
import test from "node:test";
import {
  hasReliableMealEstimate,
  isMenuEstimatePlausibleAgainstGoogle,
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

test("recognizes entree-like names as single-person mains", () => {
  const summary = summarizeTypicalMealPrices([
    item("a", "Orange Chicken", 9),
    item("b", "Kung Pao Chicken", 11),
    item("c", "Broccoli Beef", 13),
    item("d", "Side of Rice", 3, "Sides"),
  ]);

  assert.equal(summary.basis, "filtered_menu_items");
  assert.equal(summary.sampleItemCount, 3);
  assert.equal(summary.median, 11);
  assert.equal(summary.mealPattern, "single_main");
  assert.equal(mealEstimateConfidence(summary), "high");
});

test("composes a main, side, and optional drink for a barbecue meal", () => {
  const summary = summarizeTypicalMealPrices(
    [
      item("brisket", "Smoked Brisket", 18, "Mains"),
      item("ribs", "BBQ Ribs", 22, "Mains"),
      item("chicken", "Half Chicken", 14, "Mains"),
      item("sandwich", "Pulled Pork Sandwich", 26, "Mains"),
      item("slaw", "Coleslaw", 4, "Sides"),
      item("beans", "Baked Beans", 6, "Sides"),
      item("cornbread", "Cornbread", 8, "Sides"),
      item("tea", "Iced Tea", 3, "Drinks"),
      item("lemonade", "Lemonade", 5, "Drinks"),
    ],
    { restaurantName: "Smoke Shop BBQ" },
  );

  assert.equal(summary.basis, "composed_basket");
  assert.equal(summary.mealPattern, "main_plus_sides");
  assert.equal(summary.lowerQuartile, 14);
  assert.equal(summary.median, 27.4);
  assert.equal(summary.upperQuartile, 33.75);
  assert.equal(mealEstimateConfidence(summary), "medium");
});

test("estimates two to three plates per person at a tapas restaurant", () => {
  const summary = summarizeTypicalMealPrices(
    [
      item("olives", "Marinated Olives", 7, "Tapas"),
      item("potatoes", "Patatas Bravas", 9, "Tapas"),
      item("shrimp", "Garlic Shrimp", 11, "Tapas"),
      item("octopus", "Grilled Octopus", 13, "Tapas"),
    ],
    { restaurantName: "Barcelona Tapas" },
  );

  assert.equal(summary.basis, "composed_basket");
  assert.equal(summary.mealPattern, "multiple_small_plates");
  assert.equal(summary.lowerQuartile, 14);
  assert.equal(summary.median, 25);
  assert.equal(summary.upperQuartile, 33);
  assert.equal(mealEstimateConfidence(summary), "low");
});

test("splits several shared dishes across a default party of two", () => {
  const summary = summarizeTypicalMealPrices(
    [
      item("fish", "Whole Fish", 30, "Mains"),
      item("chicken", "Chongqing Chicken", 22, "Mains"),
      item("beef", "Cumin Beef", 26, "Mains"),
      item("ribs", "Garlic Ribs", 18, "Mains"),
    ],
    { restaurantName: "Szechuan Impression" },
  );

  assert.equal(summary.mealPattern, "shared_dishes");
  assert.equal(summary.lowerQuartile, 18);
  assert.equal(summary.median, 30);
  assert.equal(summary.upperQuartile, 39);
  assert.equal(mealEstimateConfidence(summary), "low");
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

test("rejects menu estimates that are implausibly below a Google range", () => {
  const summary = summarizeTypicalMealPrices([
    item("a", "Chicken Sandwich", 5),
    item("b", "Fish Sandwich", 6),
    item("c", "Steak Sandwich", 8),
  ]);

  assert.equal(isMenuEstimatePlausibleAgainstGoogle(summary, 20, 50), false);
  assert.equal(isMenuEstimatePlausibleAgainstGoogle(summary, 5, 15), true);
});
