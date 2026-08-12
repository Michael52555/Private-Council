import type {
  MealPattern,
  MenuItem,
  RestaurantMealProfile,
} from "@/lib/menu/types";
import type { BudgetEstimateConfidence } from "@/lib/planning-types";

export type MenuItemRole =
  | "complete_meal"
  | "main"
  | "shared_main"
  | "small_plate"
  | "side"
  | "drink"
  | "dessert"
  | "unit_item"
  | "accessory"
  | "unknown";

export type MealCompositionEstimate = {
  pattern: MealPattern;
  confidence: BudgetEstimateConfidence;
  lower: number;
  median: number;
  upper: number;
  evidenceItems: Array<MenuItem & { price: number }>;
  excludedItemCount: number;
  composed: boolean;
};

type MealCompositionContext = {
  restaurantName?: string;
  mealProfile?: RestaurantMealProfile;
  restaurantTags?: string[];
  partySize?: number;
};

type PriceDistribution = {
  lower: number;
  median: number;
  upper: number;
};

type BasketFamily = "single" | "combo" | "multi" | "shared";

const ACCESSORY_PATTERN = /\b(?:add[ -]?ons?|extras?|modifier|choice|option|sauces?|dips?|dressings?|condiments?|toppings?|utensils?|napkins?|cutlery|special instructions?)\b/i;
const DRINK_PATTERN = /\b(?:beverages?|drinks?|sodas?|soft drinks?|fountain drinks?|coffee|tea|juice|lemonade|smoothie|shake|beer|wine|cocktail|sake|coke|coca[ -]?cola|pepsi|sprite|fanta|root beer|bottled water|sparkling water|milk|horchata|agua fresca)\b/i;
const DESSERT_PATTERN = /\b(?:desserts?|sweets?|cookies?|cakes?|ice cream|gelato|pudding|brownies?|cheesecake|churros?)\b/i;
const GROUP_MEAL_PATTERN = /\b(?:family (?:style|meals?|packs?|bundles?|dinners?)|party (?:packs?|trays?)|shared plates?|to share|feasts?|feeds?\s+\d+|serves?\s+\d+|for\s+\d+|hot pot|korean bbq)\b/i;
const COMPLETE_MEAL_PATTERN = /\b(?:combos?|combination|meal deals?|bentos?|omakase|prix fixe|plates?|platters?|boxes?|bundles?|lunch specials?|dinner specials?|dinner for one|lunch for one)\b/i;
const SIDE_PATTERN = /\b(?:sides?|fries|chips|mashed potatoes|coleslaw|slaw|side salad|side rice|rice side|beans|cornbread|garlic bread)\b/i;
const SMALL_PLATE_PATTERN = /\b(?:appetizers?|starters?|small plates?|tapas|dim\s*sum|snacks?|mezze)\b/i;
const UNIT_ITEM_PATTERN = /\b(?:nigiri|sashimi|hand rolls?|maki|sushi rolls?|tacos?|sliders?|dumplings?|gyoza|bao|by the piece|per piece|individual pieces?)\b/i;
const MAIN_PATTERN = /\b(?:mains?|entrées?|entrees?|burgers?|sandwich(?:es)?|wraps?|burritos?|quesadillas?|pizza|ramen|udon|noodles?|pasta|curry|(?:rice )?bowls?|donburi|poke|steak|ribs?|brisket|chicken|beef|pork|lamb|seafood|fish|wings?|nuggets?|tenders?|salads?)\b/i;
const FEATURED_SECTION_PATTERN = /^(?:best\s*sellers?|most ordered(?: on (?:grubhub|doordash))?|popular items?|most liked|top picks?)$/i;

