import { NextResponse } from "next/server";
import {
  googleBudgetEstimate,
  type GooglePriceRange,
} from "@/lib/budget-estimate";
import { classifyRestaurantMealProfile } from "@/lib/menu/restaurant-profile";
import { buildRestaurantFoodVector } from "@/lib/restaurant-food-vector";
import { profileRestaurantCandidates } from "@/lib/restaurant-profiler";
import {
  mergeRestaurantCandidatePools,
  preferenceSearchResultTarget,
  restaurantCandidatePoolLimit,
  roundRobinRestaurantPools,
} from "@/lib/restaurant-candidate-pool";
import {
  FOOD_TYPE_OPTIONS,
  foodTypeLabel,
  type FoodType,
  type RestaurantCandidate,
} from "@/lib/planning-types";

export const runtime = "nodejs";
export const maxDuration = 120;

type GeocodedOrigin = {
  formattedAddress: string;
  latitude: number;
  longitude: number;
};

type GoogleGeocodingResponse = {
  status?: string;
  error_message?: string;
  results?: Array<{
    formatted_address?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
  }>;
};

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  websiteUri?: string;
  googleMapsUri?: string;
  priceLevel?: string;
  priceRange?: GooglePriceRange;
  primaryType?: string;
  types?: string[];
  rating?: number;
  userRatingCount?: number;
};

type GoogleTextSearchResponse = {
  places?: GooglePlace[];
  nextPageToken?: string;
  error?: { message?: string };
};

const googleTextSearchPageSize = 20;
const googleTextSearchMaximumPages = 3;
const nearestSearchResultTarget = 60;
const foodTypeValues = new Set<string>(
  FOOD_TYPE_OPTIONS.map((option) => option.value),
);

