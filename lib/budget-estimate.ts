import type { BudgetEstimateConfidence, BudgetEstimateSource } from "@/lib/planning-types";

export type GoogleMoney = {
  currencyCode?: string;
  units?: string | number;
  nanos?: number;
};

export type GooglePriceRange = {
  startPrice?: GoogleMoney;
  endPrice?: GoogleMoney;
};

export type BudgetEstimate = {
  minimum: number | null;
  maximum: number | null;
  midpoint: number | null;
  currency: string | null;
  source: Extract<
    BudgetEstimateSource,
    "google_price_range" | "google_price_level" | "unavailable"
  >;
  confidence: BudgetEstimateConfidence;
};

const unavailableEstimate: BudgetEstimate = {
  minimum: null,
  maximum: null,
  midpoint: null,
  currency: null,
  source: "unavailable",
  confidence: "none",
};

// Google does not publish fixed dollar thresholds for priceLevel. These broad,
// overlapping US-dollar bands are deliberately conservative and are shown in
// the UI as low-confidence estimates rather than menu-derived prices.
const US_PRICE_LEVEL_BANDS: Record<string, readonly [number, number]> = {
  PRICE_LEVEL_FREE: [0, 0],
  PRICE_LEVEL_INEXPENSIVE: [1, 20],
  PRICE_LEVEL_MODERATE: [15, 40],
  PRICE_LEVEL_EXPENSIVE: [30, 80],
  PRICE_LEVEL_VERY_EXPENSIVE: [60, 150],
};

function moneyValue(money: GoogleMoney | undefined): number | null {
  if (!money) return null;
  const units = typeof money.units === "number"
    ? money.units
    : Number(money.units ?? "0");
  const nanos = money.nanos ?? 0;
  if (!Number.isFinite(units) || !Number.isFinite(nanos)) return null;
  const value = units + nanos / 1_000_000_000;
  return Number.isFinite(value) && value >= 0
    ? Math.round(value * 100) / 100
    : null;
}

export function googleBudgetEstimate(input: {
  priceRange?: GooglePriceRange;
  priceLevel?: string;
}): BudgetEstimate {
  const start = moneyValue(input.priceRange?.startPrice);
  const end = moneyValue(input.priceRange?.endPrice);
  const startCurrency = input.priceRange?.startPrice?.currencyCode;
  const endCurrency = input.priceRange?.endPrice?.currencyCode;
  const currency = startCurrency ?? endCurrency ?? null;

  if (
    start !== null &&
    end !== null &&
    end >= start &&
    (!startCurrency || !endCurrency || startCurrency === endCurrency)
  ) {
    return {
      minimum: start,
      maximum: end,
      midpoint: Math.round(((start + end) / 2) * 100) / 100,
      currency,
      source: "google_price_range",
      confidence: "medium",
    };
  }

  const band = input.priceLevel
    ? US_PRICE_LEVEL_BANDS[input.priceLevel]
    : undefined;
  if (!band) return unavailableEstimate;

  return {
    minimum: band[0],
    maximum: band[1],
    midpoint: Math.round(((band[0] + band[1]) / 2) * 100) / 100,
    currency: "USD",
    source: "google_price_level",
    confidence: "low",
  };
}
