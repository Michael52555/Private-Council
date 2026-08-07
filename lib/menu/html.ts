import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { inferProvider, makeOrderingSource } from "@/lib/menu/providers";
import type { MenuAdapterId } from "@/lib/menu/adapters";
import type { CapturedJsonPayload, MenuItem, OrderingSource } from "@/lib/menu/types";

type JsonObject = Record<string, unknown>;

export type HtmlMenuExtraction = {
  items: MenuItem[];
  methods: Set<"json_ld" | "embedded_json" | "dom">;
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function parsePrice(value: unknown, centsLikely = false): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    if (centsLikely && Number.isInteger(value) && value >= 100) return value / 100;
    return value;
  }

  if (typeof value !== "string") return undefined;
  const match = value.replace(/,/g, "").match(/(?:\$|USD\s*)?([0-9]+(?:\.[0-9]{1,2})?)/i);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function menuItemId(sourceId: string, name: string, section?: string, price?: number): string {
  return createHash("sha256")
    .update(`${sourceId}|${section ?? ""}|${name}|${price ?? ""}`.toLowerCase())
    .digest("hex")
    .slice(0, 20);
}

function makeMenuItem(input: {
  sourceId: string;
  name?: string;
  description?: string;
  section?: string;
  price?: number;
  currency?: string;
  imageUrl?: string;
}): MenuItem | null {
  const name = input.name?.replace(/\s+/g, " ").trim();
  if (!name || name.length > 180) return null;

  return {
    id: menuItemId(input.sourceId, name, input.section, input.price),
    name,
    ...(input.description ? { description: input.description.replace(/\s+/g, " ").trim() } : {}),
    ...(input.section ? { section: input.section.replace(/\s+/g, " ").trim() } : {}),
    ...(typeof input.price === "number" ? { price: Math.round(input.price * 100) / 100 } : {}),
    ...(input.currency ? { currency: input.currency } : {}),
    ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
    sourceId: input.sourceId,
  };
}

function typeIncludes(node: JsonObject, typeName: string): boolean {
  const type = node["@type"];
  return typeof type === "string"
    ? type.toLowerCase() === typeName.toLowerCase()
    : Array.isArray(type) && type.some((entry) => typeof entry === "string" && entry.toLowerCase() === typeName.toLowerCase());
}

function ldOffer(node: JsonObject): { price?: number; currency?: string } {
  const rawOffers = node.offers;
  const offer = Array.isArray(rawOffers) ? rawOffers.find(isObject) : isObject(rawOffers) ? rawOffers : undefined;
  if (!offer) return {};
  return {
    price: parsePrice(offer.price ?? offer.lowPrice ?? offer.highPrice),
    currency: firstString(offer.priceCurrency),
  };
}

function walkJsonLd(value: unknown, sourceId: string, items: MenuItem[], section?: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => walkJsonLd(entry, sourceId, items, section));
    return;
  }
  if (!isObject(value)) return;

  const currentSection = typeIncludes(value, "MenuSection")
    ? firstString(value.name, value.headline) ?? section
    : section;

  if (typeIncludes(value, "MenuItem")) {
    const offer = ldOffer(value);
    const item = makeMenuItem({
      sourceId,
      name: firstString(value.name, value.headline),
      description: firstString(value.description),
      section: currentSection,
      price: offer.price,
      currency: offer.currency,
      imageUrl: firstString(value.image, isObject(value.image) ? value.image.url : undefined),
    });
    if (item) items.push(item);
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "offers" || key === "image") continue;
    walkJsonLd(child, sourceId, items, currentSection);
  }
}

