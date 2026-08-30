import {
  FOOD_TYPE_OPTIONS,
  foodTypeFacet,
  type FoodType,
  type FoodTypeFacet,
  type RestaurantFoodVector,
} from "@/lib/planning-types";

type RestaurantFoodVectorInput = {
  primaryType?: string;
  placeTypes?: string[];
};

// Every feature below comes from Google Places `primaryType` or `types`.
// Category types stay categories: for example, hot_pot_restaurant does not
// imply Chinese cuisine unless Google also returns chinese_restaurant.
const GOOGLE_TYPE_FEATURES: Readonly<Record<string, readonly FoodType[]>> = {
  american_restaurant: ["american"],
  chinese_restaurant: ["chinese"],
  cantonese_restaurant: ["chinese"],
  chinese_noodle_restaurant: ["chinese", "noodles"],
  japanese_restaurant: ["japanese"],
  japanese_curry_restaurant: ["japanese"],
  japanese_izakaya_restaurant: ["japanese"],
  tonkatsu_restaurant: ["japanese"],
  yakitori_restaurant: ["japanese"],
  korean_restaurant: ["korean"],
  korean_barbecue_restaurant: ["korean", "barbecue"],
  mexican_restaurant: ["mexican"],
  tex_mex_restaurant: ["mexican"],
  taco_restaurant: ["mexican"],
  burrito_restaurant: ["mexican"],
  italian_restaurant: ["italian"],
  indian_restaurant: ["indian"],
  north_indian_restaurant: ["indian"],
  south_indian_restaurant: ["indian"],
  thai_restaurant: ["thai"],
  vietnamese_restaurant: ["vietnamese"],
  mediterranean_restaurant: ["mediterranean"],
  middle_eastern_restaurant: ["middle_eastern"],
  hot_pot_restaurant: ["hot_pot"],
  barbecue_restaurant: ["barbecue"],
  mongolian_barbecue_restaurant: ["barbecue"],
  sushi_restaurant: ["sushi"],
  noodle_shop: ["noodles"],
  ramen_restaurant: ["noodles"],
  pizza_restaurant: ["pizza"],
  pizza_delivery: ["pizza"],
  hamburger_restaurant: ["burgers"],
  seafood_restaurant: ["seafood"],
  fast_food_restaurant: ["fast_food"],
  food_court: ["fast_food"],
  cafe: ["cafe_bakery"],
  bakery: ["cafe_bakery"],
  coffee_shop: ["cafe_bakery"],
};

export function emptyRestaurantFoodVector(): RestaurantFoodVector {
  return {
    version: 1,
    values: Object.fromEntries(
      FOOD_TYPE_OPTIONS.map((option) => [option.value, 0]),
    ) as Record<FoodType, 0 | 1>,
    knownFacets: [],
  };
}

export function buildRestaurantFoodVector(
  input: RestaurantFoodVectorInput,
): RestaurantFoodVector {
  const vector = emptyRestaurantFoodVector();
  const normalizedTypes = new Set(
    [input.primaryType, ...(input.placeTypes ?? [])]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const knownFacets = new Set<FoodTypeFacet>();

  for (const googleType of normalizedTypes) {
    for (const foodType of GOOGLE_TYPE_FEATURES[googleType] ?? []) {
      vector.values[foodType] = 1;
      knownFacets.add(foodTypeFacet(foodType));
    }
  }

  vector.knownFacets = [...knownFacets];
  return vector;
}

export function buildRestaurantFoodVectorFromTypes(
  foodTypes: readonly FoodType[],
): RestaurantFoodVector {
  const vector = emptyRestaurantFoodVector();
  const knownFacets = new Set<FoodTypeFacet>();

  for (const foodType of foodTypes) {
    vector.values[foodType] = 1;
    knownFacets.add(foodTypeFacet(foodType));
  }

  vector.knownFacets = [...knownFacets];
  return vector;
}

export function activeFoodTypes(
  vector: RestaurantFoodVector,
): FoodType[] {
  return FOOD_TYPE_OPTIONS
    .filter((option) => vector.values[option.value] === 1)
    .map((option) => option.value);
}
