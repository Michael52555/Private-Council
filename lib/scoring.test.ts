import assert from "node:assert/strict";
import test from "node:test";
import type {
  Preference,
  RestaurantCandidate,
} from "@/lib/planning-types";
import {
  evaluateRestaurantScore,
} from "@/lib/scoring";

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
  assert.deepEqual(score.breakdown, [
    { category: "distance", score: 1, status: "ready" },
    { category: "budget", score: null, status: "pending" },
  ]);
});

test("does not score a Google fallback until menu enrichment finishes", () => {
  const score = evaluateRestaurantScore(
    candidate({
      estimatedPriceMin: 10,
      estimatedPriceMax: 20,
      budgetEstimateSource: "google_price_range",
      budgetEstimateConfidence: "medium",
      budgetEstimateCurrency: "USD",
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

  assert.equal(score.breakdown[1].score, 25 / 30);
  assert.equal(score.totalScore, (1 + 25 / 30) / 2);
});

test("marks a partially overlapping Google fallback as uncertain", () => {
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
  assert.equal(score.breakdown[1].score, null);
  assert.equal(score.totalScore, null);
});

test("uses Google fallback for clear within-budget and outside-budget decisions", () => {
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
  assert.equal(within.breakdown[1].status, "ready");
  assert.equal(within.breakdown[1].score, 0);

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
  assert.equal(covered.breakdown[1].status, "ready");
  assert.equal(covered.breakdown[1].score, 1);
});
