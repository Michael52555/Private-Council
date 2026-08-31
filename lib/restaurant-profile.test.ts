import assert from "node:assert/strict";
import test from "node:test";
import type { RestaurantCandidate } from "@/lib/planning-types";
import { activeFoodTypes, buildRestaurantFoodVector } from "@/lib/restaurant-food-vector";
import {
  applyRestaurantProfile,
  parseRestaurantApiProfile,
  parseRestaurantApiProfileBatch,
  restrictRestaurantProfileToWebSources,
  type RestaurantApiProfile,
  type RestaurantProfileInput,
} from "@/lib/restaurant-profile";

function evidence(foodType: "hot_pot" | "chinese" | "pizza") {
  return {
    foodType,
    evidenceKind: "official_menu" as const,
    sourceUrl: "https://example.com/menu",
    reason: "The official menu has a substantial section devoted to this food type.",
    mainEntries: ["Signature main one", "Signature main two"],
  };
}

function candidate(overrides: Partial<RestaurantCandidate> = {}): RestaurantCandidate {
  return {
    id: "place-1",
    name: "Example Hot Pot",
    address: "123 Main St, Los Angeles, CA",
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
    foodTypeVector: buildRestaurantFoodVector({ primaryType: "hot_pot_restaurant" }),
    foodTypeEstimateSource: "google_types_fallback",
    foodTypeEstimateConfidence: "medium",
    primaryType: "hot_pot_restaurant",
    placeTypes: ["restaurant", "food"],
    orderingSources: [],
    ...overrides,
  };
}

const input: RestaurantProfileInput = {
  placeId: "place-1",
  name: "Example Hot Pot",
  address: "123 Main St, Los Angeles, CA",
  primaryType: "hot_pot_restaurant",
  placeTypes: ["restaurant", "food"],
};

test("parses controlled multi-tag API profiles and normalized price ranges", () => {
  const parsed = parseRestaurantApiProfile({
    placeId: "place-1",
    foodTypes: ["hot_pot", "chinese", "hot_pot"],
    labelEvidence: [evidence("hot_pot"), evidence("chinese")],
    typeConfidence: "high",
    estimatedPriceMin: 24.123,
    estimatedPriceMax: 43.456,
    priceConfidence: "medium",
  }, new Set(["place-1"]));

  assert.deepEqual(parsed, {
    placeId: "place-1",
    foodTypes: ["hot_pot", "chinese"],
    labelEvidence: [evidence("hot_pot"), evidence("chinese")],
    typeConfidence: "high",
    estimatedPriceMin: 24.12,
    estimatedPriceMax: 43.46,
    priceConfidence: "medium",
  });
});

test("rejects unknown places, uncontrolled tags, and reversed price ranges", () => {
  assert.equal(parseRestaurantApiProfile({
    placeId: "other-place",
    foodTypes: ["hot_pot"],
    labelEvidence: [evidence("hot_pot")],
    typeConfidence: "high",
    estimatedPriceMin: 20,
    estimatedPriceMax: 40,
    priceConfidence: "medium",
  }, new Set(["place-1"])), null);
  assert.equal(parseRestaurantApiProfile({
    placeId: "place-1",
    foodTypes: ["invented_cuisine"],
    labelEvidence: [],
    typeConfidence: "high",
    estimatedPriceMin: 20,
    estimatedPriceMax: 40,
    priceConfidence: "medium",
  }), null);
  assert.equal(parseRestaurantApiProfile({
    placeId: "place-1",
    foodTypes: ["hot_pot"],
    labelEvidence: [evidence("hot_pot")],
    typeConfidence: "high",
    estimatedPriceMin: 50,
    estimatedPriceMax: 20,
    priceConfidence: "medium",
  }), null);
});

