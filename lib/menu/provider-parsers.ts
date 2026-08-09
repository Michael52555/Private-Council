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
const GRUBHUB_BEST_SELLER_SECTION = /^(?:best\s*sellers?|most ordered(?: on grubhub)?|popular items?)$/i;
const PRICE_ONLY_MENU_TEXT = /^(?:from\s*)?\$\s*[0-9]+(?:\.[0-9]{1,2})?\+?$/i;
const GRUBHUB_RESTAURANT_TAG_KEYS = /^(?:cuisines?|restaurantCuisines?|restaurant_cuisines?|restaurantTags?|restaurant_tags?|foodTypes?|food_types?)$/i;

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
  chick_fil_a: {
    itemCollections: /^(?:items|menuItems|products|menuProducts|entries)$/i,
    sectionCollections: /^(?:menus|categories|sections|menuProductCategories|groups)$/i,
    ignoredCollections: COMMON_IGNORED_COLLECTIONS,
  },
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function isPriceOnlyMenuText(value: string): boolean {
  return PRICE_ONLY_MENU_TEXT.test(value.replace(/\s+/g, " ").trim());
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
  if (isPriceOnlyMenuText(name)) return undefined;
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

function hasBestSellerMarker(node: JsonObject): boolean {
  for (const [key, value] of Object.entries(node)) {
    if (!/best.?seller|popular|badge|label|tag/i.test(key)) continue;
    if (value === true && /best.?seller|popular/i.test(key)) return true;
    if (typeof value === "string" && /best\s*seller|most ordered/i.test(value)) {
      return true;
    }
    if (
      Array.isArray(value) &&
      value.some((entry) =>
        typeof entry === "string"
          ? /best\s*seller|most ordered/i.test(entry)
          : isObject(entry) && /best\s*seller|most ordered/i.test(
              firstString(entry.name, entry.label, entry.text, entry.title) ?? "",
            ),
      )
    ) {
      return true;
    }
  }
  return false;
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
    if (
      item &&
      (hasBestSellerMarker(value) ||
        GRUBHUB_BEST_SELLER_SECTION.test(context.section ?? ""))
    ) {
      item.featured = true;
    }
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
    if (!existing) {
      byIdentity.set(key, item);
      continue;
    }
    const existingIsFeaturedSection = GRUBHUB_BEST_SELLER_SECTION.test(
      existing.section ?? "",
    );
    const nextIsFeaturedSection = GRUBHUB_BEST_SELLER_SECTION.test(
      item.section ?? "",
    );
    byIdentity.set(key, {
      ...existing,
      ...(!existing.description && item.description
        ? { description: item.description }
        : {}),
      // When Grubhub repeats one product in Best Sellers and its real category,
      // keep the useful category while retaining the featured signal.
      ...((!existing.section || existingIsFeaturedSection) && item.section && !nextIsFeaturedSection
        ? { section: item.section }
        : {}),
      ...(existing.featured || item.featured || existingIsFeaturedSection || nextIsFeaturedSection
        ? { featured: true }
        : {}),
    });
  }
  return [...byIdentity.values()];
}

