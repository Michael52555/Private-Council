import assert from "node:assert/strict";
import test from "node:test";
import type {
  Preference,
  RestaurantCandidate,
} from "@/lib/planning-types";
import {
  evaluateBudgetScore,
  evaluateFoodScore,
  evaluateRestaurantScore,
} from "@/lib/scoring";
import { buildRestaurantFoodVector } from "@/lib/restaurant-food-vector";

function assertClose(actual: number | null, expected: number): void {
  assert.equal(typeof actual, "number");
  assert.ok(Math.abs((actual as number) - expected) < 1e-9);
}

const preferences: Preference[] = [
  {
    id: "distance",
    category: "distance",
    statement: "Within 5 miles",
    importance: 5,
    visibility: "private",
    interpretation: {
      status: "success",
      summary: "Within 5 miles",
      structuredData: { maxDistanceMiles: 5 },
      clarificationQuestion: null,
      source: "ai",
      confirmed: true,
    },
  },
  {
    id: "budget",
    category: "budget",
    statement: "$25 to $50",
    importance: 5,
    visibility: "private",
    interpretation: {
      status: "success",
      summary: "$25 to $50 per person",
      structuredData: {
        minPriceDollarsPerPerson: 25,
        maxPriceDollarsPerPerson: 50,
      },
      clarificationQuestion: null,
      source: "ai",
      confirmed: true,
    },
  },
];

function candidate(
  overrides: Partial<RestaurantCandidate> = {},
): RestaurantCandidate {
  return {
    id: "place-1",
    name: "Test restaurant",
    address: "123 Main St",
    distanceMiles: 1,
    pricePerPerson: null,
    estimatedPriceMin: null,
    estimatedPriceMax: null,
    googleEstimatedPriceMin: null,
    googleEstimatedPriceMax: null,
    googleEstimatedPriceMidpoint: null,
    googleBudgetEstimateSource: "unavailable",
    googleBudgetEstimateConfidence: "none",
    googleBudgetEstimateCurrency: null,
    budgetEstimateSource: "unavailable",
    budgetEstimateConfidence: "none",
    budgetEstimateCurrency: null,
    menuStatus: "pending",
    menuItemCount: 0,
    restaurantMealProfile: "sit_down",
    foodTypeVector: buildRestaurantFoodVector({}),
    foodTypeEstimateSource: "google_types_fallback",
    foodTypeEstimateConfidence: "low",
    placeTypes: [],
    orderingSources: [],
    ...overrides,
  };
}

test("keeps the restaurant score pending before menu prices load", () => {
  const score = evaluateRestaurantScore(
    candidate(),
    preferences,
  );

  assert.equal(score.totalScore, null);
  assert.equal(score.provisionalScore, 1);
  assert.deepEqual(score.breakdown, [
    { category: "distance", score: 1, status: "ready" },
    { category: "budget", score: null, status: "pending" },
  ]);
});

test("keeps Google pricing inactive until menu enrichment finishes", () => {
  const score = evaluateRestaurantScore(
    candidate({
      googleEstimatedPriceMin: 10,
      googleEstimatedPriceMax: 20,
      googleEstimatedPriceMidpoint: 15,
      googleBudgetEstimateSource: "google_price_range",
      googleBudgetEstimateConfidence: "medium",
      googleBudgetEstimateCurrency: "USD",
      budgetEstimateSource: "unavailable",
      budgetEstimateConfidence: "none",
      menuStatus: "loading",
    }),
    preferences,
  );

  assert.equal(score.breakdown[1].status, "pending");
  assert.equal(score.breakdown[1].score, null);
  assert.equal(score.totalScore, null);
});

test("scores the budget only after menu-derived prices load", () => {
  const score = evaluateRestaurantScore(
    candidate({
      estimatedPriceMin: 20,
      estimatedPriceMax: 50,
      pricePerPerson: 35,
      budgetEstimateSource: "menu",
      budgetEstimateConfidence: "high",
      budgetEstimateCurrency: "USD",
      menuStatus: "loaded",
      menuItemCount: 20,
    }),
    preferences,
  );

  assertClose(score.breakdown[1].score, 0.95);
  assertClose(score.totalScore, 0.975);
});

test("scores a medium-confidence API restaurant profile as ready evidence", () => {
  const score = evaluateRestaurantScore(
    candidate({
      estimatedPriceMin: 25,
      estimatedPriceMax: 45,
      pricePerPerson: 35,
      budgetEstimateSource: "api_profile",
      budgetEstimateConfidence: "medium",
      budgetEstimateCurrency: "USD",
      menuStatus: "loaded",
    }),
    preferences,
  );

  assert.equal(score.breakdown[1].status, "ready");
  assert.equal(score.breakdown[1].score, 1);
  assertClose(score.totalScore, 1);
});

