import type { MealPattern, MenuItem } from "@/lib/menu/types";
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
  partySize?: number;
};

type PriceDistribution = {
  lower: number;
  median: number;
  upper: number;
};

const ACCESSORY_PATTERN = /\b(?:add[ -]?ons?|extras?|modifier|choice|option|sauces?|dips?|dressings?|condiments?|toppings?|utensils?|napkins?|cutlery|special instructions?)\b/i;
const DRINK_PATTERN = /\b(?:beverages?|drinks?|sodas?|coffee|tea|juice|lemonade|smoothie|shake|beer|wine|cocktail|sake)\b/i;
const DESSERT_PATTERN = /\b(?:desserts?|sweets?|cookies?|cake|ice cream|gelato|pudding|brownie|cheesecake)\b/i;
const COMPLETE_MEAL_PATTERN = /\b(?:combo|combination|meals?|bento|omakase|prix fixe|plate|platter|box|bundle|lunch special|dinner special|dinner for one|lunch for one)\b/i;
const GROUP_MEAL_PATTERN = /\b(?:family (?:meal|pack|bundle)|party (?:pack|tray)|feeds? \d+|serves? \d+|for \d+)\b/i;
const SIDE_PATTERN = /\b(?:sides?|fries|chips|mashed potatoes|coleslaw|slaw|side salad|side rice|rice side|beans|cornbread)\b/i;
const SMALL_PLATE_PATTERN = /\b(?:appetizers?|starters?|small plates?|tapas|dim\s*sum|snacks?|mezze)\b/i;
const UNIT_ITEM_PATTERN = /\b(?:nigiri|sashimi|hand roll|maki|sushi pieces?|by the piece|per piece)\b/i;
const MAIN_PATTERN = /\b(?:mains?|entrées?|entrees?|burgers?|sandwiches?|wraps?|burritos?|pizza|ramen|udon|noodles?|pasta|curry|rice bowls?|donburi|steak|ribs?|brisket|chicken|beef|pork|lamb|seafood|fish)\b/i;
const SHARED_ITEM_PATTERN = /\b(?:family style|to share|shared|large plates?|hot pot|whole fish|whole chicken)\b/i;
const UNIT_PRICED_RESTAURANT_PATTERN = /\b(?:sushi|izakaya)\b/i;
const SMALL_PLATE_RESTAURANT_PATTERN = /\b(?:tapas|dim\s*sum|small plates?|izakaya)\b/i;
const SHARED_RESTAURANT_PATTERN = /\b(?:hot pot|korean bbq|family style|szechuan|sichuan|hunan|cantonese)\b/i;

function itemText(item: MenuItem): string {
  return `${item.section ?? ""} ${item.name} ${item.description ?? ""}`
    .replace(/\s+/g, " ")
    .trim();
}

function hasSectionSignal(item: MenuItem, pattern: RegExp): boolean {
  return pattern.test(item.section ?? "");
}

