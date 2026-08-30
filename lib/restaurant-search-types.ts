import type { FoodType } from "@/lib/planning-types";

// Google Nearby Search accepts the official Table A place types below as
// filters. These filters only widen the candidate pool toward the user's
// preferences; the API restaurant profiler remains the source of truth for
// the labels used by scoring.
const GOOGLE_SEARCH_TYPES_BY_FOOD_TYPE: Readonly<
  Record<FoodType, readonly string[]>
> = {
  american: ["american_restaurant"],
  chinese: [
    "chinese_restaurant",
    "cantonese_restaurant",
    "chinese_noodle_restaurant",
    "dim_sum_restaurant",
  ],
  japanese: [
    "japanese_restaurant",
    "japanese_curry_restaurant",
    "japanese_izakaya_restaurant",
    "tonkatsu_restaurant",
    "yakitori_restaurant",
  ],
  korean: ["korean_restaurant", "korean_barbecue_restaurant"],
  mexican: [
    "mexican_restaurant",
    "tex_mex_restaurant",
    "taco_restaurant",
    "burrito_restaurant",
  ],
  italian: ["italian_restaurant"],
  indian: [
    "indian_restaurant",
    "north_indian_restaurant",
    "south_indian_restaurant",
  ],
  thai: ["thai_restaurant"],
  vietnamese: ["vietnamese_restaurant"],
  mediterranean: ["mediterranean_restaurant", "greek_restaurant"],
  middle_eastern: [
    "middle_eastern_restaurant",
    "lebanese_restaurant",
    "persian_restaurant",
    "turkish_restaurant",
    "falafel_restaurant",
    "kebab_shop",
    "shawarma_restaurant",
  ],
  hot_pot: ["hot_pot_restaurant"],
  barbecue: [
    "barbecue_restaurant",
    "korean_barbecue_restaurant",
    "mongolian_barbecue_restaurant",
  ],
  sushi: ["sushi_restaurant"],
  noodles: [
    "noodle_shop",
    "ramen_restaurant",
    "chinese_noodle_restaurant",
  ],
  pizza: ["pizza_restaurant", "pizza_delivery"],
  burgers: ["hamburger_restaurant"],
  seafood: ["seafood_restaurant"],
  fast_food: ["fast_food_restaurant", "food_court"],
  cafe_bakery: [
    "cafe",
    "bakery",
    "coffee_shop",
    "bagel_shop",
    "pastry_shop",
  ],
};

export function googleSearchTypesForFoodPreferences(
  foodTypes: readonly FoodType[],
): string[] {
  return [...new Set(
    foodTypes.flatMap((foodType) =>
      GOOGLE_SEARCH_TYPES_BY_FOOD_TYPE[foodType] ?? []
    ),
  )].slice(0, 50);
}
