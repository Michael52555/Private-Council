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

test("scores the budget only after menu-derived prices load", () => {
  const score = evaluateRestaurantScore(
    candidate({
      estimatedPriceMin: 20,
      estimatedPriceMax: 50,
      pricePerPerson: 35,
      menuStatus: "loaded",
      menuItemCount: 20,
    }),
    preferences,
  );

  assert.equal(score.breakdown[1].score, 25 / 30);
  assert.equal(score.totalScore, (1 + 25 / 30) / 2);
});
