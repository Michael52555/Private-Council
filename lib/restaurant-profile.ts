import {
  FOOD_TYPE_OPTIONS,
  foodTypeFacet,
  type BudgetEstimateConfidence,
  type FoodType,
  type RestaurantCandidate,
  type RestaurantFoodVector,
  type RestaurantFoodTypeEvidence,
} from "@/lib/planning-types";
import {
  activeFoodTypes,
  buildRestaurantFoodVectorFromTypes,
} from "@/lib/restaurant-food-vector";

export const restaurantProfileSchemaVersion = 2;
export const restaurantProfilePromptVersion = 3;

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
  labelEvidence: RestaurantFoodTypeEvidence[];
  typeConfidence: Exclude<BudgetEstimateConfidence, "none">;
  estimatedPriceMin: number | null;
  estimatedPriceMax: number | null;
  priceConfidence: Exclude<BudgetEstimateConfidence, "none">;
};

const foodTypeValues = new Set<string>(
  FOOD_TYPE_OPTIONS.map((option) => option.value),
);
const confidenceValues = new Set(["high", "medium", "low"]);
const evidenceKindValues = new Set([
  "official_menu",
  "official_description",
  "third_party_menu",
  "other_web",
]);

function normalizedEvidenceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizedEvidenceText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > maximumLength) return null;
  return normalized;
}

function parseLabelEvidence(value: unknown): RestaurantFoodTypeEvidence | null {
  if (typeof value !== "object" || value === null) return null;
  const evidence = value as Record<string, unknown>;
  if (
    typeof evidence.foodType !== "string" ||
    !foodTypeValues.has(evidence.foodType) ||
    typeof evidence.evidenceKind !== "string" ||
    !evidenceKindValues.has(evidence.evidenceKind)
  ) {
    return null;
  }
  const sourceUrl = normalizedEvidenceUrl(evidence.sourceUrl);
  const reason = normalizedEvidenceText(evidence.reason, 500);
  if (!sourceUrl || !reason || !Array.isArray(evidence.mainEntries)) return null;

  const mainEntries: string[] = [];
  for (const rawEntry of evidence.mainEntries.slice(0, 8)) {
    const entry = normalizedEvidenceText(rawEntry, 160);
    if (!entry) return null;
    if (!mainEntries.includes(entry)) mainEntries.push(entry);
  }

  return {
    foodType: evidence.foodType as FoodType,
    evidenceKind: evidence.evidenceKind as RestaurantFoodTypeEvidence["evidenceKind"],
    sourceUrl,
    reason,
    mainEntries,
  };
}

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

  if (!Array.isArray(profile.labelEvidence)) return null;
  const labelEvidence: RestaurantFoodTypeEvidence[] = [];
  for (const rawEvidence of profile.labelEvidence) {
    const evidence = parseLabelEvidence(rawEvidence);
    if (!evidence) continue;
    if (
      !labelEvidence.some((existing) => existing.foodType === evidence.foodType)
    ) {
      labelEvidence.push(evidence);
    }
  }
  const evidencedFoodTypes = new Set(
    labelEvidence.map((evidence) => evidence.foodType),
  );
  const supportedFoodTypes = foodTypes.filter((foodType) =>
    evidencedFoodTypes.has(foodType)
  );
  const supportedEvidence = labelEvidence.filter((evidence) =>
    supportedFoodTypes.includes(evidence.foodType)
  );

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
    foodTypes: supportedFoodTypes,
    labelEvidence: supportedEvidence,
    typeConfidence: profile.typeConfidence as RestaurantApiProfile["typeConfidence"],
    estimatedPriceMin: minimum,
    estimatedPriceMax: maximum,
    priceConfidence: profile.priceConfidence as RestaurantApiProfile["priceConfidence"],
  };
}

function comparableEvidenceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return `${url.origin.toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

export function restrictRestaurantProfileToWebSources(
  profile: RestaurantApiProfile,
  sourceUrls: ReadonlySet<string>,
): RestaurantApiProfile {
  const comparableSources = new Set(
    [...sourceUrls]
      .map(comparableEvidenceUrl)
      .filter((value): value is string => value !== null),
  );
  const labelEvidence = profile.labelEvidence.filter((evidence) => {
    const comparable = comparableEvidenceUrl(evidence.sourceUrl);
    return comparable !== null && comparableSources.has(comparable);
  });
  const evidencedFoodTypes = new Set(
    labelEvidence.map((evidence) => evidence.foodType),
  );
  const foodTypes = profile.foodTypes.filter((foodType) =>
    evidencedFoodTypes.has(foodType)
  );

  return {
    ...profile,
    foodTypes,
    labelEvidence: labelEvidence.filter((evidence) =>
      foodTypes.includes(evidence.foodType)
    ),
    typeConfidence:
      foodTypes.length < profile.foodTypes.length ? "low" : profile.typeConfidence,
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
  // A successful API profile is authoritative even when it contains no food
  // labels. Google types are used only when the API request truly failed.
  const shouldUseApiFood = Boolean(apiProfile);
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
    foodTypeEvidence: shouldUseApiFood
      ? apiProfile!.labelEvidence
      : [],
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
