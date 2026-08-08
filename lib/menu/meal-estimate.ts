import type { MenuItem, RestaurantMenuResult } from "@/lib/menu/types";

const ACCESSORY_PATTERN = /\b(?:add[ -]?ons?|extras?|modifier|choice|option|sauces?|dips?|dressings?|condiments?|toppings?|sides?|beverages?|drinks?|sodas?|coffee|tea|desserts?|sweets?|cookies?|utensils?|napkins?|cutlery)\b/i;
const NON_INDIVIDUAL_PATTERN = /\b(?:family|party|catering|group|serves?\s+\d+|feeds?\s+\d+)\b/i;
const MEAL_PATTERN = /\b(?:combo|meal|plate|platter|bowl|box|bundle|entrée|entree|dinner|lunch|burger|sandwich|wrap|burrito|pizza|ramen|noodles?|pasta|salad)\b/i;

function itemText(item: MenuItem): string {
  return `${item.section ?? ""} ${item.name} ${item.description ?? ""}`;
}

function quantile(sorted: Array<MenuItem & { price: number }>, ratio: number): number {
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index].price;
}

export function selectTypicalMealItems(items: MenuItem[]): {
  items: Array<MenuItem & { price: number }>;
  basis: RestaurantMenuResult["priceSummary"]["basis"];
} {
  const priced = items.filter(
    (item): item is MenuItem & { price: number } =>
      typeof item.price === "number" && Number.isFinite(item.price) && item.price >= 0,
  );
  const individual = priced.filter((item) => !NON_INDIVIDUAL_PATTERN.test(itemText(item)));
  const nonAccessory = individual.filter((item) => !ACCESSORY_PATTERN.test(itemText(item)));
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
): RestaurantMenuResult["priceSummary"] {
  const selection = selectTypicalMealItems(items);
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
