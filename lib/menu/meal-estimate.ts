import type { MenuItem, RestaurantMenuResult } from "@/lib/menu/types";
import type { BudgetEstimateConfidence } from "@/lib/planning-types";

const ACCESSORY_PATTERN = /\b(?:add[ -]?ons?|extras?|modifier|choice|option|sauces?|dips?|dressings?|condiments?|toppings?|sides?|beverages?|drinks?|sodas?|coffee|tea|desserts?|sweets?|cookies?|utensils?|napkins?|cutlery)\b/i;
const NON_INDIVIDUAL_PATTERN = /\b(?:family|party|catering|group|serves?\s+\d+|feeds?\s+\d+)\b/i;
const MEAL_PATTERN = /\b(?:combo|meal|plate|platter|bowl|box|bundle|entrée|entree|dinner|lunch|burger|sandwich|wrap|burrito|pizza|ramen|noodles?|pasta|salad)\b/i;
const UNIT_PRICED_RESTAURANT_PATTERN = /\b(?:sushi|izakaya|tapas|dim\s*sum|small plates?)\b/i;
const UNIT_PRICED_ITEM_PATTERN = /\b(?:nigiri|sashimi|hand roll|maki|sushi|tapas|small plates?|dim\s*sum)\b/i;
const UNIT_PRICED_COMPLETE_MEAL_PATTERN = /\b(?:combo|combination|meal|bento|omakase|platter|entrée|entree|donburi|rice bowl|ramen|udon|noodles?|curry|lunch special|dinner special)\b/i;

type MealEstimateContext = {
  restaurantName?: string;
};

function itemText(item: MenuItem): string {
  return `${item.section ?? ""} ${item.name} ${item.description ?? ""}`;
}

function quantile(sorted: Array<MenuItem & { price: number }>, ratio: number): number {
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index].price;
}

export function selectTypicalMealItems(
  items: MenuItem[],
  context?: MealEstimateContext,
): {
  items: Array<MenuItem & { price: number }>;
  basis: RestaurantMenuResult["priceSummary"]["basis"];
};
export function selectTypicalMealItems(
  items: MenuItem[],
  context: MealEstimateContext = {},
): {
  items: Array<MenuItem & { price: number }>;
  basis: RestaurantMenuResult["priceSummary"]["basis"];
} {
  const priced = items.filter(
    (item): item is MenuItem & { price: number } =>
      typeof item.price === "number" && Number.isFinite(item.price) && item.price >= 0,
  );
  const individual = priced.filter((item) => !NON_INDIVIDUAL_PATTERN.test(itemText(item)));
  const nonAccessory = individual.filter((item) => !ACCESSORY_PATTERN.test(itemText(item)));
  const unitPricedItemCount = nonAccessory.filter((item) =>
    UNIT_PRICED_ITEM_PATTERN.test(itemText(item)),
  ).length;
  const isUnitPricedMenu = UNIT_PRICED_RESTAURANT_PATTERN.test(context.restaurantName ?? "") ||
    (unitPricedItemCount >= 3 && unitPricedItemCount / Math.max(1, nonAccessory.length) >= 0.25);

  if (isUnitPricedMenu) {
    const completeMeals = nonAccessory.filter((item) =>
      UNIT_PRICED_COMPLETE_MEAL_PATTERN.test(itemText(item)),
    );
    return completeMeals.length >= 3
      ? { items: completeMeals, basis: "explicit_meals" }
      : { items: [], basis: "none" };
  }

  const explicitMeals = nonAccessory.filter((item) => MEAL_PATTERN.test(itemText(item)));

  if (explicitMeals.length >= 3) {
    return { items: explicitMeals, basis: "explicit_meals" };
  }
  if (nonAccessory.length >= 3) {
    return { items: nonAccessory, basis: "filtered_menu_items" };
  }
  return { items: priced, basis: priced.length > 0 ? "all_priced_items" : "none" };
}

export function summarizeTypicalMealPrices(
  items: MenuItem[],
  context: MealEstimateContext = {},
): RestaurantMenuResult["priceSummary"] {
  const selection = selectTypicalMealItems(items, context);
  const sorted = [...selection.items].sort((a, b) => a.price - b.price);

  if (sorted.length === 0) {
    return {
      minimum: null,
      maximum: null,
      lowerQuartile: null,
      upperQuartile: null,
      median: null,
      currency: null,
      basis: "none",
      sampleItemCount: 0,
      excludedItemCount: items.filter((item) => typeof item.price === "number").length,
      sampleItemIds: [],
    };
  }

  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1].price + sorted[middle].price) / 2
    : sorted[middle].price;
  const currencies = sorted.map((item) => item.currency).filter(Boolean);
  const pricedItemCount = items.filter((item) => typeof item.price === "number").length;

  return {
    minimum: sorted[0].price,
    maximum: sorted[sorted.length - 1].price,
    lowerQuartile: quantile(sorted, 0.25),
    upperQuartile: quantile(sorted, 0.75),
    median: Math.round(median * 100) / 100,
    currency: (currencies[0] as string | undefined) ?? null,
    basis: selection.basis,
    sampleItemCount: sorted.length,
    excludedItemCount: Math.max(0, pricedItemCount - sorted.length),
    sampleItemIds: sorted.map((item) => item.id),
  };
}

export function mealEstimateConfidence(
  summary: RestaurantMenuResult["priceSummary"],
): BudgetEstimateConfidence {
  if (summary.sampleItemCount < 3) return "none";
  if (summary.basis === "explicit_meals") return "high";
  if (summary.basis === "filtered_menu_items") return "medium";
  return "none";
}

export function hasReliableMealEstimate(
  summary: RestaurantMenuResult["priceSummary"],
): boolean {
  return mealEstimateConfidence(summary) !== "none";
}
