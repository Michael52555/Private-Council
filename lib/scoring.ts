import type {
  Preference,
  RestaurantCandidate,
} from "@/lib/planning-types";

export type PreferenceScore = {
  category: "distance" | "budget";
  score: number;
  weight: number;
};

export type ScoreBreakdownItem = {
  category: "distance" | "budget";
  score: number | null;
  status: "ready" | "pending";
};

export type RestaurantScore = {
  totalScore: number | null;
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

  if (restaurantMax <= restaurantMin) {
    return restaurantMin >= minBudget &&
      restaurantMin <= maxBudget
      ? 1
      : 0;
  }

  const overlap = Math.max(
    0,
    Math.min(maxBudget, restaurantMax) -
      Math.max(minBudget, restaurantMin),
  );

  return overlap / (restaurantMax - restaurantMin);
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
  const budgetScore =
    isConfirmed(budgetPreference) &&
    typeof minBudget === "number" &&
    typeof maxBudget === "number"
      ? evaluateBudgetScore(
          candidate,
          minBudget,
          maxBudget,
        )
      : budgetPreference
        ? null
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
      score: budgetScore ?? null,
      status:
        typeof budgetScore === "number"
          ? "ready"
          : "pending",
    });

    if (typeof budgetScore === "number") {
      scores.push({
        category: "budget",
        score: budgetScore,
        weight: importanceWeight(
          budgetPreference.importance,
        ),
      });
    }
  }

  const hasPendingRequiredScore =
    breakdown.some((item) => item.status === "pending");

  return {
    totalScore: hasPendingRequiredScore
      ? null
      : combineScores(scores),
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