function normalizeRestaurantTag(value: string): string | undefined {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length < 2 || normalized.length > 50) return undefined;
  if (/\$|https?:|ratings?|reviews?|delivery|pickup|miles?/i.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function restaurantTagsFromValue(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const tags: string[] = [];
  for (const entry of values) {
    const raw = typeof entry === "string"
      ? entry
      : isObject(entry)
        ? firstString(entry.name, entry.label, entry.displayName, entry.title)
        : undefined;
    if (!raw) continue;
    for (const part of raw.split(/[,|]/)) {
      const tag = normalizeRestaurantTag(part);
      if (tag) tags.push(tag);
    }
  }
  return tags;
}

function extractGrubhubRestaurantTagsFromJson(value: unknown): string[] {
  const tags = new Set<string>();
  const seen = new WeakSet<object>();
  const visit = (current: unknown, depth: number): void => {
    if (depth > 20 || tags.size >= 20) return;
    if (Array.isArray(current)) {
      current.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    if (!isObject(current) || seen.has(current)) return;
    seen.add(current);
    for (const [key, child] of Object.entries(current)) {
      if (GRUBHUB_RESTAURANT_TAG_KEYS.test(key)) {
        restaurantTagsFromValue(child).forEach((tag) => tags.add(tag));
      }
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return [...tags];
}

function extractGrubhubRestaurantTagsFromDom(html: string): string[] {
  const $ = cheerio.load(html);
  const tags = new Set<string>();
  $("body *").each((_, element) => {
    if (tags.size >= 20) return false;
    const ownText = $(element)
      .contents()
      .filter((__, node) => node.type === "text")
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const match = ownText.match(/^(.{2,180}?)\s*(?:·|•)\s*\${1,4}$/);
    if (!match || !match[1].includes(",")) return;
    restaurantTagsFromValue(match[1]).forEach((tag) => tags.add(tag));
  });
  return [...tags];
}

function extractGrubhubSemanticDom(
  html: string,
  source: OrderingSource,
): MenuItem[] {
  const $ = cheerio.load(html);
  const items: MenuItem[] = [];
  const nonItemHeading = /^(?:menu|delivery|pickup|reviews?|hours|faqs?|best sellers|start group order|see the full schedule)$/i;
  let currentSection: string | undefined;

  const plausibleProductName = (value: string, currentHeading: string): string | undefined => {
    const candidate = value.replace(/\s+/g, " ").trim();
    if (!candidate || candidate === currentHeading) return undefined;
    if (candidate.length < 2 || candidate.length > 120) return undefined;
    if (isPriceOnlyMenuText(candidate) || /\$[0-9]/.test(candidate)) return undefined;
    if (nonItemHeading.test(candidate)) return undefined;
    if (/^(?:best seller|most ordered on grubhub|add|customize|order|details?|more)$/i.test(candidate)) {
      return undefined;
    }
    return candidate;
  };

  const productNameFromContainer = (
    container: ReturnType<typeof $>,
    currentHeading: string,
  ): string | undefined => {
    const targetedSelectors = [
      "[data-testid*='item-name']",
      "[data-testid*='itemName']",
      "[data-qa*='item-name']",
      "[data-qa*='itemName']",
      "[class*='item-name']",
      "[class*='itemName']",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
    ].join(", ");
    for (const element of container.find(targetedSelectors).toArray()) {
      const candidate = plausibleProductName($(element).text(), currentHeading);
      if (candidate) return candidate;
    }
    for (const image of container.find("img[alt]").toArray()) {
      const candidate = plausibleProductName($(image).attr("alt") ?? "", currentHeading);
      if (candidate) return candidate;
    }
    // Some Grubhub cards render the product name as an ordinary span/div while
    // exposing only the price as a semantic heading. Read the element's own text
    // nodes in DOM order so the card title wins over its later description.
    for (const element of container.find("*").addBack().toArray()) {
      const ownText = $(element)
        .contents()
        .filter((_, node) => node.type === "text")
        .text();
      const candidate = plausibleProductName(ownText, currentHeading);
      if (candidate) return candidate;
    }
    return undefined;
  };

  $("h1, h2, h3, h4, h5, h6, [role='heading']").each((_, element) => {
    const headingText = $(element).text().replace(/\s+/g, " ").trim();
    const tagMatch = element.type === "tag"
      ? element.name.match(/^h([1-6])$/i)
      : null;
    const headingLevel = Number(
      $(element).attr("aria-level") ?? tagMatch?.[1] ?? 6,
    );
    if (GRUBHUB_BEST_SELLER_SECTION.test(headingText)) {
      currentSection = "Best Sellers";
      return;
    }
    if (!headingText || headingText.length > 180 || nonItemHeading.test(headingText)) return;

    let container = $(element);
    let price: number | undefined;
    let name = isPriceOnlyMenuText(headingText) ? undefined : headingText;
    for (let depth = 0; depth < 6; depth += 1) {
      // Do not climb from a category heading into a wrapper that contains many
      // product cards. Otherwise the first descendant price can make headings
      // such as "Entrées" look like a Best Seller menu item.
      if (
        depth > 0 &&
        container.find("h1, h2, h3, h4, h5, h6, [role='heading']").length > 2
      ) {
        break;
      }
      const text = container.text().replace(/\s+/g, " ");
      const prices = [...text.matchAll(/\$([0-9]+(?:\.[0-9]{2})?)(?:\+)?/g)];
      if (prices.length >= 1 && prices.length <= 2) {
        price = Number(prices[0][1]);
        name ??= productNameFromContainer(container, headingText);
        if (name) break;
      }
      container = container.parent();
      if (container.length === 0) break;
    }
    if (!name || isPriceOnlyMenuText(name) || price === undefined || !Number.isFinite(price)) {
      // A heading without one nearby product price is a category candidate.
      // Keeping it lets later product cards retain sections such as Entrées,
      // Sushi Rolls, Bowls, or Combos even when Best Sellers is absent.
      if (
        !isPriceOnlyMenuText(headingText) &&
        Number.isFinite(headingLevel) &&
        headingLevel <= 4 &&
        !/\$[0-9]/.test(headingText)
      ) {
        currentSection = headingText;
      }
      return;
    }
    const hasBestSellerBadge = container
      .find("*")
      .addBack()
      .toArray()
      .some((node) => /^best seller$/i.test($(node).text().replace(/\s+/g, " ").trim()));
    const featured = hasBestSellerBadge || GRUBHUB_BEST_SELLER_SECTION.test(
      currentSection ?? "",
    );
    const description = container
      .find("p")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    items.push({
      id: itemId(source.id, name, currentSection, price),
      name,
      ...(description && description !== name ? { description } : {}),
      ...(currentSection ? { section: currentSection } : {}),
      ...(featured ? { featured: true } : {}),
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
  const restaurantTags = new Set<string>();
  const schema = PROVIDER_SCHEMAS[adapterId];
  for (const payload of payloads) {
    if (adapterId === "grubhub") {
      extractGrubhubRestaurantTagsFromJson(payload.data).forEach((tag) =>
        restaurantTags.add(tag),
      );
    }
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
  const scopedItems = dedupe(items).slice(0, 750);
  return {
    items: scopedItems,
    restaurantTags: [...restaurantTags],
    methods: scopedItems.length > 0
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
  const restaurantTags = adapterId === "grubhub"
    ? [...new Set([
        ...(embedded.restaurantTags ?? []),
        ...extractGrubhubRestaurantTagsFromDom(html),
      ])]
    : [];
  const items = dedupe([...embedded.items, ...semanticItems]).slice(0, 750);
  return {
    items,
    restaurantTags,
    methods: new Set([
      ...(embedded.items.length > 0 ? (["embedded_json"] as const) : []),
      ...(semanticItems.length > 0 ? (["dom"] as const) : []),
    ]),
  };
}
