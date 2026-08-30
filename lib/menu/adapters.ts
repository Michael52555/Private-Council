import type { OrderingProvider } from "@/lib/menu/types";

export type MenuAdapterId =
  | "doordash"
  | "ubereats"
  | "grubhub"
  | "toast"
  | "olo"
  | "chownow"
  | "square"
  | "clover"
  | "panda_express"
  | "habit_burger"
  | "taco_bell"
  | "chick_fil_a";

export type MenuProviderAdapter = {
  id: MenuAdapterId;
  label: string;
  provider: OrderingProvider;
  hostnames: string[];
  controlAliases: RegExp[];
  captureNetworkJson: boolean;
};

// Google Maps can mix restaurant-owned websites with ordering platforms in the
// same panel. New discovery deliberately selects only these reusable provider
// integrations, while preserving Google's top-to-bottom link order.
export const ACTIVE_PROVIDER_ADAPTER_IDS = [
  "grubhub",
  // DoorDash remains in MENU_PROVIDER_ADAPTERS so its scraper can be repaired
  // and re-enabled later. It is deliberately excluded from live discovery for
  // now because its browser-verification page is not reliable enough.
] as const satisfies readonly MenuAdapterId[];

const activeProviderAdapterIds = new Set<MenuAdapterId>(
  ACTIVE_PROVIDER_ADAPTER_IDS,
);

// This registry is intentionally explicit. Google Maps links that are not in
// this list remain visible in diagnostics, but menu discovery skips downward to
// the first provider for which we have a scraper strategy.
export const MENU_PROVIDER_ADAPTERS: readonly MenuProviderAdapter[] = [
  {
    id: "doordash",
    label: "DoorDash",
    provider: "doordash",
    hostnames: ["doordash.com"],
    controlAliases: [/door\s*dash/i],
    captureNetworkJson: true,
  },
  {
    id: "ubereats",
    label: "Uber Eats",
    provider: "ubereats",
    hostnames: ["ubereats.com"],
    controlAliases: [/uber\s*eats/i],
    captureNetworkJson: true,
  },
  {
    id: "grubhub",
    label: "Grubhub",
    provider: "grubhub",
    hostnames: ["grubhub.com"],
    controlAliases: [/grub\s*hub/i],
    captureNetworkJson: true,
  },
  {
    id: "toast",
    label: "Toast",
    provider: "toast",
    hostnames: ["toasttab.com"],
    controlAliases: [/toast(?:tab)?/i],
    captureNetworkJson: true,
  },
  {
    id: "olo",
    label: "Olo",
    provider: "olo",
    hostnames: ["olo.com", "olo.express"],
    controlAliases: [/\bolo\b/i],
    captureNetworkJson: true,
  },
  {
    id: "chownow",
    label: "ChowNow",
    provider: "chownow",
    hostnames: ["chownow.com"],
    controlAliases: [/chow\s*now/i],
    captureNetworkJson: true,
  },
  {
    id: "square",
    label: "Square",
    provider: "square",
    hostnames: ["square.site", "squareup.com"],
    controlAliases: [/\bsquare\b/i],
    captureNetworkJson: true,
  },
  {
    id: "clover",
    label: "Clover",
    provider: "clover",
    hostnames: ["clover.com"],
    controlAliases: [/\bclover\b/i],
    captureNetworkJson: true,
  },
  {
    id: "panda_express",
    label: "Panda Express",
    provider: "restaurant_website",
    hostnames: ["pandaexpress.com"],
    controlAliases: [/panda\s*express/i],
    captureNetworkJson: true,
  },
  {
    id: "habit_burger",
    label: "Habit Burger",
    provider: "restaurant_website",
    hostnames: ["habitburger.com"],
    controlAliases: [/habit\s*burger/i],
    captureNetworkJson: true,
  },
  {
    id: "taco_bell",
    label: "Taco Bell",
    provider: "restaurant_website",
    hostnames: ["tacobell.com"],
    controlAliases: [/taco\s*bell/i],
    captureNetworkJson: true,
  },
  {
    id: "chick_fil_a",
    label: "Chick-fil-A",
    provider: "restaurant_website",
    hostnames: ["chick-fil-a.com"],
    controlAliases: [/chick[ -]?fil[ -]?a/i],
    captureNetworkJson: true,
  },
] as const;

function hostnameMatches(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

export function menuAdapterForUrl(rawUrl: string): MenuProviderAdapter | undefined {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return MENU_PROVIDER_ADAPTERS.find((adapter) =>
      adapter.hostnames.some((suffix) => hostnameMatches(hostname, suffix)),
    );
  } catch {
    return undefined;
  }
}

export function menuAdapterForControlLabel(
  label: string,
): MenuProviderAdapter | undefined {
  const domains = label.match(/(?:[a-z0-9-]+\.)+[a-z]{2,}/gi) ?? [];
  for (const domain of domains) {
    const adapter = menuAdapterForUrl(`https://${domain}`);
    if (adapter) return adapter;
  }
  return MENU_PROVIDER_ADAPTERS.find((adapter) =>
    adapter.controlAliases.some((alias) => alias.test(label)),
  );
}

export function activeProviderAdapterForUrl(
  rawUrl: string,
): MenuProviderAdapter | undefined {
  const adapter = menuAdapterForUrl(rawUrl);
  return adapter && activeProviderAdapterIds.has(adapter.id)
    ? adapter
    : undefined;
}

export function activeProviderAdapterForControlLabel(
  label: string,
): MenuProviderAdapter | undefined {
  const domains = label.match(/(?:[a-z0-9-]+\.)+[a-z]{2,}/gi) ?? [];
  for (const domain of domains) {
    const adapter = activeProviderAdapterForUrl(`https://${domain}`);
    if (adapter) return adapter;
  }
  return MENU_PROVIDER_ADAPTERS.find(
    (adapter) =>
      activeProviderAdapterIds.has(adapter.id) &&
      adapter.controlAliases.some((alias) => alias.test(label)),
  );
}