function embeddedPrice(node: JsonObject): { price?: number; currency?: string } {
  const firstLevelPriceContainers = [node.priceInfo, node.price_info, node.money, node.basePriceMoney]
    .filter(isObject);
  const priceContainers = [
    ...firstLevelPriceContainers,
    ...firstLevelPriceContainers.flatMap((container) => [
      container.money,
      container.basePriceMoney,
      container.price,
    ]).filter(isObject),
  ];
  const priceNodes = [node, ...priceContainers];

  for (const priceNode of priceNodes) {
    for (const key of [
      "displayPrice",
      "priceText",
      "formattedPrice",
      "basePrice",
      "startingPrice",
      "menuItemPrice",
      "unitPrice",
      "price",
      "cost",
      "amount",
      "unitAmount",
      "cents",
    ]) {
      const value = priceNode[key];
      if (isObject(value)) {
        const rawAmount = value.unitAmount ?? value.amount ?? value.value ?? value.cents;
        const price = parsePrice(rawAmount, true);
        if (price !== undefined) {
          return {
            price,
            currency: firstString(
              value.currencyCode,
              value.currency,
              priceNode.currencyCode,
              node.currencyCode,
            ),
          };
        }
      }
      const centsLikely = !["displayPrice", "priceText", "formattedPrice"].includes(key);
      const price = parsePrice(value, centsLikely);
      if (price !== undefined) {
        return {
          price,
          currency: firstString(priceNode.currencyCode, priceNode.currency, node.currencyCode, node.currency),
        };
      }
    }
  }
  return {};
}

function walkEmbeddedJson(
  value: unknown,
  sourceId: string,
  items: MenuItem[],
  seen: WeakSet<object>,
  depth = 0,
  section?: string,
): void {
  if (depth > 24 || items.length >= 750) return;
  if (Array.isArray(value)) {
    value.forEach((entry) => walkEmbeddedJson(entry, sourceId, items, seen, depth + 1, section));
    return;
  }
  if (!isObject(value) || seen.has(value)) return;
  seen.add(value);

  const name = firstString(
    value.name,
    value.displayName,
    value.display_name,
    value.itemName,
    value.productName,
    value.title,
  );
  const price = embeddedPrice(value);
  const looksLikeItem = name && price.price !== undefined && !/subtotal|delivery fee|service fee|tax|total|minimum order/i.test(name);

  if (looksLikeItem) {
    const item = makeMenuItem({
      sourceId,
      name,
      description: firstString(value.description, value.subtitle),
      section,
      price: price.price,
      currency: price.currency,
      imageUrl: firstString(value.imageUrl, value.image_url),
    });
    if (item) items.push(item);
  }

  const possibleSection = !looksLikeItem && name && Object.keys(value).some((key) => /items|products|children/i.test(key))
    ? name
    : section;

  Object.values(value).forEach((child) =>
    walkEmbeddedJson(child, sourceId, items, seen, depth + 1, possibleSection),
  );
}

function domText($element: cheerio.Cheerio<AnyNode>, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const value = $element.find(selector).first().text().replace(/\s+/g, " ").trim();
    if (value) return value;
  }
  return undefined;
}

function dedupeItems(items: MenuItem[]): MenuItem[] {
  const byIdentity = new Map<string, MenuItem>();
  for (const item of items) {
    const key = `${item.sourceId}|${item.name}|${item.price ?? ""}`.toLowerCase();
    const existing = byIdentity.get(key);
    if (!existing) {
      byIdentity.set(key, item);
      continue;
    }

    const existingDetail = Number(Boolean(existing.section)) + Number(Boolean(existing.description));
    const nextDetail = Number(Boolean(item.section)) + Number(Boolean(item.description));
    if (nextDetail > existingDetail) byIdentity.set(key, item);
  }
  return [...byIdentity.values()];
}