test("keeps the broad deterministic price fallback low-weight and uncertain", () => {
  const score = evaluateRestaurantScore(
    candidate({
      estimatedPriceMin: 15,
      estimatedPriceMax: 45,
      pricePerPerson: 30,
      budgetEstimateSource: "heuristic_fallback",
      budgetEstimateConfidence: "low",
      budgetEstimateCurrency: "USD",
      menuStatus: "loaded",
    }),
    preferences,
  );

  assert.equal(score.breakdown[1].status, "uncertain");
  assert.equal(typeof score.breakdown[1].score, "number");
});

test("never lets a conflicting Google range override a reliable menu estimate", () => {
  const menuFirstPreferences = preferences.map((preference) =>
    preference.category === "budget"
      ? {
          ...preference,
          interpretation: {
            ...preference.interpretation!,
            structuredData: {
              minPriceDollarsPerPerson: 5,
              maxPriceDollarsPerPerson: 10,
            },
          },
        }
      : preference,
  );
  const score = evaluateRestaurantScore(
    candidate({
      estimatedPriceMin: 5,
      estimatedPriceMax: 8,
      pricePerPerson: 6.5,
      budgetEstimateSource: "menu",
      budgetEstimateConfidence: "high",
      budgetEstimateCurrency: "USD",
      googleEstimatedPriceMin: 20,
      googleEstimatedPriceMax: 50,
      googleEstimatedPriceMidpoint: 35,
      googleBudgetEstimateSource: "google_price_range",
      googleBudgetEstimateConfidence: "medium",
      googleBudgetEstimateCurrency: "USD",
      menuStatus: "loaded",
      menuItemCount: 4,
    }),
    menuFirstPreferences,
  );

  assert.equal(score.breakdown[1].score, 1);
  assert.equal(score.breakdown[1].status, "ready");
  assert.equal(score.totalScore, 1);
});

test("reduces the influence of a low-confidence composed menu estimate", () => {
  const lowConfidenceCandidate = candidate({
    estimatedPriceMin: 20,
    estimatedPriceMax: 50,
    pricePerPerson: 35,
    budgetEstimateSource: "menu",
    budgetEstimateConfidence: "low",
    budgetEstimateCurrency: "USD",
    menuStatus: "loaded",
    menuItemCount: 20,
  });
  const score = evaluateRestaurantScore(lowConfidenceCandidate, preferences);

  assertClose(score.breakdown[1].score, 0.95);
  assert.equal(score.breakdown[1].status, "uncertain");
  assertClose(score.totalScore, (1 + 0.95 * 0.45) / 1.45);
});

test("scores a partially overlapping Google fallback with reduced evidence weight", () => {
  const score = evaluateRestaurantScore(
    candidate({
      estimatedPriceMin: 15,
      estimatedPriceMax: 40,
      pricePerPerson: 27.5,
      googleEstimatedPriceMin: 15,
      googleEstimatedPriceMax: 40,
      googleEstimatedPriceMidpoint: 27.5,
      googleBudgetEstimateSource: "google_price_level",
      googleBudgetEstimateConfidence: "low",
      googleBudgetEstimateCurrency: "USD",
      budgetEstimateSource: "google_price_level",
      budgetEstimateConfidence: "low",
      budgetEstimateCurrency: "USD",
      menuStatus: "unavailable",
    }),
    preferences,
  );

  assert.equal(score.breakdown[1].status, "uncertain");
  assertClose(score.breakdown[1].score, 0.88);
  assertClose(score.totalScore, (1 + 0.88 * 0.35) / 1.35);
});

test("uses a continuous penalty for Google prices outside the budget", () => {
  const googleCandidate = candidate({
    estimatedPriceMin: 10,
    estimatedPriceMax: 20,
    googleEstimatedPriceMin: 10,
    googleEstimatedPriceMax: 20,
    googleEstimatedPriceMidpoint: 15,
    googleBudgetEstimateSource: "google_price_range",
    googleBudgetEstimateConfidence: "medium",
    googleBudgetEstimateCurrency: "USD",
    budgetEstimateSource: "google_price_range",
    budgetEstimateConfidence: "medium",
    budgetEstimateCurrency: "USD",
    menuStatus: "unavailable",
  });

  const within = evaluateRestaurantScore(googleCandidate, preferences);
  const expectedBudgetScore = evaluateBudgetScore(googleCandidate, 25, 50);
  assert.equal(within.breakdown[1].status, "uncertain");
  assertClose(within.breakdown[1].score, expectedBudgetScore as number);
  assertClose(within.totalScore, (1 + (expectedBudgetScore as number) * 0.65) / 1.65);

  const wideBudget = preferences.map((preference) => preference.category === "budget"
    ? {
        ...preference,
        interpretation: {
          ...preference.interpretation!,
          structuredData: {
            minPriceDollarsPerPerson: 0,
            maxPriceDollarsPerPerson: 50,
          },
        },
      }
    : preference);
  const covered = evaluateRestaurantScore(googleCandidate, wideBudget);
  assert.equal(covered.breakdown[1].status, "uncertain");
  assert.equal(covered.breakdown[1].score, 1);
  assert.equal(covered.totalScore, 1);
});

