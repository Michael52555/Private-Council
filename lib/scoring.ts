import type {
  FoodType,
  Preference,
  RestaurantCandidate,
} from "@/lib/planning-types";
import { foodTypeFacet } from "@/lib/planning-types";

export type PreferenceScore = {
  category: "distance" | "budget" | "food";
  score: number;
  weight: number;
};

export type ScoreBreakdownItem = {
  category: "distance" | "budget" | "food";
  score: number | null;
  status: "ready" | "pending" | "uncertain";
};

type BudgetScoreEvaluation = Pick<ScoreBreakdownItem, "score" | "status">;
type FoodScoreEvaluation = Pick<ScoreBreakdownItem, "score" | "status">;

export type RestaurantScore = {
  totalScore: number | null;
  provisionalScore: number | null;
  breakdown: ScoreBreakdownItem[];
};

export function evaluateDistanceScore(
  candidate: RestaurantCandidate,
  maxDistance: number,
): number {
  if (candidate.distanceMiles <= maxDistance) {
    return 1;
  }

  return Math.exp(
    -0.5 * (candidate.distanceMiles - maxDistance),
  );
}

export function evaluateBudgetScore(
  candidate: RestaurantCandidate,
  minBudget: number,
  maxBudget: number,
): number | null {
  const restaurantMin = candidate.estimatedPriceMin;
  const restaurantMax = candidate.estimatedPriceMax;

  if (
    typeof restaurantMin !== "number" ||
    typeof restaurantMax !== "number"
  ) {
    return null;
  }

  const normalizedRestaurantMin = Math.min(restaurantMin, restaurantMax);
  const normalizedRestaurantMax = Math.max(restaurantMin, restaurantMax);
  const normalizedBudgetMin = Math.min(minBudget, maxBudget);
  const normalizedBudgetMax = Math.max(minBudget, maxBudget);

  if (
    normalizedRestaurantMin >= normalizedBudgetMin &&
    normalizedRestaurantMax <= normalizedBudgetMax
  ) return 1;

  const overlap = Math.max(
    0,
    Math.min(normalizedBudgetMax, normalizedRestaurantMax) -
      Math.max(normalizedBudgetMin, normalizedRestaurantMin),
  );
  const restaurantWidth = normalizedRestaurantMax - normalizedRestaurantMin;
  const overlapFraction = restaurantWidth > 0 ? overlap / restaurantWidth : 0;
  const representativePrice = typeof candidate.pricePerPerson === "number"
    ? candidate.pricePerPerson
    : (normalizedRestaurantMin + normalizedRestaurantMax) / 2;
  const distanceFromBudget = representativePrice < normalizedBudgetMin
    ? normalizedBudgetMin - representativePrice
    : representativePrice > normalizedBudgetMax
      ? representativePrice - normalizedBudgetMax
      : 0;
  const budgetWidth = Math.max(1, normalizedBudgetMax - normalizedBudgetMin);
  const distanceScale = Math.max(5, budgetWidth / 4);
  const representativeScore = distanceFromBudget === 0
    ? 1
    : Math.exp(-distanceFromBudget / distanceScale);

  return Math.max(
    0,
    Math.min(1, 0.7 * representativeScore + 0.3 * overlapFraction),
  );
}

export function budgetEvidenceWeight(candidate: RestaurantCandidate): number {
  if (candidate.budgetEstimateSource === "menu") {
    if (candidate.budgetEstimateConfidence === "high") return 1;
    if (candidate.budgetEstimateConfidence === "medium") return 0.75;
    if (candidate.budgetEstimateConfidence === "low") return 0.45;
    return 0;
  }
  if (candidate.budgetEstimateSource === "api_profile") {
    if (candidate.budgetEstimateConfidence === "high") return 0.9;
    if (candidate.budgetEstimateConfidence === "medium") return 0.7;
    if (candidate.budgetEstimateConfidence === "low") return 0.4;
    return 0;
  }
  if (candidate.budgetEstimateSource === "google_price_range") return 0.65;
  if (candidate.budgetEstimateSource === "google_price_level") return 0.35;
  if (candidate.budgetEstimateSource === "heuristic_fallback") return 0.2;
  return 0;
}

export function evaluateBudgetScoreWithConfidence(
  candidate: RestaurantCandidate,
  minBudget: number,
  maxBudget: number,
): BudgetScoreEvaluation {
  if (candidate.menuStatus === "pending" || candidate.menuStatus === "loading") {
    return { score: null, status: "pending" };
  }
  const restaurantMin = candidate.estimatedPriceMin;
  const restaurantMax = candidate.estimatedPriceMax;
  if (typeof restaurantMin !== "number" || typeof restaurantMax !== "number") {
    return { score: null, status: "pending" };
  }
  if (candidate.budgetEstimateSource === "unavailable") {
    return { score: null, status: "pending" };
  }

  return {
    score: evaluateBudgetScore(candidate, minBudget, maxBudget),
    status:
      (candidate.budgetEstimateSource === "menu" ||
        candidate.budgetEstimateSource === "api_profile") &&
      (candidate.budgetEstimateConfidence === "high" ||
        candidate.budgetEstimateConfidence === "medium")
        ? "ready"
        : "uncertain",
  };
}