test("accepts valid batch entries independently and ignores malformed siblings", () => {
  const profiles = parseRestaurantApiProfileBatch({
    profiles: [
      {
        placeId: "place-1",
        foodTypes: ["hot_pot"],
        labelEvidence: [evidence("hot_pot")],
        typeConfidence: "high",
        estimatedPriceMin: 25,
        estimatedPriceMax: 45,
        priceConfidence: "medium",
      },
      {
        placeId: "unknown-place",
        foodTypes: ["pizza"],
        labelEvidence: [evidence("pizza")],
        typeConfidence: "high",
        estimatedPriceMin: 10,
        estimatedPriceMax: 20,
        priceConfidence: "high",
      },
    ],
  }, [input]);

  assert.deepEqual([...profiles.keys()], ["place-1"]);
});

test("applies API tags and price while marking profiling complete", () => {
  const apiProfile: RestaurantApiProfile = {
    placeId: "place-1",
    foodTypes: ["hot_pot", "chinese"],
    labelEvidence: [evidence("hot_pot"), evidence("chinese")],
    typeConfidence: "high",
    estimatedPriceMin: 25,
    estimatedPriceMax: 45,
    priceConfidence: "medium",
  };
  const resolved = applyRestaurantProfile(candidate(), apiProfile);

  assert.deepEqual(activeFoodTypes(resolved.foodTypeVector), ["chinese", "hot_pot"]);
  assert.equal(resolved.foodTypeEstimateSource, "api_profile");
  assert.equal(resolved.budgetEstimateSource, "api_profile");
  assert.equal(resolved.pricePerPerson, 35);
  assert.equal(resolved.menuStatus, "loaded");
  assert.deepEqual(resolved.orderingSources, []);
  assert.deepEqual(resolved.foodTypeEvidence, apiProfile.labelEvidence);
});

test("treats a successful empty API label set as authoritative", () => {
  const resolved = applyRestaurantProfile(candidate(), {
    placeId: "place-1",
    foodTypes: [],
    labelEvidence: [],
    typeConfidence: "medium",
    estimatedPriceMin: 20,
    estimatedPriceMax: 35,
    priceConfidence: "medium",
  });

  assert.deepEqual(activeFoodTypes(resolved.foodTypeVector), []);
  assert.equal(resolved.foodTypeEstimateSource, "api_profile");
  assert.deepEqual(resolved.foodTypeEvidence, []);
});

test("drops labels whose claimed URL was not consulted by web search", () => {
  const profile: RestaurantApiProfile = {
    placeId: "place-1",
    foodTypes: ["hot_pot", "chinese"],
    labelEvidence: [evidence("hot_pot"), {
      ...evidence("chinese"),
      sourceUrl: "https://unrelated.example/menu",
    }],
    typeConfidence: "high",
    estimatedPriceMin: 25,
    estimatedPriceMax: 45,
    priceConfidence: "medium",
  };

  const restricted = restrictRestaurantProfileToWebSources(
    profile,
    new Set(["https://example.com/menu?location=1"]),
  );
  assert.deepEqual(restricted.foodTypes, ["hot_pot"]);
  assert.deepEqual(
    restricted.labelEvidence.map((entry) => entry.foodType),
    ["hot_pot"],
  );
  assert.equal(restricted.typeConfidence, "low");
});

test("falls back to Google evidence, then a broad deterministic category band", () => {
  const googleResolved = applyRestaurantProfile(candidate({
    googleEstimatedPriceMin: 20,
    googleEstimatedPriceMax: 50,
    googleEstimatedPriceMidpoint: 35,
    googleBudgetEstimateSource: "google_price_range",
    googleBudgetEstimateConfidence: "medium",
    googleBudgetEstimateCurrency: "USD",
  }));
  assert.equal(googleResolved.budgetEstimateSource, "google_price_range");
  assert.equal(googleResolved.pricePerPerson, 35);
  assert.equal(googleResolved.foodTypeEstimateSource, "google_types_fallback");

  const heuristicResolved = applyRestaurantProfile(candidate());
  assert.equal(heuristicResolved.budgetEstimateSource, "heuristic_fallback");
  assert.equal(heuristicResolved.budgetEstimateConfidence, "low");
  assert.deepEqual(
    [heuristicResolved.estimatedPriceMin, heuristicResolved.estimatedPriceMax],
    [20, 55],
  );
});