export function extractMenuFromHtml(
  html: string,
  source: OrderingSource,
): HtmlMenuExtraction {
  const $ = cheerio.load(html);
  const items: MenuItem[] = [];
  const methods = new Set<"json_ld" | "embedded_json" | "dom">();

  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const value = JSON.parse($(element).text()) as unknown;
      const before = items.length;
      walkJsonLd(value, source.id, items);
      if (items.length > before) methods.add("json_ld");
    } catch {
      // A malformed JSON-LD block should not prevent other extraction methods.
    }
  });

  const embeddedJsonSelector =
    inferProvider(source.url).provider === "restaurant_website"
      ? "script#__NEXT_DATA__"
      : 'script#__NEXT_DATA__, script[type="application/json"]';

  $(embeddedJsonSelector).each((_, element) => {
      const text = $(element).text();
      if (!text || text.length > 2_500_000) return;
      try {
        const value = JSON.parse(text) as unknown;
        const before = items.length;
        walkEmbeddedJson(value, source.id, items, new WeakSet<object>());
        if (items.length > before) methods.add("embedded_json");
      } catch {
        // Continue with DOM extraction.
      }
  });

  const itemSelectors = [
    '[itemtype$="MenuItem"]',
    "[data-menu-item]",
    '[data-testid*="menu-item"]',
    ".menu-item",
    ".menuItem",
  ].join(",");

  $(itemSelectors).each((_, element) => {
    const $item = $(element);
    const name = domText($item, ['[itemprop="name"]', "[data-item-name]", ".item-name", ".menu-item-name", "h2", "h3", "h4"]);
    const priceText = domText($item, ['[itemprop="price"]', "[data-price]", ".price", '.menu-item-price', '[class*="price"]']);
    const section = $item.closest("section, [data-menu-section], .menu-section").find("h2, h3").first().text().trim() || undefined;
    const item = makeMenuItem({
      sourceId: source.id,
      name,
      description: domText($item, ['[itemprop="description"]', ".description", '.menu-item-description', "p"]),
      section,
      price: parsePrice(priceText),
      currency: priceText?.includes("$") ? "USD" : undefined,
      imageUrl: $item.find("img").first().attr("src"),
    });
    if (item) {
      items.push(item);
      methods.add("dom");
    }
  });

  return { items: dedupeItems(items).slice(0, 750), methods };
}

export function extractMenuFromJsonPayloads(
  payloads: Array<unknown | CapturedJsonPayload>,
  source: OrderingSource,
  adapterId?: MenuAdapterId,
): HtmlMenuExtraction {
  const items: MenuItem[] = [];
  for (const payload of payloads) {
    const data = isObject(payload) && "data" in payload && "url" in payload
      ? payload.data
      : payload;
    walkEmbeddedJson(data, source.id, items, new WeakSet<object>());
    if (items.length >= 750) break;
  }

  const providerFilteredItems = adapterId
    ? items.filter((item) => {
        if (/^(?:add|choose|select|remove|no |extra )/i.test(item.name)) return false;
        if (/utensils?|napkins?|cutlery|special instructions?/i.test(item.name)) return false;
        return true;
      })
    : items;
  return {
    items: dedupeItems(providerFilteredItems).slice(0, 750),
    methods: providerFilteredItems.length > 0
      ? new Set(["embedded_json"] as const)
      : new Set<"json_ld" | "embedded_json" | "dom">(),
  };
}

export function discoverOrderLinksFromHtml(
  html: string,
  baseUrl: string,
): OrderingSource[] {
  const $ = cheerio.load(html);
  const sources: OrderingSource[] = [];
  const orderText = /order|menu|pickup|pick-up|delivery|takeout|在线订餐|订餐|菜单|外带|外送/i;

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    try {
      const url = new URL(href, baseUrl);
      if (url.protocol !== "https:") return;
      const text = `${$(element).text()} ${$(element).attr("aria-label") ?? ""}`.trim();
      const knownProvider = inferProvider(url.toString()).provider !== "restaurant_website";
      if (!knownProvider && !orderText.test(text) && !/\/menu|\/order/i.test(url.pathname)) return;
      sources.push(makeOrderingSource({ url: url.toString(), text, discoveredFrom: "restaurant_website" }));
    } catch {
      // Ignore malformed links.
    }
  });

  return sources;
}
