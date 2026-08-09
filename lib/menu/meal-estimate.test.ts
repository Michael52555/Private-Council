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

test("prefers explicit fast-food combos over sauces, drinks, and sides", () => {
  const summary = summarizeTypicalMealPrices(
    [
      item("sauce", "Fire Sauce", 0.25, "Sauces"),
      item("drink", "Medium Soda", 2.49, "Drinks"),
      item("side", "Nacho Fries", 3.49, "Sides"),
      item("combo-1", "Taco Combo Meal", 8.99, "Combos"),
      item("combo-2", "Burrito Box", 10.99, "Combos"),
      item("combo-3", "Chicken Bowl Meal", 12.99, "Meals"),
      item("family", "Family Meal for 4", 39.99, "Meals"),
    ],
    { mealProfile: "fast_food" },
  );

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

  assert.equal(summary.basis, "composed_basket");
  assert.equal(summary.sampleItemCount, 4);
  assert.equal(summary.lowerQuartile, 12);
  assert.equal(summary.median, 14);
  assert.equal(summary.upperQuartile, 16);
  assert.equal(summary.mealPattern, "main_plus_sides");
  assert.equal(mealEstimateConfidence(summary), "medium");
});

test("composes one sit-down main, one side, and one drink", () => {
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
    { restaurantName: "Smoke Shop BBQ", mealProfile: "sit_down" },
  );

  assert.equal(summary.basis, "composed_basket");
  assert.equal(summary.mealPattern, "main_plus_sides");
  assert.equal(summary.lowerQuartile, 21);
  assert.equal(summary.median, 30);
  assert.equal(summary.upperQuartile, 35);
  assert.equal(mealEstimateConfidence(summary), "medium");
});

test("does not invent a price for unsupported sit-down small plates", () => {
  const summary = summarizeTypicalMealPrices(
    [
      item("olives", "Marinated Olives", 7, "Tapas"),
      item("potatoes", "Patatas Bravas", 9, "Tapas"),
      item("shrimp", "Garlic Shrimp", 11, "Tapas"),
      item("octopus", "Grilled Octopus", 13, "Tapas"),
    ],
    { restaurantName: "Barcelona Tapas", mealProfile: "sit_down" },
  );

  assert.equal(summary.basis, "none");
  assert.equal(summary.median, null);
  assert.equal(hasReliableMealEstimate(summary), false);
});

test("uses main-entry prices for a sit-down restaurant without sides or drinks", () => {
  const summary = summarizeTypicalMealPrices(
    [
      item("fish", "Whole Fish", 30, "Mains"),
      item("chicken", "Chongqing Chicken", 22, "Mains"),
      item("beef", "Cumin Beef", 26, "Mains"),
      item("ribs", "Garlic Ribs", 18, "Mains"),
    ],
    { restaurantName: "Szechuan Impression", mealProfile: "sit_down" },
  );

  assert.equal(summary.mealPattern, "single_main");
  assert.equal(summary.lowerQuartile, 18);
  assert.equal(summary.median, 24);
  assert.equal(summary.upperQuartile, 26);
  assert.equal(mealEstimateConfidence(summary), "high");
});

test("builds a fast-food meal from mains, a side, and a drink", () => {
  const summary = summarizeTypicalMealPrices(
    [
      item("spicy", "Spicy Deluxe Sandwich", 10.25),
      item("classic", "Chicken Sandwich", 8.45),
      item("nuggets", "Chicken Nuggets", 8.55),
      item("fries", "Waffle Potato Fries", 4.49, "Sides"),
      item("coke", "Coca-Cola", 3, "Drinks"),
    ],
    { restaurantName: "Chick-fil-A", mealProfile: "fast_food" },
  );

  assert.equal(summary.mealPattern, "main_plus_sides");
  assert.equal(summary.lowerQuartile, 15.94);
  assert.equal(summary.median, 16.84);
  assert.equal(summary.upperQuartile, 17.74);
  assert.equal(summary.sampleItemCount, 4);
  assert.equal(mealEstimateConfidence(summary), "medium");
});

test("uses branded Grubhub Best Sellers as fast-food mains", () => {
  const summary = summarizeTypicalMealPrices(
    [
      item("sub-1", "The Philly", 12.49, "Best Sellers"),
      item("sub-2", "The Outlaw", 11.99, "Best Sellers"),
      item("sub-3", "The Monster", 13.49, "Best Sellers"),
      item("sub-4", "Titan Turkey", 10.99, "Best Sellers"),
    ],
    { restaurantName: "Subway", mealProfile: "fast_food" },
  );

  assert.equal(summary.basis, "filtered_menu_items");
  assert.equal(summary.mealPattern, "single_main");
  assert.equal(summary.sampleItemCount, 4);
  assert.equal(summary.lowerQuartile, 10.99);
  assert.equal(summary.median, 12.24);
  assert.equal(summary.upperQuartile, 12.49);
  assert.equal(mealEstimateConfidence(summary), "medium");
});

test("does not estimate a meal from fewer than three unknown featured products", () => {
  const summary = summarizeTypicalMealPrices(
    [
      item("unknown-1", "House Favorite", 4.99, "Best Sellers"),
      item("unknown-2", "Signature Original", 6.99, "Best Sellers"),
      item("drink", "Coca-Cola", 2.99, "Best Sellers"),
    ],
    { restaurantName: "Example Fast Food", mealProfile: "fast_food" },
  );

  assert.equal(summary.basis, "none");
  assert.equal(summary.median, null);
});

test("does not mistake individual Taco Bell tacos for a complete meal", () => {
  const summary = summarizeTypicalMealPrices(
    [
      item("taco-1", "Cheesy Toasted Taco", 1.99),
      item("taco-2", "Crunchy Taco", 2.49),
      item("taco-3", "Soft Taco", 2.69),
      item("drink", "Pepsi", 2.99),
    ],
    { restaurantName: "Taco Bell", mealProfile: "fast_food" },
  );

  assert.equal(summary.basis, "none");
  assert.equal(summary.median, null);
  assert.equal(hasReliableMealEstimate(summary), false);
});

test("accepts full fast-food bowls and burritos without adding unrelated items", () => {
  const summary = summarizeTypicalMealPrices(
    [
      item("bowl-1", "Chicken Burrito Bowl", 11.5),
      item("bowl-2", "Steak Burrito Bowl", 13.25),
      item("burrito", "Carnitas Burrito", 12.75),
      item("salad", "Chicken Salad", 12.25),
      item("chips", "Chips", 2.5, "Sides"),
    ],
    { restaurantName: "Chipotle Mexican Grill", mealProfile: "fast_food" },
  );

  assert.equal(summary.mealPattern, "main_plus_sides");
  assert.equal(summary.lowerQuartile, 14);
  assert.equal(summary.median, 15);
  assert.equal(summary.upperQuartile, 15.25);
  assert.equal(summary.sampleItemCount, 5);
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
