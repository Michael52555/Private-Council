import type { OrderingSource, RestaurantMealProfile } from "@/lib/menu/types";

export type Importance =
  | 1
  | 2
  | 3
  | 4
  | 5;

export type Visibility =
  | "private"
  | "anonymous"
  | "shareable";

export type PlanningMode =
  | "restaurant"
  | "activity"
  | "meeting_place"
  | "custom";

export type PreferenceCategory =
  | "location"
  | "distance"
  | "transportation"
  | "food"
  | "budget"
  | "departure_time"
  | "return_time"
  | "other";

export const FOOD_TYPE_OPTIONS = [
  { value: "american", label: "American", facet: "cuisine" },
  { value: "chinese", label: "Chinese", facet: "cuisine" },
  { value: "japanese", label: "Japanese", facet: "cuisine" },
  { value: "korean", label: "Korean", facet: "cuisine" },
  { value: "mexican", label: "Mexican", facet: "cuisine" },
  { value: "italian", label: "Italian", facet: "cuisine" },
  { value: "indian", label: "Indian", facet: "cuisine" },
  { value: "thai", label: "Thai", facet: "cuisine" },
  { value: "vietnamese", label: "Vietnamese", facet: "cuisine" },
  { value: "mediterranean", label: "Mediterranean", facet: "cuisine" },
  { value: "middle_eastern", label: "Middle Eastern", facet: "cuisine" },
  { value: "hot_pot", label: "Hot pot", facet: "style" },
  { value: "barbecue", label: "BBQ", facet: "style" },
  { value: "sushi", label: "Sushi", facet: "style" },
  { value: "noodles", label: "Noodles", facet: "style" },
  { value: "pizza", label: "Pizza", facet: "style" },
  { value: "burgers", label: "Burgers", facet: "style" },
  { value: "seafood", label: "Seafood", facet: "style" },
  { value: "fast_food", label: "Fast food", facet: "style" },
  { value: "cafe_bakery", label: "Café & bakery", facet: "style" },
] as const;

export type FoodType = (typeof FOOD_TYPE_OPTIONS)[number]["value"];
export type FoodTypeFacet = (typeof FOOD_TYPE_OPTIONS)[number]["facet"];

export const FOOD_TYPE_FACETS: ReadonlyArray<{
  value: FoodTypeFacet;
  label: string;
}> = [
  { value: "cuisine", label: "Cuisine" },
  { value: "style", label: "Food & style" },
];

export function foodTypeLabel(foodType: FoodType): string {
  return FOOD_TYPE_OPTIONS.find((option) => option.value === foodType)?.label
    ?? foodType;
}

export function foodTypeFacet(foodType: FoodType): FoodTypeFacet {
  return FOOD_TYPE_OPTIONS.find((option) => option.value === foodType)?.facet
    ?? "style";
}

export type RestaurantFoodVector = {
  version: 1;
  values: Record<FoodType, 0 | 1>;
  knownFacets: FoodTypeFacet[];
};

export type PreferenceInterpretation = {
  status:
    | "success"
    | "needs_clarification";

  summary: string;

  structuredData: {
    locationText?: string;
    maxDistanceMiles?: number;
    minPriceDollarsPerPerson?: number;
    preferredPriceDollarsPerPerson?: number;
    maxPriceDollarsPerPerson?: number;
    preferredFoodTypes?: FoodType[];
  };

  clarificationQuestion:
    | string
    | null;

  source: "mock" | "ai" | "fixed";
  confirmed: boolean;
};


export type CandidatePlan = {
  id: string;
  name: string;
  distanceMiles: number;
  pricePerPerson: number | null;

};

export type MenuEnrichmentStatus =
  | "pending"
  | "loading"
  | "loaded"
  | "unavailable";

export type BudgetEstimateSource =
  | "menu"
  | "api_profile"
  | "google_price_range"
  | "google_price_level"
  | "heuristic_fallback"
  | "unavailable";

export type BudgetEstimateConfidence =
  | "high"
  | "medium"
  | "low"
  | "none";

export type FoodTypeEstimateSource =
  | "api_profile"
  | "google_types_fallback";

export type RestaurantCandidate = CandidatePlan & {
  id: string;
  name: string;
  address: string;
  distanceMiles: number;

  estimatedPriceMin: number | null;
  estimatedPriceMax: number | null;
  googleEstimatedPriceMin: number | null;
  googleEstimatedPriceMax: number | null;
  googleEstimatedPriceMidpoint: number | null;
  googleBudgetEstimateSource: Exclude<BudgetEstimateSource, "menu">;
  googleBudgetEstimateConfidence: BudgetEstimateConfidence;
  googleBudgetEstimateCurrency: string | null;
  budgetEstimateSource: BudgetEstimateSource;
  budgetEstimateConfidence: BudgetEstimateConfidence;
  budgetEstimateCurrency: string | null;
  menuStatus: MenuEnrichmentStatus;
  menuItemCount: number;
  restaurantMealProfile: RestaurantMealProfile;
  foodTypeVector: RestaurantFoodVector;
  foodTypeEstimateSource: FoodTypeEstimateSource;
  foodTypeEstimateConfidence: BudgetEstimateConfidence;
  primaryType?: string;
  placeTypes: string[];
  priceLevel?: string;
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  googleMapsUri?: string;
  orderingSources: OrderingSource[];
};

export type Preference = {
  id: string;
  category: PreferenceCategory;
  statement: string;
  importance: Importance;
  visibility: Visibility;
  interpretation?: PreferenceInterpretation;
};

export type RoomConfig = {
  version: 1;
  mode: PlanningMode;
  enabledCategories:
    PreferenceCategory[];
  updatedAt: string;
};

export type LocalAgentState = {
  version: 1;
  displayName: string;

  selectedCategories:
    PreferenceCategory[];

  privateOriginAddress: string;
  preferences: Preference[];

  updatedAt: string;
};
