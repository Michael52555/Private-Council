import type { OrderingSource } from "@/lib/menu/types";

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
  };

  clarificationQuestion:
    | string
    | null;

  source: "mock" | "ai";
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

export type RestaurantCandidate = CandidatePlan & {
  id: string;
  name: string;
  address: string;
  distanceMiles: number;

  estimatedPriceMin: number | null;
  estimatedPriceMax: number | null;
  menuStatus: MenuEnrichmentStatus;
  menuItemCount: number;
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
