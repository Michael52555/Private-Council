import assert from "node:assert/strict";
import test from "node:test";
import { makeOrderingSource } from "@/lib/menu/providers";
import {
  summarizeProviderSurvey,
  upsertProviderSurveyObservation,
  type ProviderSurveyObservation,
} from "@/lib/menu/survey";

function observation(
  placeId: string,
  url: string | null,
): ProviderSurveyObservation {
  return {
    placeId,
    restaurantName: placeId,
    address: "Test address",
    primarySource: url
      ? makeOrderingSource({ url, discoveredFrom: "google_maps" })
      : null,
    observedAt: "2026-08-06T00:00:00.000Z",
  };
}

test("ranks one primary provider per restaurant", () => {
  const summary = summarizeProviderSurvey([
    observation("one", "https://www.doordash.com/store/one"),
    observation("two", "https://www.doordash.com/store/two"),
    observation("three", "https://order.toasttab.com/online/three"),
    observation("four", null),
  ]);

  assert.equal(summary.checkedRestaurantCount, 4);
  assert.equal(summary.restaurantWithSourceCount, 3);
  assert.equal(summary.coveragePercent, 75);
  assert.deepEqual(summary.providers, [
    { label: "DoorDash", restaurantCount: 2, shareOfResolvedPercent: 67 },
    { label: "Toast", restaurantCount: 1, shareOfResolvedPercent: 33 },
  ]);
});

test("a refreshed restaurant replaces its previous survey observation", () => {
  const initial = [observation("one", "https://www.doordash.com/store/one")];
  const updated = upsertProviderSurveyObservation(
    initial,
    observation("one", "https://order.toasttab.com/online/one"),
  );

  const summary = summarizeProviderSurvey(updated);
  assert.equal(summary.checkedRestaurantCount, 1);
  assert.deepEqual(summary.providers, [
    { label: "Toast", restaurantCount: 1, shareOfResolvedPercent: 100 },
  ]);
});
