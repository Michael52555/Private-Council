import { discoverGoogleOrderingLinks, BrowserNotConfiguredError, isBrowserConfigured } from "@/lib/menu/browser";
import { discoverOrderLinksFromHtml } from "@/lib/menu/html";
import { dedupeSources, makeOrderingSource } from "@/lib/menu/providers";
import { fetchPublicHtml } from "@/lib/menu/security";
import type { OrderingSource } from "@/lib/menu/types";

type GooglePlaceDetails = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  error?: { message?: string };
};

export type OrderingDiscoveryResult = {
  place: {
    id: string;
    name?: string;
    address?: string;
    websiteUri?: string;
    googleMapsUri: string;
  };
  sources: OrderingSource[];
  warnings: string[];
};

async function fetchPlaceDetails(placeId: string): Promise<GooglePlaceDetails> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY is not configured.");

  const response = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    {
      cache: "no-store",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "id,displayName,formattedAddress,websiteUri,googleMapsUri",
      },
    },
  );
  const data = (await response.json()) as GooglePlaceDetails;
  if (!response.ok) {
    throw new Error(data.error?.message ?? `Google Place Details failed with HTTP ${response.status}.`);
  }
  return data;
}

export async function discoverOrderingSources(input: {
  placeId: string;
  websiteUri?: string;
  googleMapsUri?: string;
}): Promise<OrderingDiscoveryResult> {
  const suppliedDetails = input.websiteUri && input.googleMapsUri;
  const details = suppliedDetails
    ? ({ id: input.placeId, websiteUri: input.websiteUri, googleMapsUri: input.googleMapsUri } satisfies GooglePlaceDetails)
    : await fetchPlaceDetails(input.placeId);

  const websiteUri = input.websiteUri ?? details.websiteUri;
  const googleMapsUri =
    input.googleMapsUri ??
    details.googleMapsUri ??
    `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(input.placeId)}`;
  const sources: OrderingSource[] = [];
  const warnings: string[] = [];

  if (websiteUri) {
    sources.push(
      makeOrderingSource({
        url: websiteUri,
        label: "Restaurant website",
        provider: "restaurant_website",
        discoveredFrom: "place_details",
      }),
    );

    try {
      const { html, finalUrl } = await fetchPublicHtml(websiteUri);
      sources.push(...discoverOrderLinksFromHtml(html, finalUrl));
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? `Restaurant website discovery failed: ${error.message}`
          : "Restaurant website discovery failed.",
      );
    }
  }

  if (isBrowserConfigured()) {
    try {
      sources.push(...(await discoverGoogleOrderingLinks(googleMapsUri)));
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? `Google Maps ordering discovery failed: ${error.message}`
          : "Google Maps ordering discovery failed.",
      );
    }
  } else {
    warnings.push(
      new BrowserNotConfiguredError().message +
        " Restaurant-website menu links were still discovered without a browser.",
    );
  }

  return {
    place: {
      id: details.id ?? input.placeId,
      name: details.displayName?.text,
      address: details.formattedAddress,
      websiteUri,
      googleMapsUri,
    },
    sources: dedupeSources(sources),
    warnings,
  };
}