const SECTION_ACCESSORY_PATTERN = /^(?:add[ -]?ons?|extras?|sauces?|dips?|dressings?|toppings?|condiments?)$/i;
const SECTION_DRINK_PATTERN = /^(?:beverages?|drinks?|coffee|tea|smoothies?|juices?|beer|wine|cocktails?)$/i;
const SECTION_DESSERT_PATTERN = /^(?:desserts?|sweets?|treats?|bakery)$/i;
const SECTION_SIDE_PATTERN = /^(?:sides?|accompaniments?)$/i;
const SECTION_COMPLETE_PATTERN = /^(?:combos?|combinations?|meals?|meal deals?|bentos?|plates?|platters?|lunch specials?|dinner specials?)$/i;
const SECTION_SMALL_PATTERN = /^(?:appetizers?|starters?|small plates?|tapas|dim\s*sum|snacks?|mezze)$/i;
const SECTION_UNIT_PATTERN = /^(?:tacos?|nigiri|sashimi|hand rolls?|sushi rolls?|maki|dumplings?|gyoza|bao|sliders?)$/i;
const SECTION_MAIN_PATTERN = /^(?:mains?|entrées?|entrees?|burgers?|sandwiches?|wraps?|pizza|ramen|udon|noodles?|pasta|curr(?:y|ies)|bowls?|salads?)$/i;
const STANDALONE_BEVERAGE_RESTAURANT_PATTERN = /\b(?:juice bars?|smoothie (?:bars?|shops?)|smoothies? and juices?|a[cç]a[ií] (?:bars?|shops?))\b/i;
const WELLNESS_SHOT_SECTION_PATTERN = /^(?:wellness |ginger |turmeric |beet |hibiscus )?shots?$/i;

const PATTERN_KEYWORDS: Record<BasketFamily, Array<[RegExp, number]>> = {
  single: [
    [/\b(?:bowls?|salads?)\b/i, 5],
    [/\b(?:burgers?|sandwich(?:es)?|wraps?|burritos?)\b/i, 4],
    [/\b(?:ramen|udon|pasta|curry|poke|donburi)\b/i, 4],
    [/\b(?:entrées?|entrees?|plates?|pizza)\b/i, 3],
  ],
  combo: [
    [/\b(?:combos?|combination|meal deals?)\b/i, 7],
    [/\b(?:bentos?|prix fixe|omakase)\b/i, 6],
    [/\b(?:platters?|boxes?|lunch specials?|dinner specials?)\b/i, 5],
  ],
  multi: [
    [/\b(?:tacos?|sushi rolls?|hand rolls?|maki|sliders?)\b/i, 5],
    [/\b(?:dumplings?|gyoza|bao|nigiri|sashimi)\b/i, 4],
    [/\b(?:dim\s*sum|tapas|small plates?)\b/i, 6],
  ],
  shared: [
    [/\b(?:family style|family meals?|shared plates?|to share)\b/i, 8],
    [/\b(?:hot pot|korean bbq|party trays?|feasts?)\b/i, 7],
    [/\b(?:feeds?\s+\d+|serves?\s+\d+|for\s+\d+)\b/i, 7],
  ],
};

function normalized(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function itemText(item: MenuItem): string {
  return [item.section, item.name, item.description]
    .map(normalized)
    .filter(Boolean)
    .join(" ");
}

export function classifyMenuItem(item: MenuItem): MenuItemRole {
  const section = normalized(item.section);
  const name = normalized(item.name);
  const description = normalized(item.description);

  // An explicit provider section is stronger than incidental words in a long
  // description (for example, a bowl "served with a side salad").
  if (SECTION_ACCESSORY_PATTERN.test(section)) return "accessory";
  if (SECTION_DRINK_PATTERN.test(section)) return "drink";
  if (SECTION_DESSERT_PATTERN.test(section)) return "dessert";
  if (SECTION_SIDE_PATTERN.test(section)) return "side";
  if (GROUP_MEAL_PATTERN.test(`${section} ${name} ${description}`)) return "shared_main";
  if (SECTION_COMPLETE_PATTERN.test(section)) return "complete_meal";
  if (SECTION_SMALL_PATTERN.test(section)) return "small_plate";
  if (SECTION_UNIT_PATTERN.test(section)) return "unit_item";
  if (SECTION_MAIN_PATTERN.test(section)) return "main";

  if (ACCESSORY_PATTERN.test(name)) return "accessory";
  if (DRINK_PATTERN.test(name)) return "drink";
  if (DESSERT_PATTERN.test(name)) return "dessert";
  if (GROUP_MEAL_PATTERN.test(`${name} ${description}`)) return "shared_main";
  if (COMPLETE_MEAL_PATTERN.test(name)) return "complete_meal";
  if (SIDE_PATTERN.test(name)) return "side";
  if (SMALL_PLATE_PATTERN.test(name)) return "small_plate";
  if (UNIT_ITEM_PATTERN.test(name)) return "unit_item";
  if (MAIN_PATTERN.test(name)) return "main";
  return "unknown";
}

function isStandaloneBeverageRestaurant(
  context: MealCompositionContext,
): boolean {
  return STANDALONE_BEVERAGE_RESTAURANT_PATTERN.test(
    [context.restaurantName, ...(context.restaurantTags ?? [])]
      .map(normalized)
      .filter(Boolean)
      .join(" "),
  );
}

function classifyMenuItemForContext(
  item: MenuItem,
  context: MealCompositionContext,
): MenuItemRole {
  const section = normalized(item.section);
  if (WELLNESS_SHOT_SECTION_PATTERN.test(section)) return "accessory";
  const role = classifyMenuItem(item);
  if (
    role === "drink" &&
    isStandaloneBeverageRestaurant(context) &&
    /\b(?:smoothies?|juices?)\b/i.test(`${section} ${normalized(item.name)}`)
  ) {
    return "main";
  }
  return role;
}

function quantile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index];
}

