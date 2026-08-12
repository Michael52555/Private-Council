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
  { value: "american", label: "American" },
  { value: "chinese", label: "Chinese" },
  { value: "japanese", label: "Japanese" },
  { value: "korean", label: "Korean" },
  { value: "mexican", label: "Mexican" },
  { value: "italian", label: "Italian" },
  { value: "indian", label: "Indian" },
  { value: "thai", label: "Thai" },
  { value: "vietnamese", label: "Vietnamese" },
  { value: "mediterranean", label: "Mediterranean" },
  { value: "middle_eastern", label: "Middle Eastern" },
  { value: "seafood", label: "Seafood" },
  { value: "pizza", label: "Pizza" },
  { value: "burgers", label: "Burgers" },
  { value: "healthy", label: "Healthy" },
  { value: "cafe_bakery", label: "Café & bakery" },
] as const;

export type FoodType = (typeof FOOD_TYPE_OPTIONS)[number]["value"];

export function foodTypeLabel(foodType: FoodType): string {
  return FOOD_TYPE_OPTIONS.find((option) => option.value === foodType)?.label
    ?? foodType;
}

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
  | "google_price_range"
  | "google_price_level"
  | "unavailable";

export type BudgetEstimateConfidence =
  | "high"
  | "medium"
  | "low"
  | "none";

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
