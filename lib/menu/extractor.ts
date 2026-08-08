import { isBrowserConfigured, renderPublicPage } from "@/lib/menu/browser";
import {
  extractMenuFromHtml,
  extractMenuFromJsonPayloads,
  type HtmlMenuExtraction,
} from "@/lib/menu/html";
import { menuAdapterForUrl } from "@/lib/menu/adapters";
import { summarizeTypicalMealPrices } from "@/lib/menu/meal-estimate";
import {
  extractProviderMenuFromHtml,
  extractProviderMenuFromJson,
} from "@/lib/menu/provider-parsers";
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

export async function extractMenuFromSource(
  source: OrderingSource,
  context: { restaurantAddress?: string } = {},
): Promise<ExtractedMenu> {
  const warnings: string[] = [];
  const directFetchWarnings: string[] = [];
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
    directFetchWarnings.push(error instanceof Error ? error.message : "Direct page fetch failed.");
  }

  const directProviderExtraction = extractProviderMenuFromHtml(
    html,
    source,
    adapter.id,
  );
  let extraction = directProviderExtraction.items.length >= 3
    ? directProviderExtraction
    : extractMenuFromHtml(html, source);

  if (
    isBrowserConfigured() &&
    (extraction.items.length === 0 || adapter.captureNetworkJson)
  ) {
    try {
      const rendered = await renderPublicPage(source.url, {
        adapterId: adapter.id,
        restaurantAddress: context.restaurantAddress,
      });
      const providerJsonExtraction = extractProviderMenuFromJson(
        rendered.jsonPayloads,
        source,
        adapter.id,
      );
      const renderedProviderExtraction = extractProviderMenuFromHtml(
        rendered.html,
        source,
        adapter.id,
      );
      const renderedHtmlExtraction = renderedProviderExtraction.items.length >= 3
        ? renderedProviderExtraction
        : extractMenuFromHtml(rendered.html, source);
      extraction = providerJsonExtraction.items.length >= 3
        ? providerJsonExtraction
        : mergeExtractions([
            extraction,
            renderedHtmlExtraction,
            extractMenuFromJsonPayloads(rendered.jsonPayloads, source, adapter.id),
          ]);
      if (rendered.diagnostics.navigationStatus && rendered.diagnostics.navigationStatus >= 400) {
        warnings.push(`Browser navigation returned HTTP ${rendered.diagnostics.navigationStatus}.`);
      }
      if (rendered.diagnostics.blockedResponseCount > 0) {
        warnings.push(
          `${rendered.diagnostics.blockedResponseCount} provider response${rendered.diagnostics.blockedResponseCount === 1 ? " was" : "s were"} blocked (HTTP 401/403/429)${rendered.diagnostics.blockedResponseEndpoints.length > 0 ? `: ${rendered.diagnostics.blockedResponseEndpoints.slice(0, 3).join(", ")}` : ""}.`,
        );
      }
      if (
        rendered.diagnostics.locationSelectionAttempted &&
        !rendered.diagnostics.locationSelectionSucceeded
      ) {
        warnings.push("A location prompt was found, but the restaurant location could not be selected automatically.");
      }
      if (rendered.diagnostics.capturedJsonResponseCount > 0 && extraction.items.length === 0) {
        warnings.push(
          `${rendered.diagnostics.capturedJsonResponseCount} menu-like JSON response${rendered.diagnostics.capturedJsonResponseCount === 1 ? " was" : "s were"} captured, but this provider schema is not recognized yet${rendered.diagnostics.capturedJsonEndpoints.length > 0 ? `: ${rendered.diagnostics.capturedJsonEndpoints.slice(0, 3).join(", ")}` : ""}.`,
        );
      }
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

  if (extraction.items.length === 0) {
    warnings.push(...directFetchWarnings);
    warnings.push("No menu items were recognized on this source.");
  }

  return {
    source,
    items: extraction.items,
    extractionMethod: extractionMethod(extraction.methods),
    fetchedAt: new Date().toISOString(),
    warnings: [`Scraper adapter: ${adapter.label}`, ...warnings],
  };
}

export async function extractMenusWithFallback(
  sources: OrderingSource[],
  context: { restaurantAddress?: string } = {},
  extractSource: (
    source: OrderingSource,
    context: { restaurantAddress?: string },
  ) => Promise<ExtractedMenu> = extractMenuFromSource,
): Promise<ExtractedMenu[]> {
  const menus: ExtractedMenu[] = [];
  for (const [sourceIndex, source] of sources.slice(0, 3).entries()) {
    const menu = await extractSource(source, context);
    const mealSummary = summarizeTypicalMealPrices(menu.items);
    const hasReliablePriceSample = mealSummary.sampleItemCount >= 3;
    if (sourceIndex > 0 && hasReliablePriceSample) {
      menu.warnings.unshift(
        `Fallback provider used after ${sourceIndex} higher-listed source${sourceIndex === 1 ? "" : "s"} returned no reliable menu prices.`,
      );
    }
    menus.push(menu);
    if (hasReliablePriceSample) break;
  }
  return menus;
}

export async function extractRestaurantMenus(input: {
  placeId: string;
  restaurantName?: string;
  restaurantAddress?: string;
  sources: OrderingSource[];
}): Promise<RestaurantMenuResult> {
  const menus = await extractMenusWithFallback(input.sources, {
    restaurantAddress: input.restaurantAddress,
  });

  const items = menus.flatMap((menu) => menu.items);
  return {
    placeId: input.placeId,
    restaurantName: input.restaurantName,
    menus,
    items,
    priceSummary: summarizeTypicalMealPrices(items),
  };
}