test("scores food preferences by the fraction of selected labels matched", () => {
  const result = evaluateFoodScore(
    candidate({
      foodTypeVector: buildRestaurantFoodVector({
        primaryType: "chinese_restaurant",
        placeTypes: ["restaurant", "food"],
      }),
      foodTypeEstimateConfidence: "medium",
    }),
    ["chinese", "japanese", "korean", "seafood"],
  );

  assert.deepEqual(result, { score: 0.25, status: "ready" });
});

test("factors fractional food coverage into the weighted restaurant score", () => {
  const foodPreferences: Preference[] = [
    preferences[0],
    {
      id: "food",
      category: "food",
      statement: "Chinese, Japanese, Korean, or seafood",
      importance: 5,
      visibility: "private",
      interpretation: {
        status: "success",
        summary: "Preferred food types",
        structuredData: {
          preferredFoodTypes: ["chinese", "japanese", "korean", "seafood"],
        },
        clarificationQuestion: null,
        source: "fixed",
        confirmed: true,
      },
    },
  ];
  const result = evaluateRestaurantScore(
    candidate({
      foodTypeVector: buildRestaurantFoodVector({
        primaryType: "chinese_restaurant",
      }),
      foodTypeEstimateConfidence: "medium",
    }),
    foodPreferences,
  );

  assert.equal(result.breakdown[1].score, 0.25);
  assertClose(result.totalScore, (0.2 + 0.25 * 0.6 * 0.8) / (0.2 + 0.6 * 0.8));
});

test("uses a 60/20/20 food, distance, and budget priority split", () => {
  const foodPreference: Preference = {
    id: "food-priority",
    category: "food",
    statement: "Chinese",
    importance: 5,
    visibility: "private",
    interpretation: {
      status: "success",
      summary: "Chinese",
      structuredData: { preferredFoodTypes: ["chinese"] },
      clarificationQuestion: null,
      source: "fixed",
      confirmed: true,
    },
  };
  const result = evaluateRestaurantScore(
    candidate({
      estimatedPriceMin: 25,
      estimatedPriceMax: 45,
      pricePerPerson: 35,
      budgetEstimateSource: "menu",
      budgetEstimateConfidence: "high",
      budgetEstimateCurrency: "USD",
      menuStatus: "loaded",
      foodTypeVector: buildRestaurantFoodVector({
        primaryType: "italian_restaurant",
      }),
      foodTypeEstimateSource: "api_profile",
      foodTypeEstimateConfidence: "high",
    }),
    [...preferences, foodPreference],
  );

  assert.equal(result.breakdown[0].score, 1);
  assert.equal(result.breakdown[1].score, 1);
  assert.equal(result.breakdown[2].score, 0);
  assertClose(result.totalScore, 0.4);
});

test("gives full food coverage only when every selected label matches", () => {
  const result = evaluateFoodScore(
    candidate({
      foodTypeVector: buildRestaurantFoodVector({
        primaryType: "chinese_noodle_restaurant",
      }),
      foodTypeEstimateConfidence: "high",
    }),
    ["chinese", "noodles"],
  );

  assert.deepEqual(result, { score: 1, status: "ready" });
});

test("keeps an unknown cuisine neutral instead of treating hot pot as Chinese", () => {
  const result = evaluateFoodScore(
    candidate({
      foodTypeVector: buildRestaurantFoodVector({
        primaryType: "hot_pot_restaurant",
      }),
      foodTypeEstimateConfidence: "medium",
    }),
    ["chinese"],
  );

  assert.deepEqual(result, { score: 0.5, status: "uncertain" });
});

test("penalizes a known cuisine mismatch", () => {
  const result = evaluateFoodScore(
    candidate({
      foodTypeVector: buildRestaurantFoodVector({
        primaryType: "italian_restaurant",
      }),
      foodTypeEstimateConfidence: "medium",
    }),
    ["chinese", "japanese"],
  );

  assert.deepEqual(result, { score: 0, status: "ready" });
});

test("keeps a low-confidence API food match but reduces its authority", () => {
  const result = evaluateFoodScore(
    candidate({
      foodTypeVector: buildRestaurantFoodVector({
        primaryType: "japanese_restaurant",
      }),
      foodTypeEstimateSource: "api_profile",
      foodTypeEstimateConfidence: "low",
    }),
    ["japanese"],
  );

  assert.deepEqual(result, { score: 1, status: "uncertain" });
});