function distribution(items: Array<MenuItem & { price: number }>): PriceDistribution {
  return distributionFromValues(items.map((item) => item.price));
}

function distributionFromValues(values: number[]): PriceDistribution {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  return {
    lower: quantile(values, 0.25),
    median,
    upper: quantile(values, 0.75),
  };
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function estimate(
  pattern: MealPattern,
  confidence: BudgetEstimateConfidence,
  values: PriceDistribution,
  evidenceItems: Array<MenuItem & { price: number }>,
  pricedItemCount: number,
  composed: boolean,
): MealCompositionEstimate {
  return {
    pattern,
    confidence,
    lower: rounded(Math.max(0, values.lower)),
    median: rounded(Math.max(values.lower, values.median)),
    upper: rounded(Math.max(values.median, values.upper)),
    evidenceItems,
    excludedItemCount: Math.max(0, pricedItemCount - evidenceItems.length),
    composed,
  };
}

function addKeywordScores(
  scores: Record<BasketFamily, number>,
  text: string,
  sourceMultiplier: number,
): void {
  if (!text) return;
  for (const family of Object.keys(PATTERN_KEYWORDS) as BasketFamily[]) {
    for (const [pattern, weight] of PATTERN_KEYWORDS[family]) {
      if (pattern.test(text)) scores[family] += weight * sourceMultiplier;
    }
  }
}

function basketScores(
  priced: Array<MenuItem & { price: number }>,
  roles: Map<string, MenuItemRole>,
  context: MealCompositionContext,
): Record<BasketFamily, number> {
  const scores: Record<BasketFamily, number> = {
    single: 0,
    combo: 0,
    multi: 0,
    shared: 0,
  };
  for (const tag of context.restaurantTags ?? []) {
    addKeywordScores(scores, tag, 2);
  }
  for (const item of priced) {
    addKeywordScores(scores, normalized(item.section), 4);
    addKeywordScores(scores, normalized(item.name), 3);
    addKeywordScores(scores, normalized(item.description), 1);
    switch (roles.get(item.id)) {
      case "complete_meal": scores.combo += 6; break;
      case "main": scores.single += 5; break;
      case "shared_main": scores.shared += 7; break;
      case "small_plate":
      case "unit_item": scores.multi += 5; break;
    }
  }
  return scores;
}

function winningFamily(
  scores: Record<BasketFamily, number>,
): { family: BasketFamily; score: number; margin: number } | null {
  const ranked = (Object.entries(scores) as Array<[BasketFamily, number]>)
    .sort((a, b) => b[1] - a[1]);
  const [winner, runnerUp] = ranked;
  if (!winner || winner[1] < 7) return null;
  return {
    family: winner[0],
    score: winner[1],
    margin: winner[1] - (runnerUp?.[1] ?? 0),
  };
}

function familyFromRecognizedRoles(counts: Record<BasketFamily, number>): BasketFamily | null {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total < 2) return null;
  const ranked = (Object.entries(counts) as Array<[BasketFamily, number]>)
    .sort((a, b) => b[1] - a[1]);
  const [winner] = ranked;
  if (!winner || winner[1] < 2 || winner[1] / total < 0.5) return null;
  return winner[0];
}