export function evaluateFoodScore(
  candidate: RestaurantCandidate,
  preferredFoodTypes: FoodType[],
): FoodScoreEvaluation {
  if (preferredFoodTypes.length === 0) {
    return { score: null, status: "pending" };
  }

  if (
    preferredFoodTypes.some(
      (foodType) => candidate.foodTypeVector.values[foodType] === 1,
    )
  ) {
    return {
      score: 1,
      status: candidate.foodTypeEstimateConfidence === "low" ||
        candidate.foodTypeEstimateConfidence === "none"
        ? "uncertain"
        : "ready",
    };
  }

  const relevantFacets = new Set(preferredFoodTypes.map(foodTypeFacet));
  const hasUnknownFacet = [...relevantFacets].some(
    (facet) => !candidate.foodTypeVector.knownFacets.includes(facet),
  );

  // Google can return a generic `restaurant` type without a cuisine or style.
  // Unknown evidence is neutral rather than a false mismatch.
  if (hasUnknownFacet) {
    return { score: 0.5, status: "uncertain" };
  }

  return {
    score: 0,
    status: candidate.foodTypeEstimateConfidence === "low" ||
      candidate.foodTypeEstimateConfidence === "none"
      ? "uncertain"
      : "ready",
  };
}

export function foodEvidenceWeight(candidate: RestaurantCandidate): number {
  if (candidate.foodTypeEstimateConfidence === "high") return 1;
  if (candidate.foodTypeEstimateConfidence === "medium") return 0.8;
  if (candidate.foodTypeEstimateConfidence === "low") return 0.45;
  return 0;
}

function isConfirmed(preference: Preference | undefined): boolean {
  return Boolean(
    preference?.interpretation?.status === "success" &&
      preference.interpretation.confirmed,
  );
}

export function evaluateRestaurantScore(
  candidate: RestaurantCandidate,
  preferences: Preference[],
): RestaurantScore {
  const distancePreference = preferences.find(
    (preference) => preference.category === "distance",
  );
  const budgetPreference = preferences.find(
    (preference) => preference.category === "budget",
  );
  const foodPreference = preferences.find(
    (preference) => preference.category === "food",
  );

  const maxDistance =
    distancePreference?.interpretation?.structuredData
      .maxDistanceMiles;
  const distanceScore =
    isConfirmed(distancePreference) &&
    typeof maxDistance === "number"
      ? evaluateDistanceScore(candidate, maxDistance)
      : null;

  const minBudget =
    budgetPreference?.interpretation?.structuredData
      .minPriceDollarsPerPerson;
  const maxBudget =
    budgetPreference?.interpretation?.structuredData
      .maxPriceDollarsPerPerson;
  const budgetEvaluation: BudgetScoreEvaluation | undefined =
    isConfirmed(budgetPreference) &&
    typeof minBudget === "number" &&
    typeof maxBudget === "number"
      ? evaluateBudgetScoreWithConfidence(
          candidate,
          minBudget,
          maxBudget,
        )
      : budgetPreference
        ? { score: null, status: "pending" }
        : undefined;

  const preferredFoodTypes =
    foodPreference?.interpretation?.structuredData.preferredFoodTypes;
  const foodEvaluation: FoodScoreEvaluation | undefined =
    isConfirmed(foodPreference) &&
    Array.isArray(preferredFoodTypes) &&
    preferredFoodTypes.length > 0
      ? evaluateFoodScore(candidate, preferredFoodTypes)
      : foodPreference
        ? { score: null, status: "pending" }
        : undefined;

  const breakdown: ScoreBreakdownItem[] = [];
  const scores: PreferenceScore[] = [];

  if (distancePreference) {
    breakdown.push({
      category: "distance",
      score: distanceScore,
      status:
        distanceScore === null ? "pending" : "ready",
    });

    if (distanceScore !== null) {
      scores.push({
        category: "distance",
        score: distanceScore,
        weight: importanceWeight(
          distancePreference.importance,
        ),
      });
    }
  }

  if (budgetPreference) {
    breakdown.push({
      category: "budget",
      score: budgetEvaluation?.score ?? null,
      status: budgetEvaluation?.status ?? "pending",
    });

    if (typeof budgetEvaluation?.score === "number") {
      scores.push({
        category: "budget",
        score: budgetEvaluation.score,
        weight:
          importanceWeight(budgetPreference.importance) *
          budgetEvidenceWeight(candidate),
      });
    }
  }

  if (foodPreference) {
    breakdown.push({
      category: "food",
      score: foodEvaluation?.score ?? null,
      status: foodEvaluation?.status ?? "pending",
    });

    if (typeof foodEvaluation?.score === "number") {
      scores.push({
        category: "food",
        score: foodEvaluation.score,
        weight:
          importanceWeight(foodPreference.importance) *
          foodEvidenceWeight(candidate),
      });
    }
  }

  const hasPendingScore = breakdown.some((item) => item.status === "pending");
  const provisionalScore = scores.length > 0 ? combineScores(scores) : null;

  return {
    totalScore: hasPendingScore ? null : provisionalScore,
    provisionalScore,
    breakdown,
  };
}

export function importanceWeight(
  importance: number,
): number {
  return importance / 5;
}

export function combineScores(
  scores: PreferenceScore[],
): number {
  const totalWeight = scores.reduce(
    (sum, score) => sum + score.weight,
    0,
  );

  if (totalWeight === 0) {
    return 0;
  }

  return (
    scores.reduce(
      (sum, score) =>
        sum + score.score * score.weight,
      0,
    ) / totalWeight
  );
}
