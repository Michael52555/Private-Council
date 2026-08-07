import assert from "node:assert/strict";
import test from "node:test";
import { googleBudgetEstimate } from "@/lib/budget-estimate";

test("prefers Google's numeric price range over the price-level heuristic", () => {
  const estimate = googleBudgetEstimate({
    priceRange: {
      startPrice: { currencyCode: "USD", units: "10" },
      endPrice: { currencyCode: "USD", units: "20", nanos: 500_000_000 },
    },
    priceLevel: "PRICE_LEVEL_EXPENSIVE",
  });

  assert.deepEqual(estimate, {
    minimum: 10,
    maximum: 20.5,
    midpoint: 15.25,
    currency: "USD",
    source: "google_price_range",
    confidence: "medium",
  });
});

test("uses a broad low-confidence band when only Google priceLevel is available", () => {
  assert.deepEqual(
    googleBudgetEstimate({ priceLevel: "PRICE_LEVEL_MODERATE" }),
    {
      minimum: 15,
      maximum: 40,
      midpoint: 27.5,
      currency: "USD",
      source: "google_price_level",
      confidence: "low",
    },
  );
});

test("does not invent a numeric estimate without usable Google price data", () => {
  assert.equal(googleBudgetEstimate({}).source, "unavailable");
  assert.equal(googleBudgetEstimate({}).minimum, null);
});