export function classifyMenuItem(item: MenuItem): MenuItemRole {
  const text = itemText(item);

  if (ACCESSORY_PATTERN.test(text)) return "accessory";
  if (DRINK_PATTERN.test(text)) return "drink";
  if (DESSERT_PATTERN.test(text)) return "dessert";
  if (SMALL_PLATE_PATTERN.test(text)) return "small_plate";
  if (GROUP_MEAL_PATTERN.test(text)) return "shared_main";
  if (COMPLETE_MEAL_PATTERN.test(text)) return "complete_meal";
  if (SIDE_PATTERN.test(text) || hasSectionSignal(item, /^(?:sides?|accompaniments?)$/i)) {
    return "side";
  }
  if (UNIT_ITEM_PATTERN.test(text)) return "unit_item";
  if (SHARED_ITEM_PATTERN.test(text)) return "shared_main";
  if (MAIN_PATTERN.test(text) || hasSectionSignal(
    item,
    /^(?:mains?|entrées?|entrees?|burgers?|sandwiches?|pizza|ramen|noodles?|pasta|bowls?)$/i,
  )) {
    return "main";
  }
  return "unknown";
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
  const values = items.map((item) => item.price);
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

export function estimateMealComposition(
  items: MenuItem[],
  context: MealCompositionContext = {},
): MealCompositionEstimate | null {
  const priced = items.filter(
    (item): item is MenuItem & { price: number } =>
      typeof item.price === "number" && Number.isFinite(item.price) && item.price >= 0,
  );
  if (priced.length < 3) return null;

  const byRole = new Map<MenuItemRole, Array<MenuItem & { price: number }>>();
  for (const item of priced) {
    const role = classifyMenuItem(item);
    const roleItems = byRole.get(role) ?? [];
    roleItems.push(item);
    byRole.set(role, roleItems);
  }

  const roleItems = (role: MenuItemRole) => byRole.get(role) ?? [];
  const completeMeals = roleItems("complete_meal");
  const regularMains = roleItems("main");
  const sharedMains = roleItems("shared_main");
  const mealCandidates = [...completeMeals, ...regularMains];
  const sides = roleItems("side");
  const drinks = roleItems("drink");
  const smallPlates = roleItems("small_plate");
  const unitItems = roleItems("unit_item");
  const unknown = roleItems("unknown");
  const restaurantName = context.restaurantName ?? "";

  if (completeMeals.length >= 3) {
    return estimate(
      "combo_dominant",
      "high",
      distribution(completeMeals),
      completeMeals,
      priced.length,
      false,
    );
  }

  const unitSignal = UNIT_PRICED_RESTAURANT_PATTERN.test(restaurantName) ||
    (unitItems.length >= 3 && unitItems.length / priced.length >= 0.2);
  if (unitSignal) return null;

  const smallPlateSignal = SMALL_PLATE_RESTAURANT_PATTERN.test(restaurantName) ||
    (smallPlates.length >= 3 && smallPlates.length >= mealCandidates.length);
  if (smallPlateSignal && smallPlates.length >= 3) {
    const small = distribution(smallPlates);
    return estimate(
      "multiple_small_plates",
      "low",
      {
        lower: 2 * small.lower,
        median: 2.5 * small.median,
        upper: 3 * small.upper,
      },
      smallPlates,
      priced.length,
      true,
    );
  }

  const sharedSignal = SHARED_RESTAURANT_PATTERN.test(restaurantName) ||
    sharedMains.length >= 3;
  const shareableDishes = [...regularMains, ...sharedMains];
  if (sharedSignal && shareableDishes.length >= 3) {
    const main = distribution(shareableDishes);
    const partySize = Math.min(8, Math.max(2, context.partySize ?? 2));
    const typicalDishesPerPerson = (partySize + 0.5) / partySize;
    const fullDishesPerPerson = (partySize + 1) / partySize;
    return estimate(
      "shared_dishes",
      "low",
      {
        lower: main.lower,
        median: typicalDishesPerPerson * main.median,
        upper: fullDishesPerPerson * main.upper,
      },
      shareableDishes,
      priced.length,
      true,
    );
  }

  if (mealCandidates.length >= 3 && sides.length >= 2) {
    const main = distribution(mealCandidates);
    const side = distribution(sides);
    const drink = drinks.length >= 2 ? distribution(drinks) : null;
    return estimate(
      "main_plus_sides",
      "medium",
      {
        lower: main.lower,
        median: main.median + side.median + (drink ? 0.35 * drink.median : 0),
        upper: main.upper + side.upper + (drink ? 0.75 * drink.upper : 0),
      },
      [...mealCandidates, ...sides, ...drinks],
      priced.length,
      true,
    );
  }

  if (mealCandidates.length >= 3) {
    const main = distribution(mealCandidates);
    const drink = drinks.length >= 2 ? distribution(drinks) : null;
    return estimate(
      "single_main",
      "high",
      {
        lower: main.lower,
        median: main.median + (drink ? 0.25 * drink.median : 0),
        upper: main.upper + (drink ? 0.75 * drink.upper : 0),
      },
      [...mealCandidates, ...drinks],
      priced.length,
      Boolean(drink),
    );
  }

  const ordinaryItems = [...mealCandidates, ...unknown].filter(
    (item) => !UNIT_ITEM_PATTERN.test(itemText(item)),
  );
  if (ordinaryItems.length >= 3) {
    return estimate(
      "single_main",
      "medium",
      distribution(ordinaryItems),
      ordinaryItems,
      priced.length,
      false,
    );
  }

  return null;
}
