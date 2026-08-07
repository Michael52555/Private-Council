import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { MenuAdapterId } from "@/lib/menu/adapters";
import type { HtmlMenuExtraction } from "@/lib/menu/html";
import type { CapturedJsonPayload, MenuItem, OrderingSource } from "@/lib/menu/types";

type JsonObject = Record<string, unknown>;

type ProviderSchema = {
  itemCollections: RegExp;
  sectionCollections: RegExp;
  ignoredCollections: RegExp;
};

const COMMON_IGNORED_COLLECTIONS = /modifier|customization|option|choice|add-?on|upsell|recommendation|comboStep/i;

const PROVIDER_SCHEMAS: Record<MenuAdapterId, ProviderSchema> = {
  doordash: {
    itemCollections: /^(?:items|menuItems|itemList|products|storeItems)$/i,
    sectionCollections: /^(?:menus|categories|menuCategories|sections)$/i,
    ignoredCollections: COMMON_IGNORED_COLLECTIONS,
  },
  ubereats: {
    itemCollections: /^(?:items|menuItems|catalogItems|products)$/i,
    sectionCollections: /^(?:menus|categories|sections|catalogSections)$/i,
    ignoredCollections: COMMON_IGNORED_COLLECTIONS,
  },
  grubhub: {
    itemCollections: /^(?:items|menuItems|products)$/i,
    sectionCollections: /^(?:menus|categories|sections|menuSections)$/i,
    ignoredCollections: COMMON_IGNORED_COLLECTIONS,
  },
  toast: {
    itemCollections: /^(?:items|menuItems|products|entries)$/i,
    sectionCollections: /^(?:menus|menuGroups|groups|categories|sections)$/i,
    ignoredCollections: COMMON_IGNORED_COLLECTIONS,
  },
  olo: {
    itemCollections: /^(?:products|items|menuItems)$/i,
    sectionCollections: /^(?:categories|menus|groups)$/i,
    ignoredCollections: COMMON_IGNORED_COLLECTIONS,
  },
  chownow: {
    itemCollections: /^(?:items|menuItems|products)$/i,
    sectionCollections: /^(?:menus|categories|sections)$/i,
    ignoredCollections: COMMON_IGNORED_COLLECTIONS,
  },
  square: {
    itemCollections: /^(?:items|menuItems|products|objects)$/i,
    sectionCollections: /^(?:menus|categories|sections)$/i,
    ignoredCollections: COMMON_IGNORED_COLLECTIONS,
  },
  clover: {
    itemCollections: /^(?:items|menuItems|products|elements)$/i,
    sectionCollections: /^(?:menus|categories|sections)$/i,
    ignoredCollections: COMMON_IGNORED_COLLECTIONS,
  },
  panda_express: {
    itemCollections: /^(?:items|menuItems|products|menuProducts)$/i,
    sectionCollections: /^(?:menus|categories|sections|mealTypes)$/i,
    ignoredCollections: COMMON_IGNORED_COLLECTIONS,
  },
  habit_burger: {
    itemCollections: /^(?:items|menuItems|products|menuProducts)$/i,
    sectionCollections: /^(?:menus|categories|sections|groups)$/i,
    ignoredCollections: COMMON_IGNORED_COLLECTIONS,
  },
  taco_bell: {
    itemCollections: /^(?:items|menuItems|products|menuProducts)$/i,
    sectionCollections: /^(?:menus|categories|sections|menuProductCategories)$/i,
    ignoredCollections: COMMON_IGNORED_COLLECTIONS,
  },
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function priceNumber(value: unknown, centsLikely = false): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return centsLikely && Number.isInteger(value) && value >= 100 ? value / 100 : value;
  }
  if (typeof value !== "string") return undefined;
  const match = value.replace(/,/g, "").match(/(?:\$|USD\s*)?([0-9]+(?:\.[0-9]{1,2})?)/i);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function providerPrice(node: JsonObject): { price?: number; currency?: string } {
  const containers: JsonObject[] = [node];
  for (const candidate of [node.priceInfo, node.price_info, node.money, node.basePriceMoney]) {
    if (isObject(candidate)) containers.push(candidate);
  }
  for (const container of [...containers]) {
    for (const child of [container.money, container.basePriceMoney]) {
      if (isObject(child)) containers.push(child);
    }
  }

  for (const container of containers) {
    for (const key of [
      "displayPrice",
      "formattedPrice",
      "priceText",
      "basePrice",
      "startingPrice",
      "menuItemPrice",
      "price",
      "cost",
      "unitAmount",
      "amount",
      "cents",
    ]) {
      const value = container[key];
      if (isObject(value)) {
        const nested = value.amount ?? value.unitAmount ?? value.value ?? value.cents;
        const price = priceNumber(nested, true);
        if (price !== undefined) {
          return {
            price,
            currency: firstString(value.currencyCode, value.currency, container.currencyCode, node.currencyCode),
          };
        }
      }
      const price = priceNumber(
        value,
        !["displayPrice", "formattedPrice", "priceText"].includes(key),
      );
      if (price !== undefined) {
        return {
          price,
          currency: firstString(container.currencyCode, container.currency, node.currencyCode, node.currency),
        };
      }
    }
  }
  return {};
}

