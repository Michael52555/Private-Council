import { NextResponse } from "next/server";
import { extractRestaurantMenus } from "@/lib/menu/extractor";
import {
  readMenuCache,
  storeMenuFailure,
  storeMenuSuccessOnce,
} from "@/lib/menu/database-cache";
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

    let cachedMenu: ReturnType<typeof readMenuCache> = { status: "miss" };
    try {
      cachedMenu = readMenuCache(placeId);
    } catch (cacheError) {
      console.warn("Menu cache read failed; continuing without cache:", cacheError);
    }
    if (cachedMenu.status === "success") {
      return NextResponse.json(cachedMenu.result, {
        headers: {
          "X-Restaurant-Cache": "HIT",
          "X-Restaurant-Cache-Stored-At": cachedMenu.storedAt,
        },
      });
    }
    if (cachedMenu.status === "recent_failure") {
      return NextResponse.json(
        { error: cachedMenu.reason },
        {
          status: 503,
          headers: {
            "X-Restaurant-Cache": "NEGATIVE-HIT",
            "Retry-After": Math.max(
              1,
              Math.ceil((Date.parse(cachedMenu.retryAfter) - Date.now()) / 1000),
            ).toString(),
          },
        },
      );
    }

    let result;
    try {
      result = await extractRestaurantMenus({
        placeId,
        restaurantName: typeof body.restaurantName === "string" ? body.restaurantName.trim() : undefined,
        restaurantAddress: typeof body.restaurantAddress === "string"
          ? body.restaurantAddress.trim().slice(0, 500)
          : undefined,
        sources,
      });
    } catch (error) {
      try {
        storeMenuFailure(
          placeId,
          sources,
          error instanceof Error ? error.message : "Could not extract the restaurant menu.",
        );
      } catch (cacheError) {
        console.warn("Menu failure cache write failed:", cacheError);
      }
      throw error;
    }
    if (result.priceSummary.sampleItemCount >= 3) {
      try {
        storeMenuSuccessOnce(placeId, sources, result);
      } catch (cacheError) {
        console.warn("Menu cache write failed; returning fresh data:", cacheError);
      }
    } else {
      try {
        storeMenuFailure(placeId, sources, "No reliable menu-price sample was found recently.");
      } catch (cacheError) {
        console.warn("Menu failure cache write failed:", cacheError);
      }
    }
    return NextResponse.json(result, {
      headers: { "X-Restaurant-Cache": "MISS" },
    });
  } catch (error) {
    console.error("Menu extraction failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not extract the restaurant menu." },
      { status: 500 },
    );
  }
}
