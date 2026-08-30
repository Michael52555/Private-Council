import { NextResponse } from "next/server";
import { extractRestaurantMenus } from "@/lib/menu/extractor";
import {
  readMenuCache,
  isTransientProviderFailureReason,
  storeMenuFailure,
  storeMenuSuccessOnce,
} from "@/lib/menu/database-cache";
import { runSingleFlight } from "@/lib/menu/singleflight";
import { hasReliableMealEstimate } from "@/lib/menu/meal-estimate";
import { classifyMenuItem } from "@/lib/menu/meal-composition";
import { activeProviderAdapterForUrl } from "@/lib/menu/adapters";
import type { OrderingSource, RestaurantMealProfile } from "@/lib/menu/types";

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
      mealProfile?: unknown;
      sources?: unknown;
      retryFailed?: unknown;
    };
    const placeId = typeof body.placeId === "string" ? body.placeId.trim() : "";
    if (!placeId || placeId.length > 300) {
      return NextResponse.json({ error: "A valid Google place ID is required." }, { status: 400 });
    }
    if (!Array.isArray(body.sources)) {
      return NextResponse.json({ error: "At least one ordering source is required." }, { status: 400 });
    }

    // Reject stale client/discovery-cache sources for providers that are not in
    // the current live allowlist. DoorDash remains implemented but inactive;
    // production extraction currently accepts Grubhub only.
    const sources = body.sources
      .filter(isOrderingSource)
      .filter((source) => Boolean(activeProviderAdapterForUrl(source.url)))
      .slice(0, 3);
    const retryFailed = body.retryFailed === true;
    const mealProfile: RestaurantMealProfile = body.mealProfile === "fast_food"
      ? "fast_food"
      : "sit_down";
    if (sources.length === 0) {
      return NextResponse.json({ error: "No valid HTTPS ordering sources were supplied." }, { status: 400 });
    }

    let cachedMenu: ReturnType<typeof readMenuCache> = { status: "miss" };
    try {
      cachedMenu = readMenuCache(placeId, sources, {
        ignoreRecentFailure: retryFailed,
      });
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
        {
          error: cachedMenu.reason,
          retryable: isTransientProviderFailureReason(cachedMenu.reason),
        },
        {
          status: isTransientProviderFailureReason(cachedMenu.reason) ? 429 : 503,
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

    const result = await runSingleFlight(`menu:${placeId}`, async () => {
      try {
        const cacheRecheck = readMenuCache(placeId, sources, {
          ignoreRecentFailure: retryFailed,
        });
        if (cacheRecheck.status === "success") return cacheRecheck.result;
      } catch (cacheError) {
        console.warn("Menu cache recheck failed:", cacheError);
      }

      let freshResult;
      try {
        freshResult = await extractRestaurantMenus({
          placeId,
          restaurantName: typeof body.restaurantName === "string" ? body.restaurantName.trim() : undefined,
          restaurantAddress: typeof body.restaurantAddress === "string"
            ? body.restaurantAddress.trim().slice(0, 500)
            : undefined,
          mealProfile,
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
      const rawPricedItemCount = freshResult.items.filter(
        (item) => typeof item.price === "number" && Number.isFinite(item.price),
      ).length;
      // Persist extracted facts even when today's estimator cannot yet turn them
      // into a reliable per-person basket. A later estimator version can reuse
      // these prices without hitting the provider again.
      if (rawPricedItemCount > 0) {
        try {
          storeMenuSuccessOnce(placeId, sources, freshResult);
        } catch (cacheError) {
          console.warn("Raw menu cache write failed; returning fresh data:", cacheError);
        }
      }
      if (!hasReliableMealEstimate(freshResult.priceSummary)) {
        const extractionWarnings = freshResult.menus.flatMap((menu) => menu.warnings);
        const rateLimited = extractionWarnings.some((warning) =>
          isTransientProviderFailureReason(warning),
        );
        const failureReason = rateLimited
          ? `${sources[0].label} temporarily rate-limited menu extraction (HTTP 429).`
          : "No reliable menu-price sample was found recently.";
        try {
          storeMenuFailure(placeId, sources, failureReason);
        } catch (cacheError) {
          console.warn("Menu failure cache write failed:", cacheError);
        }
      }
      console.info("Menu extraction completed", {
        placeId,
        restaurantName: freshResult.restaurantName,
        mealProfile: freshResult.mealProfile,
        restaurantTags: freshResult.restaurantTags,
        sourceProviders: sources.map((source) => source.provider),
        menuItemCount: freshResult.items.length,
        rawPricedItemCount,
        rawPricedSample: freshResult.items.slice(0, 8).map((item) => ({
          name: item.name,
          price: item.price,
          section: item.section,
          role: classifyMenuItem(item),
        })),
        pricedSampleCount: freshResult.priceSummary.sampleItemCount,
        estimateConfidence: freshResult.priceSummary.confidence,
        estimatePattern: freshResult.priceSummary.mealPattern,
        warnings: freshResult.menus.flatMap((menu) => menu.warnings).slice(0, 12),
      });
      return freshResult;
    });
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