function isFeaturedItem(item: MenuItem): boolean {
  return item.featured === true || FEATURED_SECTION_PATTERN.test(item.section ?? "");
}

function preferredEvidence<T extends MenuItem>(items: T[]): T[] {
  const featured = items.filter(isFeaturedItem);
  return featured.length >= 2 ? featured : items;
}

function unknownMainCandidates(
  unknownItems: Array<MenuItem & { price: number }>,
  priced: Array<MenuItem & { price: number }>,
  context: MealCompositionContext,
): Array<MenuItem & { price: number }> {
  const plausiblePrices = priced
    .filter((item) => !["accessory", "drink", "dessert", "side"].includes(classifyMenuItem(item)))
    .map((item) => item.price);
  const priceFloor = plausiblePrices.length > 0
    ? Math.max(2, distributionFromValues(plausiblePrices).median * 0.35)
    : 2;
  const plausible = unknownItems.filter((item) => item.price >= priceFloor);
  const featured = plausible.filter(isFeaturedItem);
  if (featured.length >= 2) return featured;

  // Branded products often have names that do not say "bowl" or "salad".
  // Provider restaurant-level tags provide enough evidence to treat them as
  // mains even when the restaurant has no Best Sellers section.
  const tagText = (context.restaurantTags ?? []).join(" ");
  if (
    /\b(?:bowls?|salads?|burgers?|sandwich(?:es)?|wraps?|burritos?|ramen|udon|pasta|curry|poke|donburi|entrees?|entrées?)\b/i.test(
      tagText,
    ) &&
    plausible.length >= 2
  ) {
    return plausible;
  }
  return featured;
}

function scaled(
  values: PriceDistribution,
  counts: { lower: number; median: number; upper: number },
): PriceDistribution {
  return {
    lower: values.lower * counts.lower,
    median: values.median * counts.median,
    upper: values.upper * counts.upper,
  };
}

function servingBounds(item: MenuItem): { minimum: number; typical: number; maximum: number } | null {
  const text = itemText(item);
  const range = text.match(/\b(?:serves?|feeds?|for)\s+(\d+)\s*(?:-|–|to)\s*(\d+)\b/i);
  if (range) {
    const first = Number(range[1]);
    const second = Number(range[2]);
    if (first > 0 && second >= first) {
      return { minimum: first, typical: (first + second) / 2, maximum: second };
    }
  }
  const exact = text.match(/\b(?:serves?|feeds?|for)\s+(\d+)\b/i);
  if (exact) {
    const count = Number(exact[1]);
    if (count > 0) return { minimum: count, typical: count, maximum: count };
  }
  return null;
}

function sharedDistribution(
  items: Array<MenuItem & { price: number }>,
): { values: PriceDistribution; explicitServingCount: number } {
  const explicit = items
    .map((item) => ({ item, servings: servingBounds(item) }))
    .filter((entry): entry is {
      item: MenuItem & { price: number };
      servings: { minimum: number; typical: number; maximum: number };
    } => entry.servings !== null);
  if (explicit.length >= 2) {
    return {
      values: {
        lower: quantile(explicit.map(({ item, servings }) => item.price / servings.maximum), 0.25),
        median: distributionFromValues(
          explicit.map(({ item, servings }) => item.price / servings.typical),
        ).median,
        upper: quantile(explicit.map(({ item, servings }) => item.price / servings.minimum), 0.75),
      },
      explicitServingCount: explicit.length,
    };
  }
  return {
    // A shared-table order commonly contains roughly one dish per diner, with
    // some tables adding an extra shared plate. Keep this intentionally broad.
    values: scaled(distribution(items), { lower: 0.75, median: 1, upper: 1.5 }),
    explicitServingCount: explicit.length,
  };
}

