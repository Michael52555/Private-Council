import { isBrowserConfigured, renderPublicPage } from "@/lib/menu/browser";
import { extractMenuFromHtml } from "@/lib/menu/html";
import { isKnownDynamicProvider } from "@/lib/menu/providers";
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

export async function extractMenuFromSource(source: OrderingSource): Promise<ExtractedMenu> {
  const warnings: string[] = [];
  let html = "";

  try {
    ({ html } = await fetchPublicHtml(source.url));
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Direct page fetch failed.");
  }

  let extraction = extractMenuFromHtml(html, source);

  if (extraction.items.length === 0 && isBrowserConfigured()) {
    try {
      const rendered = await renderPublicPage(source.url);
      extraction = extractMenuFromHtml(rendered.html, source);
    } catch (error) {
      warnings.push(
        error instanceof Error ? `Rendered-page extraction failed: ${error.message}` : "Rendered-page extraction failed.",
      );
    }
  } else if (
    extraction.items.length === 0 &&
    isKnownDynamicProvider(source.provider) &&
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
    warnings,
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

  // Keep browser-heavy providers sequential so one request does not fan out into
  // several Chromium sessions at once.
  for (const source of input.sources.slice(0, 5)) {
    const menu = await extractMenuFromSource(source);
    menus.push(menu);

    const pricedItemCount = menu.items.filter(
      (item) => typeof item.price === "number",
    ).length;

    // One reliable ordering source is enough to price this restaurant. Keep
    // the remaining discovered URLs as sources, but avoid rendering redundant
    // provider copies of the same menu.
    if (pricedItemCount >= 3) {
      break;
    }
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
