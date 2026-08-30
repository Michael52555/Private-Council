import type { OrderingSource } from "@/lib/menu/types";

export type ProviderSurveyObservation = {
  placeId: string;
  restaurantName: string;
  address: string;
  primarySource: OrderingSource | null;
  observedAt: string;
};

export type ProviderSurveySummary = {
  checkedRestaurantCount: number;
  restaurantWithSourceCount: number;
  coveragePercent: number;
  providers: Array<{
    label: string;
    restaurantCount: number;
    shareOfResolvedPercent: number;
  }>;
};

export function orderingSourceHostname(source: OrderingSource): string {
  try {
    return new URL(source.url).hostname.replace(/^www\./, "");
  } catch {
    return source.label;
  }
}

export function orderingSourceInventoryLabel(source: OrderingSource): string {
  return source.provider === "restaurant_website" || source.provider === "unknown"
    ? orderingSourceHostname(source)
    : source.label;
}

export function upsertProviderSurveyObservation(
  observations: ProviderSurveyObservation[],
  observation: ProviderSurveyObservation,
): ProviderSurveyObservation[] {
  return [
    ...observations.filter((entry) => entry.placeId !== observation.placeId),
    observation,
  ];
}

export function summarizeProviderSurvey(
  observations: ProviderSurveyObservation[],
): ProviderSurveySummary {
  const latestByPlace = new Map<string, ProviderSurveyObservation>();
  for (const observation of observations) {
    latestByPlace.set(observation.placeId, observation);
  }

  const providerCounts = new Map<string, number>();
  let restaurantWithSourceCount = 0;
  for (const observation of latestByPlace.values()) {
    if (!observation.primarySource) continue;
    restaurantWithSourceCount += 1;
    const label = orderingSourceInventoryLabel(observation.primarySource);
    providerCounts.set(label, (providerCounts.get(label) ?? 0) + 1);
  }

  const checkedRestaurantCount = latestByPlace.size;
  return {
    checkedRestaurantCount,
    restaurantWithSourceCount,
    coveragePercent:
      checkedRestaurantCount === 0
        ? 0
        : Math.round((restaurantWithSourceCount / checkedRestaurantCount) * 100),
    providers: [...providerCounts.entries()]
      .map(([label, restaurantCount]) => ({
        label,
        restaurantCount,
        shareOfResolvedPercent:
          restaurantWithSourceCount === 0
            ? 0
            : Math.round((restaurantCount / restaurantWithSourceCount) * 100),
      }))
      .sort(
        (left, right) =>
          right.restaurantCount - left.restaurantCount ||
          left.label.localeCompare(right.label),
      ),
  };
}

