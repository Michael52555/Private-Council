type RestaurantCandidateIdentity = {
  id: string;
};

export const nearestRestaurantCandidateQuota = 50;
export const preferredRestaurantCandidateQuota = 50;
export const restaurantCandidatePoolLimit = 100;

const googleTextSearchPageSize = 20;
const googleTextSearchMaximumResults = 60;

export function preferenceSearchResultTarget(preferenceCount: number): number {
  if (preferenceCount <= 0) return 0;
  return Math.min(
    googleTextSearchMaximumResults,
    Math.max(googleTextSearchPageSize, Math.ceil(75 / preferenceCount)),
  );
}

export function roundRobinRestaurantPools<T>(pools: readonly (readonly T[])[]): T[] {
  const merged: T[] = [];
  const maximumPoolLength = Math.max(0, ...pools.map((pool) => pool.length));
  for (let index = 0; index < maximumPoolLength; index += 1) {
    for (const pool of pools) {
      const candidate = pool[index];
      if (candidate !== undefined) merged.push(candidate);
    }
  }
  return merged;
}

type RestaurantCandidatePools<T extends RestaurantCandidateIdentity> = {
  nearest: readonly T[];
  preferred: readonly T[];
  general: readonly T[];
  limit?: number;
  nearestQuota?: number;
  preferredQuota?: number;
};

export function mergeRestaurantCandidatePools<
  T extends RestaurantCandidateIdentity,
>({
  nearest,
  preferred,
  general,
  limit = restaurantCandidatePoolLimit,
  nearestQuota = nearestRestaurantCandidateQuota,
  preferredQuota = preferredRestaurantCandidateQuota,
}: RestaurantCandidatePools<T>): T[] {
  if (limit <= 0) return [];

  const candidates: T[] = [];
  const seenPlaceIds = new Set<string>();

  function addFromPool(pool: readonly T[], maximumAdditions = Infinity): void {
    let additions = 0;
    for (const candidate of pool) {
      if (candidates.length >= limit || additions >= maximumAdditions) return;
      if (!candidate.id || seenPlaceIds.has(candidate.id)) continue;
      seenPlaceIds.add(candidate.id);
      candidates.push(candidate);
      additions += 1;
    }
  }

  // The first quota is intentionally distance-ranked so nearby restaurants
  // cannot disappear behind a popularity- or preference-ranked search.
  addFromPool(nearest, Math.min(nearestQuota, limit));

  // Scan past duplicates so this quota means "new preference candidates",
  // not merely the first N items returned by Google.
  addFromPool(preferred, Math.min(preferredQuota, limit - candidates.length));

  // Fill unused quota deterministically: more nearby choices first, then the
  // remaining preference results, and finally a broad popularity pool.
  addFromPool(nearest);
  addFromPool(preferred);
  addFromPool(general);

  return candidates;
}