function itemId(sourceId: string, name: string, section: string | undefined, price: number): string {
  return createHash("sha256")
    .update(`${sourceId}|${section ?? ""}|${name}|${price}`.toLowerCase())
    .digest("hex")
    .slice(0, 20);
}

function itemFromNode(
  node: JsonObject,
  sourceId: string,
  section?: string,
): MenuItem | undefined {
  const name = firstString(
    node.name,
    node.displayName,
    node.display_name,
    node.itemName,
    node.productName,
    node.title,
  )?.replace(/\s+/g, " ");
  if (!name || name.length > 180) return undefined;
  if (/subtotal|delivery fee|service fee|tax|total|minimum order/i.test(name)) return undefined;
  if (/^(?:add|choose|select|remove|no |extra )/i.test(name)) return undefined;
  if (/utensils?|napkins?|cutlery|special instructions?/i.test(name)) return undefined;

  const { price, currency } = providerPrice(node);
  if (price === undefined) return undefined;
  return {
    id: itemId(sourceId, name, section, price),
    name,
    ...(firstString(node.description, node.subtitle, node.shortDescription)
      ? { description: firstString(node.description, node.subtitle, node.shortDescription) }
      : {}),
    ...(section ? { section } : {}),
    price: Math.round(price * 100) / 100,
    ...(currency ? { currency } : {}),
    ...(firstString(node.imageUrl, node.image_url, node.imageUri)
      ? { imageUrl: firstString(node.imageUrl, node.image_url, node.imageUri) }
      : {}),
    sourceId,
  };
}

function walkProviderPayload(
  value: unknown,
  sourceId: string,
  schema: ProviderSchema,
  items: MenuItem[],
  seen: WeakSet<object>,
  context: { eligibleItem: boolean; section?: string; depth: number },
): void {
  if (context.depth > 28 || items.length >= 750) return;
  if (Array.isArray(value)) {
    for (const entry of value) {
      walkProviderPayload(entry, sourceId, schema, items, seen, {
        ...context,
        depth: context.depth + 1,
      });
    }
    return;
  }
  if (!isObject(value) || seen.has(value)) return;
  seen.add(value);

  if (context.eligibleItem) {
    const item = itemFromNode(value, sourceId, context.section);
    if (item) items.push(item);
  }

  const objectName = firstString(value.name, value.displayName, value.title);
  for (const [key, child] of Object.entries(value)) {
    if (schema.ignoredCollections.test(key)) continue;
    const section = (schema.itemCollections.test(key) || schema.sectionCollections.test(key)) && objectName
      ? objectName
      : context.section;
    walkProviderPayload(child, sourceId, schema, items, seen, {
      eligibleItem: schema.itemCollections.test(key) || context.eligibleItem,
      section,
      depth: context.depth + 1,
    });
  }
}

