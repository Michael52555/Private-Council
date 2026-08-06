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
  finalGoogleMapsUrl?: string;
  pageTitle?: string;
  consentHandled: boolean;
  resultScope: "dialog" | "new_links" | "navigation" | "none";
  inspectedLinkCount: number;
  visibleControlLabels: string[];
  unresolvedControlLabels: string[];
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

export type ExtractedMenu = {
  source: OrderingSource;
  items: MenuItem[];
  extractionMethod: "json_ld" | "embedded_json" | "dom" | "mixed" | "none";
  fetchedAt: string;
  warnings: string[];
};

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
  };
};
