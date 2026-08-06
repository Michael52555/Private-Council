import { NextResponse } from "next/server";
import { makeOrderingSource } from "@/lib/menu/providers";
import type { RestaurantCandidate } from "@/lib/planning-types";

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
  rating?: number;
  userRatingCount?: number;
};

type GoogleNearbySearchResponse = {
  places?: GoogleNearbyPlace[];
  error?: { message?: string };
};

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

async function searchNearbyRestaurants(
  origin: GeocodedOrigin,
  radiusMeters: number,
): Promise<RestaurantCandidate[]> {
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
        "places.userRatingCount",
    },
    body: JSON.stringify({
      includedTypes: ["restaurant"],
      maxResultCount: 10,
      rankPreference: "DISTANCE",
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

  const candidates: RestaurantCandidate[] = [];
  for (const place of data.places ?? []) {
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
      continue;
    }

    candidates.push({
      id,
      name,
      address: place.formattedAddress ?? "Address unavailable",
      distanceMiles: calculateDistanceMiles(
        origin.latitude,
        origin.longitude,
        latitude,
        longitude,
      ),
      pricePerPerson: null,
      estimatedPriceMin: null,
      estimatedPriceMax: null,
      menuStatus: "pending",
      menuItemCount: 0,
      priceLevel: place.priceLevel,
      rating: place.rating,
      userRatingCount: place.userRatingCount,
      websiteUri: place.websiteUri,
      googleMapsUri: place.googleMapsUri,
      orderingSources: place.websiteUri
        ? [
            makeOrderingSource({
              url: place.websiteUri,
              label: "Restaurant website",
              provider: "restaurant_website",
              discoveredFrom: "place_details",
            }),
          ]
        : [],
    });
  }

  return candidates;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      planName?: unknown;
      originAddress?: unknown;
      radiusMiles?: unknown;
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
    );
    return NextResponse.json({
      candidates,
      meta: {
        originResolved: true,
        formattedOrigin: geocodedOrigin.formattedAddress,
        menuEnrichmentRequired: true,
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
