import { NextResponse } from "next/server";
import { extractRestaurantMenus } from "@/lib/menu/extractor";
import type { OrderingSource } from "@/lib/menu/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function isOrderingSource(value: unknown): value is OrderingSource {
  if (typeof value !== "object" || value === null) return false;
  const source = value as Partial<OrderingSource>;
  return (
    typeof source.id === "string" &&
    typeof source.url === "string" &&
    source.url.startsWith("https://") &&
    typeof source.provider === "string" &&
    typeof source.label === "string" &&
    typeof source.fulfillment === "string" &&
    typeof source.discoveredFrom === "string"
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      placeId?: unknown;
      restaurantName?: unknown;
      restaurantAddress?: unknown;
      sources?: unknown;
    };
    const placeId = typeof body.placeId === "string" ? body.placeId.trim() : "";
    if (!placeId || placeId.length > 300) {
      return NextResponse.json({ error: "A valid Google place ID is required." }, { status: 400 });
    }
    if (!Array.isArray(body.sources)) {
      return NextResponse.json({ error: "At least one ordering source is required." }, { status: 400 });
    }

    const sources = body.sources.filter(isOrderingSource).slice(0, 3);
    if (sources.length === 0) {
      return NextResponse.json({ error: "No valid HTTPS ordering sources were supplied." }, { status: 400 });
    }

    const result = await extractRestaurantMenus({
      placeId,
      restaurantName: typeof body.restaurantName === "string" ? body.restaurantName.trim() : undefined,
      restaurantAddress: typeof body.restaurantAddress === "string"
        ? body.restaurantAddress.trim().slice(0, 500)
        : undefined,
      sources,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Menu extraction failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not extract the restaurant menu." },
      { status: 500 },
    );
  }
}