async function geocodeAddress(address: string): Promise<GeocodedOrigin | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY is not configured.");

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Geocoding request failed with status ${response.status}.`);

  const data = (await response.json()) as GoogleGeocodingResponse;
  if (data.status === "ZERO_RESULTS") return null;
  if (data.status !== "OK") {
    throw new Error(data.error_message ?? `Geocoding failed with status ${data.status ?? "unknown"}.`);
  }

  const firstResult = data.results?.[0];
  const latitude = firstResult?.geometry?.location?.lat;
  const longitude = firstResult?.geometry?.location?.lng;
  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude)
  ) {
    throw new Error("Geocoding returned invalid coordinates.");
  }

  return {
    formattedAddress: firstResult?.formatted_address ?? address,
    latitude,
    longitude,
  };
}

function degreesToRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

function calculateDistanceMiles(
  originLatitude: number,
  originLongitude: number,
  destinationLatitude: number,
  destinationLongitude: number,
): number {
  const latitudeDifference = degreesToRadians(destinationLatitude - originLatitude);
  const longitudeDifference = degreesToRadians(destinationLongitude - originLongitude);
  const originLatitudeRadians = degreesToRadians(originLatitude);
  const destinationLatitudeRadians = degreesToRadians(destinationLatitude);
  const haversineValue =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(originLatitudeRadians) *
      Math.cos(destinationLatitudeRadians) *
      Math.sin(longitudeDifference / 2) ** 2;
  const angularDistance =
    2 * Math.atan2(Math.sqrt(haversineValue), Math.sqrt(1 - haversineValue));
  return 3958.8 * angularDistance;
}

function textSearchRectangle(origin: GeocodedOrigin, radiusMeters: number) {
  const latitudeDelta = radiusMeters / 111_320;
  const longitudeScale = Math.max(
    Math.abs(Math.cos(degreesToRadians(origin.latitude))),
    0.01,
  );
  const longitudeDelta = radiusMeters / (111_320 * longitudeScale);
  return {
    low: {
      latitude: Math.max(-90, origin.latitude - latitudeDelta),
      longitude: Math.max(-180, origin.longitude - longitudeDelta),
    },
    high: {
      latitude: Math.min(90, origin.latitude + latitudeDelta),
      longitude: Math.min(180, origin.longitude + longitudeDelta),
    },
  };
}

async function fetchTextSearchPlaces({
  origin,
  radiusMeters,
  textQuery,
  rankPreference,
  includedType,
  targetCount,
}: {
  origin: GeocodedOrigin;
  radiusMeters: number;
  textQuery: string;
  rankPreference: "DISTANCE" | "RELEVANCE";
  includedType?: string;
  targetCount: number;
}): Promise<GooglePlace[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY is not configured.");

  const places: GooglePlace[] = [];
  let pageToken: string | undefined;
  for (
    let page = 0;
    page < googleTextSearchMaximumPages && places.length < targetCount;
    page += 1
  ) {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location," +
          "places.websiteUri,places.googleMapsUri,places.priceLevel,places.rating," +
          "places.priceRange,places.userRatingCount,places.primaryType,places.types," +
          "nextPageToken",
      },
      body: JSON.stringify({
        textQuery,
        pageSize: googleTextSearchPageSize,
        rankPreference,
        ...(includedType
          ? { includedType, strictTypeFiltering: true }
          : {}),
        locationRestriction: {
          rectangle: textSearchRectangle(origin, radiusMeters),
        },
        ...(pageToken ? { pageToken } : {}),
      }),
      cache: "no-store",
    });

    const data = (await response.json()) as GoogleTextSearchResponse;
    if (!response.ok) {
      const error = new Error(
        data.error?.message ?? `Restaurant text search failed with status ${response.status}.`,
      );
      if (places.length === 0) throw error;
      console.warn("A later restaurant search page failed; keeping earlier results:", error);
      break;
    }

    places.push(...(data.places ?? []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return places.slice(0, targetCount);
}

function candidateFromGooglePlace(
  place: GooglePlace,
  origin: GeocodedOrigin,
): RestaurantCandidate | null {
  const id = place.id;
  const name = place.displayName?.text;
  const latitude = place.location?.latitude;
  const longitude = place.location?.longitude;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }

  const googleBudget = googleBudgetEstimate({
    priceRange: place.priceRange,
    priceLevel: place.priceLevel,
  });
  const placeTypes = Array.isArray(place.types)
    ? place.types.filter((type): type is string => typeof type === "string")
    : [];
  const restaurantMealProfile = classifyRestaurantMealProfile({
    name,
    primaryType: place.primaryType,
    placeTypes,
  });
  return {
    id,
    name,
    address: place.formattedAddress ?? "Address unavailable",
    distanceMiles: Math.round(
      calculateDistanceMiles(
          origin.latitude,
          origin.longitude,
          latitude,
          longitude,
        ) * 10,
    ) / 10,
    // Google pricing is retained only as a final fallback. It must not be
    // promoted to the active estimate before menu enrichment has finished.
    pricePerPerson: null,
    estimatedPriceMin: null,
    estimatedPriceMax: null,
    googleEstimatedPriceMin: googleBudget.minimum,
    googleEstimatedPriceMax: googleBudget.maximum,
    googleEstimatedPriceMidpoint: googleBudget.midpoint,
    googleBudgetEstimateSource: googleBudget.source,
    googleBudgetEstimateConfidence: googleBudget.confidence,
    googleBudgetEstimateCurrency: googleBudget.currency,
    budgetEstimateSource: "unavailable",
    budgetEstimateConfidence: "none",
    budgetEstimateCurrency: null,
    menuStatus: "pending",
    menuItemCount: 0,
    restaurantMealProfile,
    foodTypeVector: buildRestaurantFoodVector({
      primaryType: place.primaryType,
      placeTypes,
    }),
    foodTypeEstimateSource: "google_types_fallback",
    foodTypeEstimateConfidence: place.primaryType || placeTypes.length > 0
      ? "medium"
      : "low",
    primaryType: place.primaryType,
    placeTypes,
    priceLevel: place.priceLevel,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    websiteUri: place.websiteUri,
    googleMapsUri: place.googleMapsUri,
    orderingSources: [],
  };
}

async function searchNearbyRestaurants(
  origin: GeocodedOrigin,
  radiusMeters: number,
  preferredFoodTypes: readonly FoodType[],
): Promise<RestaurantCandidate[]> {
  const nearestSearch = fetchTextSearchPlaces({
    origin,
    radiusMeters,
    textQuery: "restaurants",
    rankPreference: "DISTANCE",
    includedType: "restaurant",
    targetCount: nearestSearchResultTarget,
  });
  const preferenceTarget = preferenceSearchResultTarget(
    preferredFoodTypes.length,
  );
  const preferenceSearches = preferredFoodTypes.map((foodType) =>
    fetchTextSearchPlaces({
      origin,
      radiusMeters,
      textQuery: `${foodTypeLabel(foodType)} restaurants`,
      rankPreference: "RELEVANCE",
      // Generic discovery is strictly restaurants. Coffee shops and bakeries
      // are eligible only when the user explicitly selected Café & bakery.
      includedType: foodType === "cafe_bakery" ? undefined : "restaurant",
      targetCount: preferenceTarget,
    }).catch((error) => {
      console.warn(
        `Preference-aware restaurant discovery failed for ${foodType}:`,
        error,
      );
      return [];
    }),
  );
  const fallbackPreferenceSearch = preferredFoodTypes.length === 0
    ? fetchTextSearchPlaces({
        origin,
        radiusMeters,
        textQuery: "popular restaurants",
        rankPreference: "RELEVANCE",
        includedType: "restaurant",
        targetCount: nearestSearchResultTarget,
      }).catch((error) => {
        console.warn("General restaurant discovery failed:", error);
        return [];
      })
    : Promise.resolve([]);
  const [
    nearestPlaces,
    preferencePlacePools,
    fallbackPreferencePlaces,
  ] = await Promise.all([
    nearestSearch,
    Promise.all(preferenceSearches),
    fallbackPreferenceSearch,
  ]);

  const radiusMiles = radiusMeters / 1609.344;
  const convertPlaces = (places: readonly GooglePlace[]) => places
    .filter((place) => {
      const latitude = place.location?.latitude;
      const longitude = place.location?.longitude;
      return typeof latitude === "number"
        && typeof longitude === "number"
        && calculateDistanceMiles(
          origin.latitude,
          origin.longitude,
          latitude,
          longitude,
        ) <= radiusMiles;
    })
    .map((place) => candidateFromGooglePlace(place, origin))
    .filter((candidate): candidate is RestaurantCandidate => candidate !== null);
  const preferredPlaces = preferredFoodTypes.length > 0
    ? roundRobinRestaurantPools(preferencePlacePools)
    : fallbackPreferencePlaces;

  return mergeRestaurantCandidatePools({
    nearest: convertPlaces(nearestPlaces),
    preferred: convertPlaces(preferredPlaces),
    general: [],
    limit: restaurantCandidatePoolLimit,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      planName?: unknown;
      originAddress?: unknown;
      radiusMiles?: unknown;
      preferredFoodTypes?: unknown;
    };
    const planName = typeof body.planName === "string" ? body.planName.trim() : "";
    const originAddress =
      typeof body.originAddress === "string" ? body.originAddress.trim() : "";
    if (!planName) {
      return NextResponse.json({ error: "A plan name is required." }, { status: 400 });
    }
    if (!originAddress) {
      return NextResponse.json({ error: "A starting address is required." }, { status: 400 });
    }

    const radiusMiles =
      typeof body.radiusMiles === "number" && Number.isFinite(body.radiusMiles)
        ? Math.min(Math.max(body.radiusMiles, 1), 30)
        : 5;
    const preferredFoodTypes = Array.isArray(body.preferredFoodTypes)
      ? [...new Set(body.preferredFoodTypes.filter(
          (value): value is FoodType =>
            typeof value === "string" && foodTypeValues.has(value),
        ))]
      : [];
    const geocodedOrigin = await geocodeAddress(originAddress);
    if (!geocodedOrigin) {
      return NextResponse.json(
        { error: "We could not locate that starting address. Please make it more specific." },
        { status: 400 },
      );
    }

    const candidates = await searchNearbyRestaurants(
      geocodedOrigin,
      Math.round(radiusMiles * 1609.344),
      preferredFoodTypes,
    );

    const profiled = await profileRestaurantCandidates(candidates);
    return NextResponse.json({
      candidates: profiled.candidates,
      meta: {
        originResolved: true,
        formattedOrigin: geocodedOrigin.formattedAddress,
        profileCacheHitCount: profiled.cacheHitCount,
        apiProfileCount: profiled.apiProfileCount,
        fallbackProfileCount: profiled.fallbackCount,
      },
    });
  } catch (error) {
    console.error("Candidate generation failed:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not generate candidate options.",
      },
      { status: 500 },
    );
  }
}
