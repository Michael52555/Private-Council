import {
  FOOD_TYPE_OPTIONS,
  foodTypeFacet,
  type BudgetEstimateConfidence,
  type FoodType,
  type RestaurantCandidate,
  type RestaurantFoodVector,
} from "@/lib/planning-types";
import {
  activeFoodTypes,
  buildRestaurantFoodVectorFromTypes,
} from "@/lib/restaurant-food-vector";

export const restaurantProfileSchemaVersion = 1;
export const restaurantProfilePromptVersion = 1;

export type RestaurantProfileInput = {
  placeId: string;
  name: string;
  address: string;
  primaryType?: string;
  placeTypes: string[];
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
};

export type RestaurantApiProfile = {
  placeId: string;
  foodTypes: FoodType[];
  typeConfidence: Exclude<BudgetEstimateConfidence, "none">;
  estimatedPriceMin: number | null;
  estimatedPriceMax: number | null;
  priceConfidence: Exclude<BudgetEstimateConfidence, "none">;
};

const foodTypeValues = new Set<string>(
  FOOD_TYPE_OPTIONS.map((option) => option.value),
);
const confidenceValues = new Set(["high", "medium", "low"]);

function normalizedMoney(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 3 || value > 500) return null;
  return Math.round(value * 100) / 100;
}

export function parseRestaurantApiProfile(
  value: unknown,
  expectedPlaceIds?: ReadonlySet<string>,
): RestaurantApiProfile | null {
  if (typeof value !== "object" || value === null) return null;
  const profile = value as Record<string, unknown>;
  const placeId = typeof profile.placeId === "string"
    ? profile.placeId.trim()
    : "";
  if (!placeId || (expectedPlaceIds && !expectedPlaceIds.has(placeId))) {
    return null;
  }
  if (!Array.isArray(profile.foodTypes)) return null;

  const foodTypes: FoodType[] = [];
  for (const value of profile.foodTypes) {
    if (typeof value !== "string" || !foodTypeValues.has(value)) return null;
    if (!foodTypes.includes(value as FoodType)) {
      foodTypes.push(value as FoodType);
    }
  }

  if (
    typeof profile.typeConfidence !== "string" ||
    !confidenceValues.has(profile.typeConfidence) ||
    typeof profile.priceConfidence !== "string" ||
    !confidenceValues.has(profile.priceConfidence)
  ) {
    return null;
  }

  const rawMinimum = profile.estimatedPriceMin;
  const rawMaximum = profile.estimatedPriceMax;
  if ((rawMinimum === null) !== (rawMaximum === null)) return null;
  const minimum = rawMinimum === null ? null : normalizedMoney(rawMinimum);
  const maximum = rawMaximum === null ? null : normalizedMoney(rawMaximum);
  if (
    (rawMinimum !== null && minimum === null) ||
    (rawMaximum !== null && maximum === null) ||
    (minimum !== null && maximum !== null && maximum < minimum)
  ) {
    return null;
  }

  return {
    placeId,
    foodTypes,
    typeConfidence: profile.typeConfidence as RestaurantApiProfile["typeConfidence"],
    estimatedPriceMin: minimum,
    estimatedPriceMax: maximum,
    priceConfidence: profile.priceConfidence as RestaurantApiProfile["priceConfidence"],
  };
}

export function parseRestaurantApiProfileBatch(
  value: unknown,
  inputs: readonly RestaurantProfileInput[],
): Map<string, RestaurantApiProfile> {
  const result = new Map<string, RestaurantApiProfile>();
  if (typeof value !== "object" || value === null) return result;
  const rawProfiles = (value as Record<string, unknown>).profiles;
  if (!Array.isArray(rawProfiles)) return result;
  const expectedPlaceIds = new Set(inputs.map((input) => input.placeId));

  for (const rawProfile of rawProfiles) {
    const profile = parseRestaurantApiProfile(rawProfile, expectedPlaceIds);
    if (profile && !result.has(profile.placeId)) {
      result.set(profile.placeId, profile);
    }
  }
  return result;
}

function fallbackFoodEvidence(candidate: RestaurantCandidate): {
  vector: RestaurantFoodVector;
  confidence: BudgetEstimateConfidence;
} {
  return {
    vector: candidate.foodTypeVector,
    confidence: candidate.foodTypeVector.knownFacets.length > 0 ? "medium" : "low",
  };
}

