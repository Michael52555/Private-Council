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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      planName?: unknown;
    };

    const planName =
      typeof body.planName === "string"
        ? body.planName.trim()
        : "";

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
  } catch {
    return NextResponse.json(
      {
        error: "Could not generate candidate options.",
      },
      {
        status: 500,
      },
    );
  }
}