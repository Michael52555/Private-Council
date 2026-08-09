import assert from "node:assert/strict";
import test from "node:test";
import type {
  Preference,
  RestaurantCandidate,
} from "@/lib/planning-types";
import {
  evaluateBudgetScore,
  evaluateRestaurantScore,
} from "@/lib/scoring";

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
