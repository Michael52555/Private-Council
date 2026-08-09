import type {
  MealPattern,
  MenuItem,
  RestaurantMealProfile,
} from "@/lib/menu/types";
import type { BudgetEstimateConfidence } from "@/lib/planning-types";
import { classifyRestaurantMealProfile } from "@/lib/menu/restaurant-profile";

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
  partySize?: number;
};

type PriceDistribution = {
  lower: number;
  median: number;
  upper: number;
};

const ACCESSORY_PATTERN = /\b(?:add[ -]?ons?|extras?|modifier|choice|option|sauces?|dips?|dressings?|condiments?|toppings?|utensils?|napkins?|cutlery|special instructions?)\b/i;
const DRINK_PATTERN = /\b(?:beverages?|drinks?|sodas?|soft drinks?|fountain drinks?|coffee|tea|juice|lemonade|smoothie|shake|beer|wine|cocktail|sake|coke|coca[ -]?cola|pepsi|sprite|fanta|root beer|bottled water|sparkling water|milk|horchata|agua fresca)\b/i;
const DESSERT_PATTERN = /\b(?:desserts?|sweets?|cookies?|cake|ice cream|gelato|pudding|brownie|cheesecake)\b/i;
const COMPLETE_MEAL_PATTERN = /\b(?:combo|combination|meals?|bento|omakase|prix fixe|plate|platter|box|bundle|lunch special|dinner special|dinner for one|lunch for one)\b/i;
const GROUP_MEAL_PATTERN = /\b(?:family (?:meal|pack|bundle)|party (?:pack|tray)|feeds? \d+|serves? \d+|for \d+)\b/i;
const SIDE_PATTERN = /\b(?:sides?|fries|chips|mashed potatoes|coleslaw|slaw|side salad|side rice|rice side|beans|cornbread)\b/i;
const SMALL_PLATE_PATTERN = /\b(?:appetizers?|starters?|small plates?|tapas|dim\s*sum|snacks?|mezze)\b/i;
const UNIT_ITEM_PATTERN = /\b(?:nigiri|sashimi|hand roll|maki|sushi pieces?|by the piece|per piece)\b/i;
const MAIN_PATTERN = /\b(?:mains?|entrées?|entrees?|burgers?|sandwich(?:es)?|wraps?|burritos?|quesadillas?|pizza|ramen|udon|noodles?|pasta|curry|(?:rice )?bowls?|donburi|steak|ribs?|brisket|chicken|beef|pork|lamb|seafood|fish|tacos?|wings?|nuggets?|tenders?|salads?)\b/i;
const SHARED_ITEM_PATTERN = /\b(?:family style|to share|shared|large plates?|hot pot|whole fish|whole chicken)\b/i;
const UNIT_PRICED_RESTAURANT_PATTERN = /\b(?:sushi|izakaya)\b/i;
const FAST_FOOD_UNIT_PATTERN = /\b(?:single|individual|a la carte|à la carte|tacos?|wings?|nuggets?|tenders?|pieces?)\b/i;
const FEATURED_SECTION_PATTERN = /^(?:best\s*sellers?|most ordered(?: on grubhub)?|popular items?)$/i;

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
  const sides = roleItems("side");
  const drinks = roleItems("drink");
  const unitItems = roleItems("unit_item");
  const unknownItems = roleItems("unknown");
  const restaurantName = context.restaurantName ?? "";
  const mealProfile = context.mealProfile ?? classifyRestaurantMealProfile({
    name: restaurantName,
  });

  if (completeMeals.length >= 2) {
    return estimate(
      "combo_dominant",
      completeMeals.length >= 3 ? "high" : "medium",
      distribution(completeMeals),
      completeMeals,
      priced.length,
      false,
    );
  }

  if (mealProfile === "fast_food") {
    const recognizedFastFoodMains = regularMains.filter(
      (item) => !FAST_FOOD_UNIT_PATTERN.test(itemText(item)),
    );
    const featuredBrandedMains = unknownItems.filter(
      (item) => FEATURED_SECTION_PATTERN.test(item.section ?? ""),
    );
    const fastFoodMains = [
      ...recognizedFastFoodMains,
      ...featuredBrandedMains,
    ];
    const reliesOnBrandedFallback = featuredBrandedMains.length > 0;
    // Grubhub's Best Sellers are already a deliberately narrow section. Fast-food
    // chains often use branded product names (for example Subway Series names)
    // that contain none of our generic "sandwich/burger/combo" keywords. Treat
    // those otherwise-unclassified featured products as mains, but require three
    // examples so a single branded side or dessert cannot create an estimate.
    if (reliesOnBrandedFallback && fastFoodMains.length < 3) return null;
    if (fastFoodMains.length < 2) return null;
    const main = distribution(fastFoodMains);
    const side = sides.length > 0 ? distribution(sides) : null;
    const drink = drinks.length > 0 ? distribution(drinks) : null;
    if (side || drink) {
      return estimate(
        "main_plus_sides",
        "medium",
        {
          lower: main.lower + (side?.lower ?? 0) + (drink?.lower ?? 0),
          median: main.median + (side?.median ?? 0) + (drink?.median ?? 0),
          upper: main.upper + (side?.upper ?? 0) + (drink?.upper ?? 0),
        },
        [...fastFoodMains, ...sides, ...drinks],
        priced.length,
        true,
      );
    }
    return estimate(
      "single_main",
      "medium",
      main,
      fastFoodMains,
      priced.length,
      false,
    );
  }

  const unitSignal = UNIT_PRICED_RESTAURANT_PATTERN.test(restaurantName) ||
    (unitItems.length >= 3 && unitItems.length / priced.length >= 0.2);
  if (unitSignal && completeMeals.length === 0) return null;

  const sitDownMains = [...regularMains, ...sharedMains];
  if (sitDownMains.length < 3) return null;
  const main = distribution(sitDownMains);
  const side = sides.length > 0 ? distribution(sides) : null;
  const drink = drinks.length > 0 ? distribution(drinks) : null;
  if (side || drink) {
    return estimate(
      "main_plus_sides",
      "medium",
      {
        lower: main.lower + (side?.lower ?? 0) + (drink?.lower ?? 0),
        median: main.median + (side?.median ?? 0) + (drink?.median ?? 0),
        upper: main.upper + (side?.upper ?? 0) + (drink?.upper ?? 0),
      },
      [...sitDownMains, ...sides, ...drinks],
      priced.length,
      true,
    );
  }
  return estimate(
    "single_main",
    "high",
    main,
    sitDownMains,
    priced.length,
    false,
  );

}
