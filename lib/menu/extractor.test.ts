import assert from "node:assert/strict";
import test from "node:test";
import { extractMenusWithFallback } from "@/lib/menu/extractor";
import { makeOrderingSource } from "@/lib/menu/providers";
import type { ExtractedMenu, MenuItem, OrderingSource } from "@/lib/menu/types";

function menuFor(source: OrderingSource, prices: number[]): ExtractedMenu {
  return {
    source,
    items: prices.map((price, index): MenuItem => ({
      id: `${source.id}-${index}`,
      name: `Item ${index + 1}`,
      price,
      currency: "USD",
      sourceId: source.id,
    })),
    extractionMethod: prices.length > 0 ? "embedded_json" : "none",
    fetchedAt: new Date(0).toISOString(),
    warnings: prices.length > 0 ? [] : ["blocked"],
  };
}

test("falls back in provider order after the primary source has no reliable prices", async () => {
  const panda = makeOrderingSource({
    url: "https://www.pandaexpress.com/location",
    discoveredFrom: "google_maps",
  });
  const doordash = makeOrderingSource({
    url: "https://www.doordash.com/store/panda-123",
    discoveredFrom: "google_maps",
  });
  const grubhub = makeOrderingSource({
    url: "https://www.grubhub.com/restaurant/panda-123",
    discoveredFrom: "google_maps",
  });
  const called: string[] = [];

  const menus = await extractMenusWithFallback(
    [panda, doordash, grubhub],
    {},
    async (source) => {
      called.push(source.url);
      return source === doordash
        ? menuFor(source, [10, 11, 12])
        : menuFor(source, []);
    },
  );

  assert.deepEqual(called, [panda.url, doordash.url]);
  assert.equal(menus.length, 2);
  assert.match(menus[1].warnings[0], /Fallback provider used/);
});
