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
  restaurantCandidatePoolLimit,
} from "@/lib/restaurant-candidate-pool";
import {
  FOOD_TYPE_OPTIONS,
  type FoodType,
  type RestaurantCandidate,
} from "@/lib/planning-types";
import { googleSearchTypesForFoodPreferences } from "@/lib/restaurant-search-types";

export const runtime = "nodejs";
export const maxDuration = 60;

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

type GoogleNearbyPlace = {
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

type GoogleNearbySearchResponse = {
  places?: GoogleNearbyPlace[];
  error?: { message?: string };
};

const googleNearbyResultLimit = 20;
const broadDiningGoogleTypes = [
  "restaurant",
  "cafe",
  "bakery",
  "coffee_shop",
] as const;
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
  return Math.round(3958.8 * angularDistance * 10) / 10;
}

async function fetchNearbyPlaces(
  origin: GeocodedOrigin,
  radiusMeters: number,
  includedTypes: readonly string[],
  rankPreference: "DISTANCE" | "POPULARITY",
): Promise<GoogleNearbyPlace[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY is not configured.");

  const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location," +
        "places.websiteUri,places.googleMapsUri,places.priceLevel,places.rating," +
        "places.priceRange,places.userRatingCount,places.primaryType,places.types",
    },
    body: JSON.stringify({
      includedTypes,
      maxResultCount: googleNearbyResultLimit,
      rankPreference,
      locationRestriction: {
        circle: {
          center: { latitude: origin.latitude, longitude: origin.longitude },
          radius: radiusMeters,
        },
      },
    }),
    cache: "no-store",
  });

  const data = (await response.json()) as GoogleNearbySearchResponse;
  if (!response.ok) {
    throw new Error(
      data.error?.message ?? `Nearby restaurant search failed with status ${response.status}.`,
    );
  }

  return data.places ?? [];
}

function candidateFromGooglePlace(
  place: GoogleNearbyPlace,
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
      distanceMiles: calculateDistanceMiles(
        origin.latitude,
        origin.longitude,
        latitude,
        longitude,
      ),
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
  const preferredGoogleTypes = googleSearchTypesForFoodPreferences(
    preferredFoodTypes,
  );
  const nearestSearch = fetchNearbyPlaces(
    origin,
    radiusMeters,
    broadDiningGoogleTypes,
    "DISTANCE",
  );
  const generalSearch = fetchNearbyPlaces(
    origin,
    radiusMeters,
    broadDiningGoogleTypes,
    "POPULARITY",
  );
  const preferenceSearch = preferredGoogleTypes.length > 0
    ? fetchNearbyPlaces(
        origin,
        radiusMeters,
        preferredGoogleTypes,
        "POPULARITY",
      ).catch(
        (error) => {
          console.warn(
            "Preference-aware restaurant discovery failed; using the general pool:",
            error,
          );
          return [];
        },
      )
    : Promise.resolve([]);
  const [nearestPlaces, preferredPlaces, generalPlaces] = await Promise.all([
    nearestSearch,
    preferenceSearch,
    generalSearch,
  ]);

  const convertPlaces = (places: readonly GoogleNearbyPlace[]) => places
    .map((place) => candidateFromGooglePlace(place, origin))
    .filter((candidate): candidate is RestaurantCandidate => candidate !== null);

  return mergeRestaurantCandidatePools({
    nearest: convertPlaces(nearestPlaces),
    preferred: convertPlaces(preferredPlaces),
    general: convertPlaces(generalPlaces),
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