function heuristicPriceBand(candidate: RestaurantCandidate): readonly [number, number] {
  const types = new Set(activeFoodTypes(candidate.foodTypeVector));
  if (types.has("fast_food") || candidate.restaurantMealProfile === "fast_food") {
    return [8, 25];
  }
  if (types.has("cafe_bakery")) return [8, 28];
  if (types.has("hot_pot") || types.has("sushi") || types.has("seafood")) {
    return [20, 55];
  }
  if (
    types.has("pizza") ||
    types.has("burgers") ||
    types.has("noodles") ||
    types.has("barbecue")
  ) {
    return [12, 35];
  }
  return [15, 45];
}

export function applyRestaurantProfile(
  candidate: RestaurantCandidate,
  apiProfile?: RestaurantApiProfile,
): RestaurantCandidate {
  const fallbackFood = fallbackFoodEvidence(candidate);
  const apiFoodVector = apiProfile
    ? buildRestaurantFoodVectorFromTypes(apiProfile.foodTypes)
    : null;
  const shouldUseApiFood = Boolean(
    apiProfile &&
    (apiProfile.foodTypes.length > 0 || activeFoodTypes(fallbackFood.vector).length === 0),
  );
  const foodTypeVector = shouldUseApiFood && apiFoodVector
    ? apiFoodVector
    : fallbackFood.vector;

  const hasApiPrice = Boolean(
    apiProfile &&
    typeof apiProfile.estimatedPriceMin === "number" &&
    typeof apiProfile.estimatedPriceMax === "number",
  );
  const hasGooglePrice =
    typeof candidate.googleEstimatedPriceMin === "number" &&
    typeof candidate.googleEstimatedPriceMax === "number";
  const heuristicBand = heuristicPriceBand(candidate);
  const estimatedPriceMin = hasApiPrice
    ? apiProfile!.estimatedPriceMin
    : hasGooglePrice
      ? candidate.googleEstimatedPriceMin
      : heuristicBand[0];
  const estimatedPriceMax = hasApiPrice
    ? apiProfile!.estimatedPriceMax
    : hasGooglePrice
      ? candidate.googleEstimatedPriceMax
      : heuristicBand[1];
  const midpoint =
    typeof estimatedPriceMin === "number" && typeof estimatedPriceMax === "number"
      ? Math.round(((estimatedPriceMin + estimatedPriceMax) / 2) * 100) / 100
      : null;

  return {
    ...candidate,
    foodTypeVector,
    foodTypeEstimateSource: shouldUseApiFood
      ? "api_profile"
      : "google_types_fallback",
    foodTypeEstimateConfidence: shouldUseApiFood
      ? apiProfile!.typeConfidence
      : fallbackFood.confidence,
    estimatedPriceMin,
    estimatedPriceMax,
    pricePerPerson: midpoint,
    budgetEstimateSource: hasApiPrice
      ? "api_profile"
      : hasGooglePrice
        ? candidate.googleBudgetEstimateSource
        : "heuristic_fallback",
    budgetEstimateConfidence: hasApiPrice
      ? apiProfile!.priceConfidence
      : hasGooglePrice
        ? candidate.googleBudgetEstimateConfidence
        : "low",
    budgetEstimateCurrency: hasApiPrice
      ? "USD"
      : hasGooglePrice
        ? candidate.googleBudgetEstimateCurrency ?? "USD"
        : "USD",
    // The legacy field now means that restaurant profiling has completed.
    // Keeping it avoids a destructive client-state migration.
    menuStatus: "loaded",
    menuItemCount: 0,
    orderingSources: [],
  };
}

export function restaurantProfileInput(
  candidate: RestaurantCandidate,
): RestaurantProfileInput {
  return {
    placeId: candidate.id,
    name: candidate.name,
    address: candidate.address,
    primaryType: candidate.primaryType,
    placeTypes: candidate.placeTypes,
    rating: candidate.rating,
    userRatingCount: candidate.userRatingCount,
    websiteUri: candidate.websiteUri,
  };
}

export function knownFoodFacets(foodTypes: readonly FoodType[]): string[] {
  return [...new Set(foodTypes.map(foodTypeFacet))];
}