function dedupe(items: MenuItem[]): MenuItem[] {
  const byIdentity = new Map<string, MenuItem>();
  for (const item of items) {
    const key = `${item.name}|${item.price}`.toLowerCase();
    const existing = byIdentity.get(key);
    if (!existing || (!existing.description && item.description)) byIdentity.set(key, item);
  }
  return [...byIdentity.values()];
}

function extractGrubhubSemanticDom(
  html: string,
  source: OrderingSource,
): MenuItem[] {
  const $ = cheerio.load(html);
  const items: MenuItem[] = [];
  const nonItemHeading = /^(?:menu|delivery|pickup|reviews?|hours|faqs?|best sellers|start group order|see the full schedule)$/i;

  $("h3, h4, h5, h6, [role='heading']").each((_, element) => {
    const name = $(element).text().replace(/\s+/g, " ").trim();
    if (!name || name.length > 180 || nonItemHeading.test(name)) return;

    let container = $(element);
    let price: number | undefined;
    for (let depth = 0; depth < 6; depth += 1) {
      const text = container.text().replace(/\s+/g, " ");
      const prices = [...text.matchAll(/\$([0-9]+(?:\.[0-9]{2})?)(?:\+)?/g)];
      if (prices.length >= 1 && prices.length <= 2) {
        price = Number(prices[0][1]);
        break;
      }
      container = container.parent();
      if (container.length === 0) break;
    }
    if (price === undefined || !Number.isFinite(price)) return;
    const description = container
      .find("p")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    items.push({
      id: itemId(source.id, name, undefined, price),
      name,
      ...(description && description !== name ? { description } : {}),
      price: Math.round(price * 100) / 100,
      currency: "USD",
      sourceId: source.id,
    });
  });
  return dedupe(items);
}

export function extractProviderMenuFromJson(
  payloads: CapturedJsonPayload[],
  source: OrderingSource,
  adapterId: MenuAdapterId,
): HtmlMenuExtraction {
  const items: MenuItem[] = [];
  const schema = PROVIDER_SCHEMAS[adapterId];
  for (const payload of payloads) {
    walkProviderPayload(
      payload.data,
      source.id,
      schema,
      items,
      new WeakSet<object>(),
      { eligibleItem: false, depth: 0 },
    );
    if (items.length >= 750) break;
  }
  const deduped = dedupe(items).slice(0, 750);
  return {
    items: deduped,
    methods: deduped.length > 0
      ? new Set(["embedded_json"] as const)
      : new Set<"json_ld" | "embedded_json" | "dom">(),
  };
}

export function extractProviderMenuFromHtml(
  html: string,
  source: OrderingSource,
  adapterId: MenuAdapterId,
): HtmlMenuExtraction {
  if (!html) {
    return {
      items: [],
      methods: new Set<"json_ld" | "embedded_json" | "dom">(),
    };
  }
  const $ = cheerio.load(html);
  const payloads: CapturedJsonPayload[] = [];
  $('script#__NEXT_DATA__, script[type="application/json"]').each((index, element) => {
    const text = $(element).text();
    if (!text || text.length > 2_500_000) return;
    try {
      payloads.push({
        url: `${source.url}#embedded-${index}`,
        status: 200,
        contentType: "application/json",
        data: JSON.parse(text) as unknown,
      });
    } catch {
      // Ignore malformed state blocks and keep looking for valid menu JSON.
    }
  });
  const embedded = extractProviderMenuFromJson(payloads, source, adapterId);
  const semanticItems = adapterId === "grubhub"
    ? extractGrubhubSemanticDom(html, source)
    : [];
  const items = dedupe([...embedded.items, ...semanticItems]).slice(0, 750);
  return {
    items,
    methods: new Set([
      ...(embedded.items.length > 0 ? (["embedded_json"] as const) : []),
      ...(semanticItems.length > 0 ? (["dom"] as const) : []),
    ]),
  };
}
