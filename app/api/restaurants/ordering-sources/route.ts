import { NextResponse } from "next/server";
import { discoverOrderingSources } from "@/lib/menu/discovery";

export const runtime = "nodejs";

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

    const result = await discoverOrderingSources({
      placeId,
      websiteUri: typeof body.websiteUri === "string" ? body.websiteUri : undefined,
      googleMapsUri: typeof body.googleMapsUri === "string" ? body.googleMapsUri : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Ordering-source discovery failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not discover ordering sources." },
      { status: 500 },
    );
  }
}
