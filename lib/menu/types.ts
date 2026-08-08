export type OrderingProvider =
  | "restaurant_website"
  | "doordash"
  | "ubereats"
  | "grubhub"
  | "toast"
  | "chownow"
  | "olo"
  | "square"
  | "clover"
  | "google_ordering"
  | "unknown";

export type FulfillmentMethod = "pickup" | "delivery" | "unknown";

export type OrderingSource = {
  id: string;
  provider: OrderingProvider;
  label: string;
  url: string;
  fulfillment: FulfillmentMethod;
  discoveredFrom: "google_maps" | "restaurant_website" | "place_details";
  discoveryMethod?:
    | "google_maps_dialog"
    | "google_maps_new_link"
    | "google_maps_navigation"
    | "website_fallback";
  evidenceText?: string;
};

export type OrderingDiscoveryDiagnostics = {
  browserConfigured: boolean;
  orderControlFound: boolean;
  orderControlLabel?: string;
  orderControlLayout?: "desktop" | "mobile";
  orderingSurface?: "same_page" | "new_page";
  finalGoogleMapsUrl?: string;
  pageTitle?: string;
  consentHandled: boolean;
  resultScope: "dialog" | "new_links" | "navigation" | "none";
  inspectedLinkCount: number;
  visibleControlLabels: string[];
  unresolvedControlLabels: string[];
  skippedUnsupportedProviders?: string[];
};

export type MenuItem = {
  id: string;
  name: string;
  description?: string;
  section?: string;
  price?: number;
  currency?: string;
  imageUrl?: string;
  sourceId: string;
};

export type CapturedJsonPayload = {
  url: string;
  status: number;
  contentType: string;
  data: unknown;
};

export type MenuBrowserDiagnostics = {
  navigationStatus?: number;
  finalUrl: string;
  locationSelectionAttempted: boolean;
  locationSelectionSucceeded: boolean;
  capturedJsonResponseCount: number;
  blockedResponseCount: number;
  capturedJsonEndpoints: string[];
  blockedResponseEndpoints: string[];
};

export type ExtractedMenu = {
  source: OrderingSource;
  items: MenuItem[];
  extractionMethod: "json_ld" | "embedded_json" | "dom" | "mixed" | "none";
  fetchedAt: string;
  warnings: string[];
};

export type MealPattern =
  | "combo_dominant"
  | "single_main"
  | "main_plus_sides"
  | "multiple_small_plates"
  | "shared_dishes"
  | "unit_items";

export type RestaurantMenuResult = {
  placeId: string;
  restaurantName?: string;
  menus: ExtractedMenu[];
  items: MenuItem[];
  priceSummary: {
    minimum: number | null;
    maximum: number | null;
    lowerQuartile: number | null;
    upperQuartile: number | null;
    median: number | null;
    currency: string | null;
    basis:
      | "explicit_meals"
      | "composed_basket"
      | "filtered_menu_items"
      | "all_priced_items"
      | "none";
    confidence?: "high" | "medium" | "low" | "none";
    mealPattern?: MealPattern;
    composed?: boolean;
    sampleItemCount: number;
    excludedItemCount: number;
    sampleItemIds: string[];
  };
};