export function estimateMealComposition(
  items: MenuItem[],
  context: MealCompositionContext = {},
): MealCompositionEstimate | null {
  const priced = items.filter(
    (item): item is MenuItem & { price: number } =>
      typeof item.price === "number" && Number.isFinite(item.price) && item.price > 0,
  );
  if (priced.length < 2) return null;

  const roles = new Map<string, MenuItemRole>();
  const byRole = new Map<MenuItemRole, Array<MenuItem & { price: number }>>();
  for (const item of priced) {
    const role = classifyMenuItemForContext(item, context);
    roles.set(item.id, role);
    const roleItems = byRole.get(role) ?? [];
    roleItems.push(item);
    byRole.set(role, roleItems);
  }
  const roleItems = (role: MenuItemRole) => byRole.get(role) ?? [];
  const completeMeals = roleItems("complete_meal");
  const regularMains = roleItems("main");
  const sharedMains = roleItems("shared_main");
  const smallPlates = roleItems("small_plate");
  const unitItems = roleItems("unit_item");
  const unknownMains = unknownMainCandidates(roleItems("unknown"), priced, context);
  const scores = basketScores(priced, roles, context);

  // At a juice/smoothie bar, the beverage or bowl is normally the purchased
  // one-person item rather than an optional drink added to another entree.
  // Branded Best Sellers often omit words such as "smoothie" from their names,
  // so the restaurant identity is needed as the final single-item signal.
  if (
    isStandaloneBeverageRestaurant(context) &&
    regularMains.length + unknownMains.length >= 2
  ) {
    scores.single += 10;
  }

  // Existing Google fast-food labels are only a weak tie-breaker. The menu and
  // Provider tags remain the primary evidence.
  if (
    context.mealProfile === "fast_food" &&
    regularMains.length === 0 &&
    unknownMains.length >= 3
  ) {
    scores.single += 8;
  }

  const roleFamily = familyFromRecognizedRoles({
    single: regularMains.length,
    combo: completeMeals.length,
    multi: smallPlates.length + unitItems.length,
    shared: sharedMains.length,
  });
  const scoredWinner = winningFamily(scores);
  const winner = roleFamily
    ? { family: roleFamily, score: scores[roleFamily], margin: Number.POSITIVE_INFINITY }
    : scoredWinner;
  if (!winner) return null;
  const highConfidence = winner.score >= 18 && winner.margin >= 5;

  if (winner.family === "combo" && completeMeals.length >= 2) {
    const evidence = preferredEvidence(completeMeals);
    return estimate(
      "combo_dominant",
      evidence.length >= 3 && highConfidence ? "high" : "medium",
      distribution(evidence),
      evidence,
      priced.length,
      false,
    );
  }

  if (winner.family === "shared" && sharedMains.length >= 2) {
    const evidence = preferredEvidence(sharedMains);
    const shared = sharedDistribution(evidence);
    return estimate(
      "shared_dishes",
      shared.explicitServingCount >= 2 && highConfidence ? "high" : "medium",
      shared.values,
      evidence,
      priced.length,
      true,
    );
  }

  const multiItems = [...smallPlates, ...unitItems];
  if (winner.family === "multi" && multiItems.length >= 2) {
    const evidence = preferredEvidence(multiItems);
    const mostlyPiecePriced = evidence.filter((item) =>
      /\b(?:nigiri|sashimi|by the piece|per piece|individual pieces?)\b/i.test(itemText(item)),
    ).length >= Math.ceil(evidence.length / 2);
    return estimate(
      mostlyPiecePriced ? "unit_items" : "multiple_small_plates",
      highConfidence ? "high" : "medium",
      scaled(
        distribution(evidence),
        mostlyPiecePriced
          ? { lower: 4, median: 5, upper: 6 }
          : { lower: 2, median: 2.5, upper: 3 },
      ),
      evidence,
      priced.length,
      true,
    );
  }

  const singleMains = [...regularMains, ...unknownMains];
  if (winner.family === "single" && singleMains.length >= 2) {
    const evidence = preferredEvidence(singleMains);
    const recognizedCount = evidence.filter((item) => roles.get(item.id) === "main").length;
    return estimate(
      "single_main",
      recognizedCount >= 3 && highConfidence ? "high" : "medium",
      distribution(evidence),
      evidence,
      priced.length,
      false,
    );
  }

  // A mixed Best Sellers section can make the top score point to a pattern for
  // which too few actual products exist. Do not silently switch to Google or a
  // different meal model; insufficient evidence remains explicit.
  return null;
}
