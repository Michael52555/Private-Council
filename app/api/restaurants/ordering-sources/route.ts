import { NextResponse } from "next/server";
import { discoverOrderingSources } from "@/lib/menu/discovery";
import {
  readOrderingDiscoveryCache,
  storeOrderingDiscoveryCache,
} from "@/lib/menu/database-cache";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      placeId?: unknown;
      websiteUri?: unknown;
      googleMapsUri?: unknown;
    };
    const placeId = typeof body.placeId === "string" ? body.placeId.trim() : "";
    if (!placeId || placeId.length > 300) {
      return NextResponse.json({ error: "A valid Google place ID is required." }, { status: 400 });
    }

    let cachedResult: ReturnType<typeof readOrderingDiscoveryCache> = null;
    try {
      cachedResult = readOrderingDiscoveryCache(placeId);
    } catch (cacheError) {
      console.warn("Ordering cache read failed; continuing without cache:", cacheError);
    }
    if (cachedResult) {
      return NextResponse.json(cachedResult, {
        headers: { "X-Restaurant-Cache": "HIT" },
      });
    }

    const result = await discoverOrderingSources({
      placeId,
      websiteUri: typeof body.websiteUri === "string" ? body.websiteUri : undefined,
      googleMapsUri: typeof body.googleMapsUri === "string" ? body.googleMapsUri : undefined,
    });
    try {
      storeOrderingDiscoveryCache(placeId, result);
    } catch (cacheError) {
      console.warn("Ordering cache write failed; returning fresh data:", cacheError);
    }
    return NextResponse.json(result, {
      headers: { "X-Restaurant-Cache": "MISS" },
    });
  } catch (error) {
    console.error("Ordering-source discovery failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not discover ordering sources." },
      { status: 500 },
    );
  }
}
