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
      name: `Chicken Bowl ${index + 1}`,
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

test("tries Grubhub when DoorDash returns no menu prices", async () => {
  const doordash = makeOrderingSource({
    url: "https://www.doordash.com/store/example-123",
    discoveredFrom: "google_maps",
  });
  const grubhub = makeOrderingSource({
    url: "https://www.grubhub.com/restaurant/example-123",
    discoveredFrom: "google_maps",
  });
  const called: string[] = [];

  const menus = await extractMenusWithFallback(
    [doordash, grubhub],
    {},
    async (source) => {
      called.push(source.provider);
      return source === grubhub
        ? menuFor(source, [14, 16, 18])
        : menuFor(source, []);
    },
  );

  assert.deepEqual(called, ["doordash", "grubhub"]);
  assert.equal(menus.length, 2);
  assert.match(menus[1].warnings[0], /Fallback provider used/);
});

test("tries Grubhub when DoorDash extraction throws", async () => {
  const doordash = makeOrderingSource({
    url: "https://www.doordash.com/store/example-123",
    discoveredFrom: "google_maps",
  });
  const grubhub = makeOrderingSource({
    url: "https://www.grubhub.com/restaurant/example-123",
    discoveredFrom: "google_maps",
  });
  const called: string[] = [];

  const menus = await extractMenusWithFallback(
    [doordash, grubhub],
    {},
    async (source) => {
      called.push(source.provider);
      if (source === doordash) throw new Error("DoorDash verification blocked");
      return menuFor(source, [14, 16, 18]);
    },
  );

  assert.deepEqual(called, ["doordash", "grubhub"]);
  assert.equal(menus.length, 2);
  assert.match(menus[0].warnings[0], /DoorDash verification blocked/);
  assert.match(menus[1].warnings[0], /Fallback provider used/);
});

test("returns failed provider attempts so the caller can use budget fallback", async () => {
  const doordash = makeOrderingSource({
    url: "https://www.doordash.com/store/example-123",
    discoveredFrom: "google_maps",
  });
  const grubhub = makeOrderingSource({
    url: "https://www.grubhub.com/restaurant/example-123",
    discoveredFrom: "google_maps",
  });

  const menus = await extractMenusWithFallback(
    [doordash, grubhub],
    {},
    async (source) => {
      throw new Error(`${source.label} blocked`);
    },
  );

  assert.equal(menus.length, 2);
  assert.deepEqual(menus.map((menu) => menu.source.provider), [
    "doordash",
    "grubhub",
  ]);
  assert.ok(menus.every((menu) => menu.items.length === 0));
});
