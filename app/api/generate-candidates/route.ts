import { NextResponse } from "next/server";

const mockCoordinatorCandidates: RestaurantCandidate[] = [
  {
    id: "restaurant-1",
    name: "Sakura Table",
    address: "123 Demo Street",
    distanceMiles: 3.4,
  },
  {
    id: "restaurant-2",
    name: "Nori House",
    address: "456 Demo Avenue",
    distanceMiles: 5.8,
  },
  {
    id: "restaurant-3",
    name: "Tokyo Garden",
    address: "789 Demo Boulevard",
    distanceMiles: 8.1,
  },
];

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
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
  }>;
};

async function geocodeAddress(
  address: string,
): Promise<GeocodedOrigin | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GOOGLE_MAPS_API_KEY is not configured.",
    );
  }

  const geocodingUrl = new URL(
    "https://maps.googleapis.com/maps/api/geocode/json",
  );

  geocodingUrl.searchParams.set("address", address);
  geocodingUrl.searchParams.set("key", apiKey);

  const response = await fetch(geocodingUrl, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Geocoding request failed with status ${response.status}.`,
    );
  }

  const data =
    (await response.json()) as GoogleGeocodingResponse;

  if (data.status === "ZERO_RESULTS") {
    return null;
  }

  if (data.status !== "OK") {
    throw new Error(
      data.error_message ??
        `Geocoding failed with status ${data.status ?? "unknown"}.`,
    );
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
    throw new Error(
      "Geocoding returned invalid coordinates.",
    );
  }

  return {
    formattedAddress:
      firstResult?.formatted_address ?? address,
    latitude,
    longitude,
  };
}

type GoogleNearbyPlace = {
  id?: string;

  displayName?: {
    text?: string;
  };

  formattedAddress?: string;

  location?: {
    latitude?: number;
    longitude?: number;
  };
};

type GoogleNearbySearchResponse = {
  places?: GoogleNearbyPlace[];

  error?: {
    message?: string;
  };
};

type RestaurantCandidate = {
  id: string;
  name: string;
  address: string;
  distanceMiles: number;
};

function degreesToRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

function calculateDistanceMiles(
  originLatitude: number,
  originLongitude: number,
  destinationLatitude: number,
  destinationLongitude: number,
): number {
  const earthRadiusMiles = 3958.8;

  const latitudeDifference = degreesToRadians(
    destinationLatitude - originLatitude,
  );

  const longitudeDifference = degreesToRadians(
    destinationLongitude - originLongitude,
  );

  const originLatitudeRadians =
    degreesToRadians(originLatitude);

  const destinationLatitudeRadians =
    degreesToRadians(destinationLatitude);

  const haversineValue =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(originLatitudeRadians) *
      Math.cos(destinationLatitudeRadians) *
      Math.sin(longitudeDifference / 2) ** 2;

  const angularDistance =
    2 *
    Math.atan2(
      Math.sqrt(haversineValue),
      Math.sqrt(1 - haversineValue),
    );

  const distanceMiles =
    earthRadiusMiles * angularDistance;

  return Math.round(distanceMiles * 10) / 10;
}

async function searchNearbyRestaurants(
  origin: GeocodedOrigin,
): Promise<RestaurantCandidate[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GOOGLE_MAPS_API_KEY is not configured.",
    );
  }

  const response = await fetch(
    "https://places.googleapis.com/v1/places:searchNearby",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location",
      },

      body: JSON.stringify({
        includedTypes: ["restaurant"],
        maxResultCount: 10,
        rankPreference: "DISTANCE",

        locationRestriction: {
          circle: {
            center: {
              latitude: origin.latitude,
              longitude: origin.longitude,
            },

            // Approximately five miles.
            radius: 8000,
          },
        },
      }),

      cache: "no-store",
    },
  );

  const data =
    (await response.json()) as GoogleNearbySearchResponse;

  if (!response.ok) {
    throw new Error(
      data.error?.message ??
        `Nearby restaurant search failed with status ${response.status}.`,
    );
  }

  const places = data.places ?? [];

  const candidates: RestaurantCandidate[] = [];

  for (const place of places) {
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

      address:
        place.formattedAddress ??
        "Address unavailable",

      distanceMiles: calculateDistanceMiles(
        origin.latitude,
        origin.longitude,
        latitude,
        longitude,
      ),
    });
  }

  return candidates;
}

export async function POST(request: Request) {
  try {
    
    const body = (await request.json()) as {
      planName?: unknown;
      originAddress?: unknown;
    };

    const originAddress =
      typeof body.originAddress === "string"
        ? body.originAddress.trim()
        : "";


    const planName =
      typeof body.planName === "string"
        ? body.planName.trim()
        : "";
    

    if (!originAddress) {
      return NextResponse.json(
        {
          error: "A starting address is required.",
        },
        {
          status: 400,
        },
      );
    }

    const geocodedOrigin =
      await geocodeAddress(originAddress);

    if (!geocodedOrigin) {
      return NextResponse.json(
        {
          error:
            "We could not locate that starting address. Please make it more specific.",
        },
        {
          status: 400,
        },
      );
    }

    const candidates =
      await searchNearbyRestaurants(geocodedOrigin);

    // return NextResponse.json({
    //   candidates,

    //   meta: {
    //     originResolved: true,

    //     // Temporary debugging information.
    //     formattedOrigin:
    //       geocodedOrigin.formattedAddress,
    //   },
    // });

    
      return Response.json({
        candidates : [
        {
          id:"1",
          name:"Sushi Gen",
          address:"Downtown LA",
          distanceMiles:2,
          estimatedPriceMin:60,
          estimatedPriceMax:120,
        },

        {
          id:"2",
          name:"Ramen Spot",
          address:"Koreatown",
          distanceMiles:8,
          estimatedPriceMin:15,
          estimatedPriceMax:30,
        },

        {
          id:"3",
          name:"Luxury Steakhouse",
          address:"Beverly Hills",
          distanceMiles:5,
          estimatedPriceMin:150,
          estimatedPriceMax:300,
        },
        ]
      });
    
    

    if (!planName) {
      return NextResponse.json(
        {
          error: "A plan name is required.",
        },
        {
          status: 400,
        },
      );
    }

    // Temporary delay so we can verify the loading state.
    await new Promise((resolve) =>
      setTimeout(resolve, 700),
    );

    return NextResponse.json({
      candidates: mockCoordinatorCandidates,
    });
  } catch (error) {
  console.error(
    "Candidate generation failed:",
    error,
  );

    const message =
      error instanceof Error
        ? error.message
        : "Could not generate candidate options.";

    return NextResponse.json(
      {
        error: message,
      },
      {
        status: 500,
      },
    );
  } 
}

