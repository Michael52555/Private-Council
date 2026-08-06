import { createHash } from "node:crypto";
import type {
  FulfillmentMethod,
  OrderingProvider,
  OrderingSource,
} from "@/lib/menu/types";

const PROVIDERS: Array<{
  provider: OrderingProvider;
  label: string;
  hostnames: string[];
}> = [
  { provider: "doordash", label: "DoorDash", hostnames: ["doordash.com"] },
  { provider: "ubereats", label: "Uber Eats", hostnames: ["ubereats.com"] },
  { provider: "grubhub", label: "Grubhub", hostnames: ["grubhub.com"] },
  { provider: "toast", label: "Toast", hostnames: ["toasttab.com"] },
  { provider: "chownow", label: "ChowNow", hostnames: ["chownow.com"] },
  { provider: "olo", label: "Olo", hostnames: ["olo.com", "olo.express"] },
  { provider: "square", label: "Square", hostnames: ["square.site", "squareup.com"] },
  { provider: "clover", label: "Clover", hostnames: ["clover.com"] },
  {
    provider: "google_ordering",
    label: "Google ordering",
    hostnames: ["food.google.com", "orderfood.google.com"],
  },
];

function hostnameMatches(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

export function inferProvider(url: string): {
  provider: OrderingProvider;
  label: string;
} {
  const hostname = new URL(url).hostname.toLowerCase();
  const match = PROVIDERS.find((candidate) =>
    candidate.hostnames.some((suffix) => hostnameMatches(hostname, suffix)),
  );

  if (match) {
    return { provider: match.provider, label: match.label };
  }

  return { provider: "restaurant_website", label: hostname.replace(/^www\./, "") };
}

export function inferFulfillment(text: string): FulfillmentMethod {
  if (/delivery|deliver|配送|外送/i.test(text)) return "delivery";
  if (/pickup|pick-up|takeout|take-out|自取|外带/i.test(text)) return "pickup";
  return "unknown";
}

export function unwrapGoogleRedirect(rawUrl: string): string {
  let current = new URL(rawUrl);

  for (let depth = 0; depth < 3; depth += 1) {
    if (!hostnameMatches(current.hostname, "google.com")) return current.toString();

    let target: string | null = null;
    for (const key of ["q", "url", "continue", "adurl", "redirect", "redirect_uri", "target", "u"]) {
      const candidate = current.searchParams.get(key);
      if (candidate?.startsWith("http://") || candidate?.startsWith("https://")) {
        target = candidate;
        break;
      }
    }

    if (!target) return current.toString();
    current = new URL(target);
  }

  return current.toString();
}

export function makeOrderingSource(input: {
  url: string;
  text?: string;
  discoveredFrom: OrderingSource["discoveredFrom"];
  provider?: OrderingProvider;
  label?: string;
  discoveryMethod?: OrderingSource["discoveryMethod"];
  evidenceText?: string;
}): OrderingSource {
  const url = unwrapGoogleRedirect(input.url);
  const inferred = inferProvider(url);
  const id = createHash("sha256").update(url).digest("hex").slice(0, 16);

  return {
    id,
    provider: input.provider ?? inferred.provider,
    label: input.label ?? inferred.label,
    url,
    fulfillment: inferFulfillment(input.text ?? ""),
    discoveredFrom: input.discoveredFrom,
    ...(input.discoveryMethod ? { discoveryMethod: input.discoveryMethod } : {}),
    ...(input.evidenceText ? { evidenceText: input.evidenceText } : {}),
  };
}

export function dedupeSources(sources: OrderingSource[]): OrderingSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const url = new URL(source.url);
    url.hash = "";
    const key = url.toString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isKnownDynamicProvider(provider: OrderingProvider): boolean {
  return [
    "doordash",
    "ubereats",
    "grubhub",
    "toast",
    "chownow",
    "olo",
    "square",
    "clover",
    "google_ordering",
  ].includes(provider);
}
