import { isBrowserConfigured, renderPublicPage } from "@/lib/menu/browser";
import {
  extractMenuFromHtml,
  extractMenuFromJsonPayloads,
  type HtmlMenuExtraction,
} from "@/lib/menu/html";
import { menuAdapterForUrl } from "@/lib/menu/adapters";
import { fetchPublicHtml } from "@/lib/menu/security";
import type {
  ExtractedMenu,
  MenuItem,
  OrderingSource,
  RestaurantMenuResult,
} from "@/lib/menu/types";

function extractionMethod(
  methods: Set<"json_ld" | "embedded_json" | "dom">,
): ExtractedMenu["extractionMethod"] {
  if (methods.size === 0) return "none";
  if (methods.size > 1) return "mixed";
  return [...methods][0];
}

function mergeExtractions(
  extractions: HtmlMenuExtraction[],
): HtmlMenuExtraction {
  const methods = new Set<"json_ld" | "embedded_json" | "dom">();
  const itemsByIdentity = new Map<string, MenuItem>();
  for (const extraction of extractions) {
    extraction.methods.forEach((method) => methods.add(method));
    for (const item of extraction.items) {
      const key = `${item.name}|${item.price ?? ""}`.toLowerCase();
      const existing = itemsByIdentity.get(key);
      if (!existing || (!existing.description && item.description)) {
        itemsByIdentity.set(key, item);
      }
    }
  }
  return { items: [...itemsByIdentity.values()].slice(0, 750), methods };
}

export async function extractMenuFromSource(source: OrderingSource): Promise<ExtractedMenu> {
  const warnings: string[] = [];
  const adapter = menuAdapterForUrl(source.url);
  if (!adapter) {
    return {
      source,
      items: [],
      extractionMethod: "none",
      fetchedAt: new Date().toISOString(),
      warnings: ["No supported menu scraper adapter matches this provider URL."],
    };
  }

  let html = "";

  try {
    ({ html } = await fetchPublicHtml(source.url));
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Direct page fetch failed.");
  }

  let extraction = extractMenuFromHtml(html, source);

  if (
    isBrowserConfigured() &&
    (extraction.items.length === 0 || adapter.captureNetworkJson)
  ) {
    try {
      const rendered = await renderPublicPage(source.url);
      extraction = mergeExtractions([
        extraction,
        extractMenuFromHtml(rendered.html, source),
        extractMenuFromJsonPayloads(rendered.jsonPayloads, source),
      ]);
    } catch (error) {
      warnings.push(
        error instanceof Error ? `Rendered-page extraction failed: ${error.message}` : "Rendered-page extraction failed.",
      );
    }
  } else if (
    extraction.items.length === 0 &&
    adapter.captureNetworkJson &&
    !isBrowserConfigured()
  ) {
    warnings.push(
      "This provider renders its menu dynamically. Configure PLAYWRIGHT_WS_ENDPOINT or PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to extract it.",
    );
  }

  if (extraction.items.length === 0) warnings.push("No menu items were recognized on this source.");

  return {
    source,
    items: extraction.items,
    extractionMethod: extractionMethod(extraction.methods),
    fetchedAt: new Date().toISOString(),
    warnings: [`Scraper adapter: ${adapter.label}`, ...warnings],
  };
}

function summarizePrices(items: MenuItem[]): RestaurantMenuResult["priceSummary"] {
  const pricedItems = items
    .filter((item): item is MenuItem & { price: number } => typeof item.price === "number")
    .sort((a, b) => a.price - b.price);

  if (pricedItems.length === 0) {
    return {
      minimum: null,
      maximum: null,
      lowerQuartile: null,
      upperQuartile: null,
      median: null,
      currency: null,
    };
  }

  const middle = Math.floor(pricedItems.length / 2);
  const median =
    pricedItems.length % 2 === 0
      ? (pricedItems[middle - 1].price + pricedItems[middle].price) / 2
      : pricedItems[middle].price;
  const currencies = pricedItems.map((item) => item.currency).filter(Boolean);

  return {
    minimum: pricedItems[0].price,
    maximum: pricedItems[pricedItems.length - 1].price,
    lowerQuartile: pricedItems[Math.floor((pricedItems.length - 1) * 0.25)].price,
    upperQuartile: pricedItems[Math.floor((pricedItems.length - 1) * 0.75)].price,
    median: Math.round(median * 100) / 100,
    currency: (currencies[0] as string | undefined) ?? null,
  };
}

export async function extractRestaurantMenus(input: {
  placeId: string;
  restaurantName?: string;
  sources: OrderingSource[];
}): Promise<RestaurantMenuResult> {
  const menus: ExtractedMenu[] = [];
  const primarySource = input.sources[0];

  // Discovery has already selected the first top-to-bottom provider with a
  // registered scraper adapter. Never fall through to a second source here.
  if (primarySource) {
    menus.push(await extractMenuFromSource(primarySource));
  }

  const items = menus.flatMap((menu) => menu.items);
  return {
    placeId: input.placeId,
    restaurantName: input.restaurantName,
    menus,
    items,
    priceSummary: summarizePrices(items),
  };
}
