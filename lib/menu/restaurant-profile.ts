import type { RestaurantMealProfile } from "@/lib/menu/types";

type RestaurantProfileInput = {
  name?: string;
  primaryType?: string;
  placeTypes?: string[];
};

const FAST_FOOD_PLACE_TYPES = new Set([
  "fast_food_restaurant",
  "food_court",
  "cafeteria",
  "meal_takeaway",
  "meal_delivery",
  "pizza_delivery",
  "hamburger_restaurant",
  "hot_dog_restaurant",
  "hot_dog_stand",
  "sandwich_shop",
  "taco_restaurant",
  "burrito_restaurant",
  "chicken_restaurant",
  "chicken_wings_restaurant",
  "salad_shop",
  "snack_bar",
]);

const STRONG_SECONDARY_FAST_FOOD_TYPES = new Set([
  "fast_food_restaurant",
  "food_court",
  "cafeteria",
]);

// Google occasionally supplies only a generic restaurant type for a chain.
// This deliberately short fallback covers common US quick-service brands
// without trying to maintain a complete restaurant database.
const FAST_FOOD_CHAIN_PATTERN = /\b(?:mcdonald'?s|burger king|wendy'?s|taco bell|chipotle|panda express|chick[ -]?fil[ -]?a|in[ -]?n[ -]?out|subway|kfc|popeyes|jack in the box|carl'?s jr|five guys|shake shack|habit burger|blaze pizza|sweetgreen|qdoba|del taco|el pollo loco|jamba|dunkin'?|jersey mike'?s|wingstop)\b/i;

export function classifyRestaurantMealProfile(
  input: RestaurantProfileInput,
): RestaurantMealProfile {
  const primaryType = input.primaryType?.trim().toLowerCase();
  const placeTypes = (input.placeTypes ?? [])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase());

  if (
    (primaryType && FAST_FOOD_PLACE_TYPES.has(primaryType)) ||
    placeTypes.some((type) => STRONG_SECONDARY_FAST_FOOD_TYPES.has(type))
  ) {
    return "fast_food";
  }
  if (FAST_FOOD_CHAIN_PATTERN.test(input.name ?? "")) {
    return "fast_food";
  }
  return "sit_down";
}

