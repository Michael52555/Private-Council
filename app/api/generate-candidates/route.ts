import { NextResponse } from "next/server";

type RestaurantCandidate = {
  id: string;
  name: string;
  address: string;
  distanceMiles: number;
};

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

    return NextResponse.json({
      candidates: mockCoordinatorCandidates,
      meta: {
        originResolved: true,
        formattedOrigin:
          geocodedOrigin.formattedAddress,
      },
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

