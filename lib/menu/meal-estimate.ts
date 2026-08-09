import type {
  MenuItem,
  RestaurantMealProfile,
  RestaurantMenuResult,
} from "@/lib/menu/types";
import type { BudgetEstimateConfidence } from "@/lib/planning-types";
import { estimateMealComposition } from "@/lib/menu/meal-composition";

type MealEstimateContext = {
  restaurantName?: string;
  mealProfile?: RestaurantMealProfile;
  partySize?: number;
};

function unavailableSummary(
  items: MenuItem[],
): RestaurantMenuResult["priceSummary"] {
  return {
    minimum: null,
    maximum: null,
    lowerQuartile: null,
    upperQuartile: null,
    median: null,
    currency: null,
    basis: "none",
    confidence: "none",
    sampleItemCount: 0,
    excludedItemCount: items.filter((item) => typeof item.price === "number").length,
    sampleItemIds: [],
  };
}

export function summarizeTypicalMealPrices(
  items: MenuItem[],
  context: MealEstimateContext = {},
): RestaurantMenuResult["priceSummary"] {
  const composition = estimateMealComposition(items, context);
  if (!composition) return unavailableSummary(items);

  const currencies = composition.evidenceItems
    .map((item) => item.currency)
    .filter(Boolean);
  const basis = composition.composed
    ? "composed_basket"
    : composition.pattern === "combo_dominant"
      ? "explicit_meals"
      : "filtered_menu_items";

  return {
    minimum: composition.lower,
    maximum: composition.upper,
    lowerQuartile: composition.lower,
    upperQuartile: composition.upper,
    median: composition.median,
    currency: (currencies[0] as string | undefined) ?? null,
    basis,
    confidence: composition.confidence,
    mealPattern: composition.pattern,
    composed: composition.composed,
    sampleItemCount: composition.evidenceItems.length,
    excludedItemCount: composition.excludedItemCount,
    sampleItemIds: composition.evidenceItems.map((item) => item.id),
  };
}

export function mealEstimateConfidence(
  summary: RestaurantMenuResult["priceSummary"],
): BudgetEstimateConfidence {
  if (summary.sampleItemCount < 2) return "none";
  if (summary.sampleItemCount < 3) {
    return summary.basis === "explicit_meals" ? "medium" : "none";
  }
  if (summary.confidence) return summary.confidence;
  if (summary.basis === "explicit_meals") return "high";
  if (summary.basis === "filtered_menu_items") return "medium";
  return "none";
}

export function hasReliableMealEstimate(
  summary: RestaurantMenuResult["priceSummary"],
): boolean {
  return mealEstimateConfidence(summary) !== "none";
}
