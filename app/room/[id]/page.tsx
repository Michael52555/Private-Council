"use client";
import type {
  Importance,
  Visibility,
  PlanningMode,
  PreferenceCategory,
  PreferenceInterpretation,
  Preference,
  RestaurantCandidate,
  CandidatePlan,
  RoomConfig,
  LocalAgentState,
} from "@/lib/planning-types";
import type {
  OrderingDiscoveryDiagnostics,
  OrderingSource,
  MenuItem,
  RestaurantMenuResult,
} from "@/lib/menu/types";
import {
  orderingSourceHostname,
  orderingSourceInventoryLabel,
} from "@/lib/menu/survey";
import {
  hasReliableMealEstimate,
  mealEstimateConfidence,
} from "@/lib/menu/meal-estimate";

import {
  evaluateRestaurantScore,
} from "@/lib/scoring";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

type StructuredPreferenceData = {
  locationText?: string;
  maxDistanceMiles?: number;
  minPriceDollarsPerPerson?: number;
  maxPriceDollarsPerPerson?: number;
};

type DistanceInterpretationApiResult =
  | {
      status: "success";
      summary: string;
      maxMiles: number;
      clarificationQuestion: null;
    }
  | {
      status: "needs_clarification";
      summary: string;
      maxMiles: null;
      clarificationQuestion: string;
    };

type BudgetInterpretationApiResult =
  | {
      status: "success";
      summary: string;
      minPriceDollarsPerPerson: number;
      maxPriceDollarsPerPerson: number;
      clarificationQuestion: null;
    }
  | {
      status: "needs_clarification";
      summary: string;
      maxDollarsPerPerson: null;
      clarificationQuestion: string;
    };

// type PreferenceInterpretation = {
//   status: "success" | "needs_clarification";
//   summary: string;
//   structuredData: StructuredPreferenceData;
//   clarificationQuestion: string | null;
//   source: "mock" | "ai";
//   confirmed: boolean;
// };

// type Preference = {
//   id: string;
//   category: PreferenceCategory;
//   statement: string;
//   importance: Importance;
//   visibility: Visibility;

//   interpretation?: PreferenceInterpretation;
// };

// type LocalAgentState = {
//   version: 1;
//   displayName: string;
//   privateOriginAddress: string;
//   preferences: Preference[];
//   updatedAt: string;
// };

type PreferenceDraft = {
  category: PreferenceCategory;
  statement: string;
  importance: Importance;
  visibility: Visibility;
};

type GenerateCandidatesApiResponse =
  | {
      candidates: RestaurantCandidate[];
    }
  | {
      error: string;
    };

type OrderingDiscoveryApiResponse =
  | {
      sources: OrderingSource[];
      websiteFallbackSources: OrderingSource[];
      warnings: string[];
      diagnostics: OrderingDiscoveryDiagnostics;
    }
  | { error: string };

type CandidateOrderingState = {
  status: "loading" | "success" | "error";
  sources: OrderingSource[];
  websiteFallbackSources: OrderingSource[];
  warnings: string[];
  diagnostics?: OrderingDiscoveryDiagnostics;
  error?: string;
};

type RestaurantMenuApiResponse = RestaurantMenuResult | { error: string };

type CandidateMenuState =
  | { status: "loading" }
  | { status: "success"; result: RestaurantMenuResult }
  | { status: "error"; error: string };

type DistanceEvaluation =
  | {
      status: "acceptable";
      excessMiles: 0;
      privateReason: string;
    }
  | {
      status: "acceptable_with_penalty";
      excessMiles: number;
      privateReason: string;
    }
  | {
      status: "compromise_required";
      excessMiles: number;
      privateReason: string;
    }
  | {
      status: "infeasible";
      excessMiles: number;
      privateReason: string;
    }
  | {
      status: "not_ready";
      privateReason: string;
    };
const categoryLabels: Record<PreferenceCategory, string> = {
  location: "Location",
  distance: "Distance",
  transportation: "Transportation",
  food: "Food & allergies",
  budget: "Budget",
  departure_time: "Departure time",
  return_time: "Return time",
  other: "Something else",
};

function isPreferenceCategory(
  value: unknown,
): value is PreferenceCategory {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(
      categoryLabels,
      value,
    )
  );
}

const importanceLabels: Record<Importance, string> = {
  1: "Almost indifferent",
  2: "Soft preference",
  3: "Open to compromise",
  4: "Strict",
  5: "Non-negotiable",
};

const visibilityLabels: Record<Visibility, string> = {
  private: "Only my agent",
  anonymous: "Anonymous to the group",
  shareable: "May be shared",
};

const emptyDraft: PreferenceDraft = {
  category: "location",
  statement: "",
  importance: 3,
  visibility: "private",
};

// function mockInterpretPreference(
//   preference: Preference,
// ): PreferenceInterpretation {
//   const text = preference.statement.trim();

//   if (
//     preference.category === "location" ||
//     preference.category === "distance"
//   ) {
//     const distanceMatch = text.match(
//       /(\d+(?:\.\d+)?)\s*(?:mile|miles|mi)\b/i,
//     );

//     const maxDistanceMiles = distanceMatch
//       ? Number(distanceMatch[1])
//       : undefined;

//     return {
//       summary:
//         maxDistanceMiles !== undefined
//           ? `Stay within ${maxDistanceMiles} miles of the stated location`
//           : "Use the stated location as a planning reference",
//       structuredData: {
//         locationText: text,
//         maxDistanceMiles,
//       },
//       source: "mock",
//       confirmed: false
//     };
//   }

//   return {
//     summary: text,
//     structuredData: {},
//     source: "mock",
//     confirmed: false
//   };
// }

function PlanningBackground() {
  return (
    <div className="planning-background" aria-hidden="true">
      <div className="aurora aurora-blue" />
      <div className="aurora aurora-purple" />
      <div className="aurora aurora-green" />

      <svg
        className="connection-map"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        >
        {/* Left agents */}
        <path d="M260 190 C420 220 520 270 620 310" />
        <path d="M220 450 C390 450 510 450 620 450" />
        <path d="M260 710 C420 680 520 630 620 590" />

        {/* Right agents */}
        <path d="M1180 190 C1020 220 920 270 820 310" />
        <path d="M1220 450 C1050 450 930 450 820 450" />
        <path d="M1180 710 C1020 680 920 630 820 590" />

        {/* Left agent nodes */}
        <circle
            className="map-agent map-agent-pink"
            cx="260"
            cy="190"
            r="7"
        />
        <circle
            className="map-agent map-agent-blue"
            cx="220"
            cy="450"
            r="7"
        />
        <circle
            className="map-agent map-agent-purple"
            cx="260"
            cy="710"
            r="7"
        />

        {/* Right agent nodes */}
        <circle
            className="map-agent map-agent-green"
            cx="1180"
            cy="190"
            r="7"
        />
        <circle
            className="map-agent map-agent-gold"
            cx="1220"
            cy="450"
            r="7"
        />
        <circle
            className="map-agent map-agent-rose"
            cx="1180"
            cy="710"
            r="7"
        />
    </svg>
    </div>
  );
}

// Retained as an internal diagnostic renderer, but intentionally excluded from the user UI.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function PrimaryMenuPanel({ state }: { state?: CandidateMenuState }) {
  if (!state || state.status === "loading") return null;
  if (state.status === "error") {
    return (
      <details className="mt-3 rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-xs">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-gray-400 [&::-webkit-details-marker]:hidden">
          <span className="font-medium">Menu data unavailable</span>
          <span className="text-[10px] text-gray-500">View reason</span>
        </summary>
        <p className="mt-2 border-t border-white/10 pt-2 leading-5 text-red-200/80">
          {state.error}
        </p>
      </details>
    );
  }

  const pricedItems = state.result.items.filter(
    (item): item is MenuItem & { price: number } =>
      typeof item.price === "number",
  );
  const sampleItemIds = new Set(state.result.priceSummary.sampleItemIds);
  const typicalMealItems = pricedItems.filter((item) => sampleItemIds.has(item.id));
  const effectiveMenuIndex = state.result.menus.findIndex(
    (candidateMenu) => candidateMenu.items.filter(
      (item) => typeof item.price === "number",
    ).length >= 3,
  );
  const menu = effectiveMenuIndex >= 0
    ? state.result.menus[effectiveMenuIndex]
    : state.result.menus.at(-1);
  const menuWarnings = state.result.menus.flatMap((candidateMenu) =>
    candidateMenu.warnings.map((warning) =>
      `${orderingSourceHostname(candidateMenu.source)}: ${warning}`,
    ),
  );
  return (
    <details className="mt-3 rounded-xl border border-emerald-300/15 bg-emerald-500/5 px-3 py-2 text-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="font-semibold text-emerald-200">Menu data</span>
        <span className="text-[10px] text-gray-400">
          {pricedItems.length} priced · View
        </span>
      </summary>

      <div className="mt-2 border-t border-white/10 pt-2">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-emerald-200/80">
            {effectiveMenuIndex > 0 ? "Fallback provider menu" : "Primary provider menu"}
          </span>
          <span className="text-gray-400">{state.result.items.length} items</span>
        </div>
        <p className="mt-2 text-[10px] text-gray-500">
          Extraction: {menu?.extractionMethod ?? "none"} · basis: {state.result.priceSummary.basis.replaceAll("_", " ")}
          {state.result.priceSummary.excludedItemCount > 0
            ? ` · ${state.result.priceSummary.excludedItemCount} non-meal items excluded`
            : ""}
        </p>
        {hasReliableMealEstimate(state.result.priceSummary) && (
          <p className="mt-2 text-emerald-100">
            Typical meal estimate: ${state.result.priceSummary.lowerQuartile?.toFixed(2)}–$
            {state.result.priceSummary.upperQuartile?.toFixed(2)} · median $
            {state.result.priceSummary.median?.toFixed(2)}
          </p>
        )}
        {typicalMealItems.length > 0 && (
          <ul className="mt-3 space-y-1 text-gray-300">
            {typicalMealItems.slice(0, 8).map((item) => (
              <li key={item.id} className="flex justify-between gap-3">
                <span className="truncate">{item.name}</span>
                <span className="shrink-0">${item.price.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        )}
        {menuWarnings.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-white/10 pt-3 text-[10px] leading-4 text-amber-200/80">
            {menuWarnings.map((warning, index) => (
              <li key={`${index}-${warning}`}>• {warning}</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

// Retained as an internal diagnostic renderer, but intentionally excluded from the user UI.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function OrderingSourcesPanel({ state }: { state: CandidateOrderingState }) {
  const primarySource = state.sources[0];
  const technicalDetailCount =
    state.sources.length + state.websiteFallbackSources.length + state.warnings.length;

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-emerald-200">Ordering providers</span>
        <span className="text-gray-400">
          {state.sources.length > 0
            ? `${state.sources.length} provider link${state.sources.length === 1 ? "" : "s"}`
            : "not found"}
        </span>
      </div>

      {primarySource ? (
        <div className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-emerald-300/10 bg-emerald-500/5 p-3 text-xs">
          <div className="min-w-0">
            <p className="truncate font-semibold text-white">
              {orderingSourceInventoryLabel(primarySource)}
            </p>
            <p className="mt-1 truncate text-[10px] text-gray-400">
              {orderingSourceHostname(primarySource)} · {primarySource.fulfillment}
            </p>
          </div>
          <span className="shrink-0 text-[10px] text-emerald-200/70">
            {state.sources.length === 1
              ? "top-listed"
              : `+${state.sources.length - 1} alternative${state.sources.length === 2 ? "" : "s"}`}
          </span>
        </div>
      ) : (
        <p className="mt-2 text-xs leading-5 text-amber-200">
          Google Maps exposed no resolvable provider URL for this listing.
        </p>
      )}

      <details className="mt-3 border-t border-white/10 pt-3 text-[11px] text-gray-500">
        <summary className="cursor-pointer select-none font-medium text-gray-400 marker:text-gray-600">
          Show technical details{technicalDetailCount > 0 ? ` · ${technicalDetailCount}` : ""}
        </summary>

        <div className="mt-3">
          {state.sources.length > 0 && (
            <ul className="space-y-3 text-xs text-gray-300">
              {state.sources.map((source) => (
                <li key={source.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-white">
                      {orderingSourceInventoryLabel(source)}
                    </span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-500">
                      {source.fulfillment}
                    </span>
                  </div>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block break-all text-purple-300 underline decoration-purple-300/30 underline-offset-2"
                  >
                    {orderingSourceHostname(source)} ↗
                  </a>
                  <p className="mt-1 break-all text-[10px] leading-4 text-gray-500">
                    {source.url}
                  </p>
                  <p className="mt-2 text-[10px] text-gray-500">
                    {source.discoveryMethod?.replaceAll("_", " ") ?? "google maps"}
                    {source.evidenceText ? ` · ${source.evidenceText}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {state.websiteFallbackSources.length > 0 && (
            <div className="mt-3 border-t border-white/10 pt-3 text-[11px] text-gray-500">
              <p className="font-semibold text-gray-400">Website fallback — not counted</p>
              {state.websiteFallbackSources.map((source) => (
                <a
                  key={source.id}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block break-all text-gray-500 underline decoration-white/10 underline-offset-2"
                >
                  {orderingSourceHostname(source)} ↗
                </a>
              ))}
            </div>
          )}

          {state.diagnostics && (
            <div className="mt-3 border-t border-white/10 pt-3 text-[10px] leading-4 text-gray-500">
              <p>
                Online ordering control: {state.diagnostics.orderControlFound ? "found" : "not found"}
                {state.diagnostics.orderControlLayout
                  ? ` · ${state.diagnostics.orderControlLayout} layout`
                  : ""}
                {state.diagnostics.orderingSurface
                  ? ` · ${state.diagnostics.orderingSurface.replaceAll("_", " ")}`
                  : ""}
              </p>
              <p>
                Result scope: {state.diagnostics.resultScope}
                {` · ${state.diagnostics.inspectedLinkCount ?? 0} links inspected`}
              </p>
              {state.diagnostics.pageTitle && (
                <p className="mt-1 break-words">Page: {state.diagnostics.pageTitle}</p>
              )}
              <p>Consent handled: {state.diagnostics.consentHandled ? "yes" : "no"}</p>
              {state.diagnostics.visibleControlLabels.length > 0 && (
                <p className="mt-1 break-words">
                  Visible controls: {state.diagnostics.visibleControlLabels.slice(0, 12).join(" · ")}
                </p>
              )}
              {state.diagnostics.unresolvedControlLabels.length > 0 && (
                <p className="mt-1 break-words">
                  Unresolved controls: {state.diagnostics.unresolvedControlLabels.join(", ")}
                </p>
              )}
              {(state.diagnostics.skippedUnsupportedProviders?.length ?? 0) > 0 && (
                <p className="mt-1 break-words">
                  Skipped unsupported providers: {state.diagnostics.skippedUnsupportedProviders?.join(" · ")}
                </p>
              )}
            </div>
          )}

          {state.warnings.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-white/10 pt-3 text-[11px] leading-4 text-amber-200/80">
              {state.warnings.map((warning, warningIndex) => (
                <li key={`${warningIndex}-${warning}`}>• {warning}</li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}

function BudgetEstimatePanel({ candidate }: { candidate: RestaurantCandidate }) {
  const isQueuedForMenu = candidate.menuStatus === "pending";
  const isCheckingMenu = candidate.menuStatus === "loading";
  const minimum = candidate.estimatedPriceMin;
  const maximum = candidate.estimatedPriceMax;
  const hasRange = typeof minimum === "number" && typeof maximum === "number";
  const displaysAsSinglePrice = hasRange && minimum.toFixed(2) === maximum.toFixed(2);
  const sourceLabel = candidate.budgetEstimateSource === "menu"
    ? displaysAsSinglePrice
      ? "Menu-derived typical meal price"
      : "Menu-derived typical meal range"
    : candidate.budgetEstimateSource === "google_price_range"
      ? "Google price range"
      : candidate.budgetEstimateSource === "google_price_level"
        ? "Google price-level estimate"
        : "Budget estimate unavailable";
  const confidenceLabel = candidate.budgetEstimateConfidence === "none"
    ? null
    : `${candidate.budgetEstimateConfidence} confidence`;
  const currencyPrefix = !candidate.budgetEstimateCurrency || candidate.budgetEstimateCurrency === "USD"
    ? "$"
    : `${candidate.budgetEstimateCurrency} `;

  if (isQueuedForMenu || isCheckingMenu) {
    return (
      <div className="mt-4 rounded-xl border border-sky-300/15 bg-sky-500/5 p-3 text-xs" aria-live="polite">
        <div className="flex items-center gap-2 font-semibold text-sky-200">
          <span className="h-2 w-2 animate-pulse rounded-full bg-sky-300" />
          {isQueuedForMenu ? "Queued for price check..." : "Checking menu prices..."}
        </div>
        <p className="mt-2 text-[10px] leading-4 text-gray-500">
          {isQueuedForMenu
            ? "Waiting for a central scraper worker; cached restaurants bypass this queue."
            : "A Google estimate will appear only if reliable menu prices cannot be extracted."}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-sky-300/15 bg-sky-500/5 p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <span className="font-semibold text-sky-200">{sourceLabel}</span>
        {confidenceLabel && (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-sky-200/60">
            {confidenceLabel}
          </span>
        )}
      </div>
      {hasRange ? (
        <p className="mt-2 text-sm font-semibold text-white">
          {displaysAsSinglePrice
            ? `${currencyPrefix}${minimum.toFixed(2)} per person`
            : `${currencyPrefix}${minimum.toFixed(2)}–${currencyPrefix}${maximum.toFixed(2)} per person`}
        </p>
      ) : (
        <p className="mt-2 leading-5 text-amber-200/80">
          No numeric menu or Google price estimate is available, so budget scoring remains pending.
        </p>
      )}
      {candidate.budgetEstimateSource === "google_price_level" && (
        <p className="mt-2 text-[10px] leading-4 text-gray-500">
          Broad heuristic band derived from Google&apos;s price level; exact menu prices can replace it later.
        </p>
      )}
    </div>
  );
}

const ORDERING_DISCOVERY_TIMEOUT_MS = 70_000;
const MENU_EXTRACTION_TIMEOUT_MS = 70_000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The menu check timed out. A cached or Google price estimate will be used when available.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function renderPreferenceDetails(preference: Preference) {

  console.log(
    "RENDER DETAIL",
    preference.id,
    preference.interpretation
  );
  const data = preference.interpretation?.structuredData;

  console.log("STRUCTURED DATA", data);

  switch (preference.category) {
    case "distance":
      if (typeof data?.maxDistanceMiles === "number") {
        return (
          <div className="mt-2">
            <p className="text-lg font-semibold text-gray-900">
              ≤ {data.maxDistanceMiles} miles
            </p>

            <p className="text-sm text-gray-500">
              Maximum distance
            </p>
          </div>
        );
      }

      return null;


    case "budget":
      if (
        typeof data?.minPriceDollarsPerPerson === "number" &&
        typeof data?.maxPriceDollarsPerPerson === "number"
      ) {
        return (
          <div className="mt-2">
            <p className="text-lg font-semibold text-gray-900">
              ${data.minPriceDollarsPerPerson} - $
              {data.maxPriceDollarsPerPerson}
            </p>

            <p className="text-sm text-gray-500">
              Per person
            </p>
          </div>
        );
      }

      return null;


    default:
      return null;
  }
}

export default function RoomPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();

  const roomId = params.id;
  const planName = searchParams.get("name") ?? "Untitled plan";
  const storageKey = `glued:${roomId}:local-agent`;

  const [copied, setCopied] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [preferences, setPreferences] = useState<Preference[]>([]);

  const [candidates, setCandidates] =
  useState<RestaurantCandidate[]>([]);

  const [candidateGenerationError, setCandidateGenerationError] =
  useState("");

  const [, setCandidateOrdering] = useState<
    Record<string, CandidateOrderingState>
  >({});
  const [, setCandidateMenus] = useState<
    Record<string, CandidateMenuState>
  >({});
  const orderingDiscoveryRunRef = useRef(0);

  const [privateOriginAddress, setPrivateOriginAddress] =
  useState("");

  const [isGeneratingCandidates, setIsGeneratingCandidates] =
  useState(false);

  const [draft, setDraft] = useState<PreferenceDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [selectedCategories, setSelectedCategories] =
  useState<PreferenceCategory[]>([]);

  const [interpretingId, setInterpretingId] =
  useState<string | null>(null);

  const [
  isPreferenceComposerOpen,
  setIsPreferenceComposerOpen,
] = useState(false);

  const [interpretErrors, setInterpretErrors] = useState<
    Record<string, string>
    >({});

    const [hasLoaded, setHasLoaded] = useState(false);
    const [saveStatus, setSaveStatus] = useState<
        "loading" | "saved" | "saving"
    >("loading");

  


  const [formError, setFormError] = useState("");

  // Load this participant's private local section.
  useEffect(() => {
    const savedState = window.localStorage.getItem(storageKey);

    if (savedState) {
      try {
        const parsedState = JSON.parse(savedState) as Partial<LocalAgentState>;

        if (
          Array.isArray(
            parsedState.selectedCategories,
          )
        ) {
          setSelectedCategories(
            parsedState.selectedCategories.filter(
              isPreferenceCategory,
            ),
          );
        } else {
          const inferredCategories =
            Array.isArray(parsedState.preferences)
              ? parsedState.preferences
                  .map(
                    (preference) =>
                      preference.category,
                  )
                  .filter(isPreferenceCategory)
              : [];

          if (
            typeof parsedState
              .privateOriginAddress === "string" &&
            parsedState.privateOriginAddress.trim() &&
            !inferredCategories.includes("location")
          ) {
            inferredCategories.unshift("location");
          }

          setSelectedCategories([
            ...new Set(inferredCategories),
          ]);
        }

        if (typeof parsedState.displayName === "string") {
          setDisplayName(parsedState.displayName);
        }

        if (typeof parsedState.privateOriginAddress === "string") {
            setPrivateOriginAddress(
                parsedState.privateOriginAddress,
            );
        }

        if (Array.isArray(parsedState.preferences)) {
          setPreferences(parsedState.preferences);
        }
      } catch (error) {
        console.error("Could not load local agent state:", error);
      }
    }

    setHasLoaded(true);
    setSaveStatus("saved");
  }, [storageKey]);

  // Automatically save changes after a short delay.
  useEffect(() => {
    if (!hasLoaded || selectedCategories.length == 0) {
      return;
    }

    

    setSaveStatus("saving");

    

    const timer = window.setTimeout(() => {
      const localAgentState: LocalAgentState = {
        version: 1,
        displayName,
        preferences,
        selectedCategories,
        privateOriginAddress,
        updatedAt: new Date().toISOString(),
      };

      window.localStorage.setItem(
        storageKey,
        JSON.stringify(localAgentState),
      );

      setSaveStatus("saved");
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [displayName, preferences, hasLoaded, selectedCategories, privateOriginAddress, storageKey]);

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);

      window.setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      alert("Could not copy the link. Please copy it from the address bar.");
    }
  }

  async function handleGenerateCandidates() {
    const enrichmentRun =
      orderingDiscoveryRunRef.current + 1;
    orderingDiscoveryRunRef.current = enrichmentRun;
    setIsGeneratingCandidates(true);
    setCandidateGenerationError("");
    setCandidateMenus({});

    try {
        const response = await fetch(
        "/api/generate-candidates",
        {
            method: "POST",
            headers: {
            "Content-Type": "application/json",
            },
            body: JSON.stringify({
            planName,
            originAddress: privateOriginAddress.trim(),
            }),
        },
    );

        const data =
        (await response.json()) as GenerateCandidatesApiResponse;

        if (!response.ok) {
        const message =
            "error" in data
            ? data.error
            : "Could not generate candidate options.";

        throw new Error(message);
        }

        if (!("candidates" in data)) {
        throw new Error(
            "The coordinator returned an invalid response.",
        );
        }

        setCandidates(data.candidates);
        setCandidateOrdering({});
        void enrichCandidateOrderingSources(
          data.candidates,
          enrichmentRun,
        );
    } catch (error) {
        const message =
        error instanceof Error
            ? error.message
            : "Could not generate candidate options.";

        setCandidateGenerationError(message);
    } finally {
        setIsGeneratingCandidates(false);
    }
}

  async function handleDiscoverOrderingSources(
    candidate: RestaurantCandidate,
    enrichmentRun = orderingDiscoveryRunRef.current,
  ) {
    if (enrichmentRun !== orderingDiscoveryRunRef.current) {
      return;
    }

    setCandidates((current) =>
      current.map((entry) =>
        entry.id === candidate.id
          ? { ...entry, menuStatus: "loading" }
          : entry,
      ),
    );
    setCandidateOrdering((current) => ({
      ...current,
      [candidate.id]: {
        status: "loading",
        sources: [],
        websiteFallbackSources: [],
        warnings: [],
      },
    }));

    try {
      const discoveryResponse = await fetchWithTimeout(
        "/api/restaurants/ordering-sources",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            placeId: candidate.id,
            websiteUri: candidate.websiteUri,
            googleMapsUri: candidate.googleMapsUri,
          }),
        },
        ORDERING_DISCOVERY_TIMEOUT_MS,
      );
      const discovery =
        (await discoveryResponse.json()) as OrderingDiscoveryApiResponse;
      if (!discoveryResponse.ok || "error" in discovery) {
        throw new Error(
          "error" in discovery
            ? discovery.error
            : "Could not discover ordering sources.",
        );
      }
      if (enrichmentRun !== orderingDiscoveryRunRef.current) {
        return;
      }

      setCandidateOrdering((current) => ({
        ...current,
        [candidate.id]: {
          status: "success",
          sources: discovery.sources,
          websiteFallbackSources: discovery.websiteFallbackSources,
          warnings: discovery.warnings,
          diagnostics: discovery.diagnostics,
        },
      }));

      setCandidates((current) =>
        current.map((entry) =>
          entry.id === candidate.id
            ? {
                ...entry,
                menuStatus: discovery.sources.length > 0
                  ? "loading"
                  : "unavailable",
                menuItemCount: 0,
                orderingSources: discovery.sources,
              }
            : entry,
        ),
      );

      if (discovery.sources.length > 0) {
        await handleExtractPrimaryMenu(
          { ...candidate, orderingSources: discovery.sources },
          discovery.sources,
          enrichmentRun,
        );
      }
    } catch (error) {
      if (enrichmentRun !== orderingDiscoveryRunRef.current) {
        return;
      }

      setCandidateOrdering((current) => ({
        ...current,
        [candidate.id]: {
          status: "error",
          sources: [],
          websiteFallbackSources: [],
          warnings: [],
          error: error instanceof Error ? error.message : "Could not load this menu.",
        },
      }));
      setCandidates((current) =>
        current.map((entry) =>
          entry.id === candidate.id
            ? {
                ...entry,
                menuStatus: "unavailable",
              }
            : entry,
        ),
      );
    }
  }

  async function enrichCandidateOrderingSources(
    restaurantCandidates: RestaurantCandidate[],
    enrichmentRun: number,
  ) {
    let nextCandidateIndex = 0;

    async function worker() {
      while (
        enrichmentRun === orderingDiscoveryRunRef.current
      ) {
        const candidate =
          restaurantCandidates[nextCandidateIndex];
        nextCandidateIndex += 1;

        if (!candidate) {
          return;
        }

        if (
          candidate.menuStatus === "loaded"
        ) {
          continue;
        }

        await handleDiscoverOrderingSources(
          candidate,
          enrichmentRun,
        );
      }
    }

    await Promise.all([worker(), worker(), worker()]);
  }

  async function handleExtractPrimaryMenu(
    candidate: RestaurantCandidate,
    sources = candidate.orderingSources,
    enrichmentRun?: number,
  ) {
    if (
      typeof enrichmentRun === "number" &&
      enrichmentRun !== orderingDiscoveryRunRef.current
    ) {
      return;
    }
    const primarySource = sources[0];
    if (!primarySource) return;

    setCandidates((current) =>
      current.map((entry) =>
        entry.id === candidate.id
          ? { ...entry, menuStatus: "loading" }
          : entry,
      ),
    );

    setCandidateMenus((current) => ({
      ...current,
      [candidate.id]: { status: "loading" },
    }));

    try {
      const response = await fetchWithTimeout(
        "/api/restaurants/menu",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            placeId: candidate.id,
            restaurantName: candidate.name,
            restaurantAddress: candidate.address,
            sources: sources.slice(0, 3),
          }),
        },
        MENU_EXTRACTION_TIMEOUT_MS,
      );
      const data = (await response.json()) as RestaurantMenuApiResponse;
      if (!response.ok || "error" in data) {
        throw new Error(
          "error" in data ? data.error : "Could not extract the primary menu.",
        );
      }
      if (
        typeof enrichmentRun === "number" &&
        enrichmentRun !== orderingDiscoveryRunRef.current
      ) {
        return;
      }

      setCandidateMenus((current) => ({
        ...current,
        [candidate.id]: { status: "success", result: data },
      }));

      const hasReliablePriceSample = hasReliableMealEstimate(data.priceSummary);
      setCandidates((current) =>
        current.map((entry) =>
          entry.id === candidate.id
            ? {
                ...entry,
                estimatedPriceMin: hasReliablePriceSample
                  ? data.priceSummary.lowerQuartile ?? data.priceSummary.minimum
                  : entry.googleEstimatedPriceMin,
                estimatedPriceMax: hasReliablePriceSample
                  ? data.priceSummary.upperQuartile ?? data.priceSummary.maximum
                  : entry.googleEstimatedPriceMax,
                pricePerPerson: hasReliablePriceSample
                  ? data.priceSummary.median
                  : entry.googleEstimatedPriceMidpoint,
                budgetEstimateSource: hasReliablePriceSample
                  ? "menu"
                  : entry.googleBudgetEstimateSource,
                budgetEstimateConfidence: hasReliablePriceSample
                  ? mealEstimateConfidence(data.priceSummary)
                  : entry.googleBudgetEstimateConfidence,
                budgetEstimateCurrency: hasReliablePriceSample
                  ? data.priceSummary.currency ?? "USD"
                  : entry.googleBudgetEstimateCurrency,
                menuStatus: "loaded",
                menuItemCount: data.items.length,
              }
            : entry,
        ),
      );
    } catch (error) {
      setCandidates((current) =>
        current.map((entry) =>
          entry.id === candidate.id
            ? { ...entry, menuStatus: "loaded" }
            : entry,
        ),
      );
      setCandidateMenus((current) => ({
        ...current,
        [candidate.id]: {
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "Could not extract the primary menu.",
        },
      }));
    }
  }

  function updateDraft<K extends keyof PreferenceDraft>(
    field: K,
    value: PreferenceDraft[K],
  ) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }));
  }

  function resetDraft() {
    setDraft(emptyDraft);
    setEditingId(null);
    setFormError("");
  }

  function handlePreferenceSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const trimmedStatement = draft.statement.trim();

    if (!trimmedStatement) {
      setFormError("Please describe what matters to you.");
      return;
    }

    setFormError("");

    if (editingId) {
    setPreferences((currentPreferences)=>
      currentPreferences.map((preference)=>{

        if(preference.id !== editingId){
          return preference;
        }

        const hasChanged =
          preference.statement !== trimmedStatement ||
          preference.category !== draft.category ||
          preference.importance !== draft.importance ||
          preference.visibility !== draft.visibility;

        return {
          ...preference,
          category:draft.category,
          statement:trimmedStatement,
          importance:draft.importance,
          visibility:draft.visibility,
          interpretation: 
            preference.interpretation,
        };
      })
    );
  } else {
      const newPreference: Preference = {
        id: crypto.randomUUID(),
        category: draft.category,
        statement: trimmedStatement,
        importance: draft.importance,
        visibility: draft.visibility,
      };

      setPreferences((currentPreferences) => [
        ...currentPreferences,
        newPreference,
      ]);
    }

    resetDraft();
    setIsPreferenceComposerOpen(false);
  }

  async function handleDistanceInterpret(preference: Preference) {



        console.log("distance start");
        const statement = preference.statement.trim();

        if (!statement) {
            return;
        }

        

        try {
            console.log("before fetch");
            const response = await fetch(
            "/api/interpret-distance",
            {
                method: "POST",
                headers: {
                "Content-Type": "application/json",
                },
                body: JSON.stringify({
                statement,
                }),
            },
            );

            console.log("response status", response.status);

            const data = (await response.json()) as
            | DistanceInterpretationApiResult
            | { error?: string };

            console.log("API DATA", data);

            if (!response.ok) {
            const message =
                "error" in data &&
                typeof data.error === "string"
                ? data.error
                : "Could not interpret this preference.";

            throw new Error(message);
            }

            if (!("status" in data)) {
            throw new Error(
                "The interpretation endpoint returned an invalid response.",
            );
            }

            if (data.status === "success") {

              const interpretation: PreferenceInterpretation = {
                status: "success",
                summary: data.summary,
                structuredData: {
                  maxDistanceMiles: data.maxMiles,
                },
                clarificationQuestion: null,
                source: "ai",
                confirmed: false,
              };
              console.log("NEW INTERPRETATION", interpretation);
              console.log("TARGET ID", preference.id);


              setPreferences((currentPreferences) => {
              const next = currentPreferences.map((currentPreference) =>
                currentPreference.id === preference.id
                  ? {
                      ...currentPreference,
                      interpretation,
                    }
                  : currentPreference,
              );

              console.log("UPDATED PREFS", next);

              return next;
            });
            } else {
            const interpretation: PreferenceInterpretation = {
              status: "needs_clarification",
              summary: data.summary,
              structuredData: {},
              clarificationQuestion: data.clarificationQuestion,
              source: "ai",
              confirmed: false,
            };

            setPreferences((currentPreferences) =>
              currentPreferences.map((currentPreference) =>
                currentPreference.id === preference.id
                  ? {
                      ...currentPreference,
                      interpretation,
                    }
                  : currentPreference,
              ),
            );
            }
        } catch (error) {
            console.error(error);
        } 
    }

  async function handleBudgetInterpret(preference: Preference) {
        const statement =
        preference.statement.trim();

        if (!statement) {
            return;
        }

       


        try {
        const response = await fetch(
            "/api/interpret-budget",
            {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                statement,
            }),
            },
        );

        

        const data = (await response.json()) as
            | BudgetInterpretationApiResult
            | {
                error?: string;
            };

        console.log("BUDGET RAW DATA", data);

        if (!response.ok) {
            const message =
            "error" in data &&
            typeof data.error === "string"
                ? data.error
                : "Could not interpret this budget preference.";

            throw new Error(message);
        }

        if (!("status" in data)) {
            throw new Error(
            "The budget endpoint returned an invalid response.",
            );
        }

        if (data.status === "success") {
            const interpretation: PreferenceInterpretation = {
              status: "success",
              summary: data.summary,

              structuredData: {
                minPriceDollarsPerPerson:
                  data.minPriceDollarsPerPerson,

                maxPriceDollarsPerPerson:
                  data.maxPriceDollarsPerPerson,
              },

              clarificationQuestion: null,
              source: "ai",
              confirmed: false,
            };


            setPreferences((currentPreferences) =>
              currentPreferences.map((currentPreference) =>
                currentPreference.id === preference.id
                  ? {
                      ...currentPreference,
                      interpretation,
                    }
                  : currentPreference
              )
            );

        } else {
            const interpretation: PreferenceInterpretation = {
              status:"needs_clarification",
              summary:data.summary,
              structuredData:{},
              clarificationQuestion:data.clarificationQuestion,
              source:"ai",
              confirmed:false,
            };


            setPreferences((currentPreferences)=>
              currentPreferences.map((currentPreference)=>
                currentPreference.id === preference.id
                ? {
                    ...currentPreference,
                    interpretation,
                  }
                : currentPreference
              )
            );
          }
        } catch (error) {
        console.error(error);
        } 
    }

    async function handleInterpret(preference: Preference) {

        console.log("clicked", preference);
        if (preference.category === "distance") {
          return handleDistanceInterpret(preference);
        }

        if (preference.category === "budget") {
            return handleBudgetInterpret(preference);
        }

        setInterpretingId(preference.id);

        setInterpretErrors((currentErrors) => {
            const nextErrors = { ...currentErrors };
            delete nextErrors[preference.id];
            return nextErrors;
        });

        try {
            const response = await fetch("/api/interpret-distance", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                statement: preference.statement,
            }),
            });

            const data = (await response.json()) as
            | DistanceInterpretationApiResult
            | { error?: string };

            if (!response.ok) {
            const message =
                "error" in data && typeof data.error === "string"
                ? data.error
                : "Could not interpret this preference.";

            throw new Error(message);
            }

            if (!("status" in data)) {
            throw new Error(
                "The interpretation endpoint returned an invalid response.",
            );
            }

            const interpretation: PreferenceInterpretation =
            data.status === "success"
                ? {
                    status: "success",
                    summary: data.summary,
                    structuredData: {
                    maxDistanceMiles: data.maxMiles,
                    },
                    clarificationQuestion: null,
                    source: "ai",
                    confirmed: false,
                }
                : {
                    status: "needs_clarification",
                    summary: data.summary,
                    structuredData: {},
                    clarificationQuestion: data.clarificationQuestion,
                    source: "ai",
                    confirmed: false,
                };

            setPreferences((currentPreferences) =>
            currentPreferences.map((currentPreference) =>
                currentPreference.id === preference.id
                ? {
                    ...currentPreference,
                    interpretation,
                    }
                : currentPreference,
            ),
            );
        } catch (error) {
            const message =
            error instanceof Error
                ? error.message
                : "Could not interpret this preference.";

            setInterpretErrors((currentErrors) => ({
            ...currentErrors,
            [preference.id]: message,
            }));
        } finally {
            setInterpretingId((currentId) =>
            currentId === preference.id ? null : currentId,
            );
        }
    }

    function handleConfirmInterpretation( preferenceId: string,) {
        setPreferences((currentPreferences) =>
            currentPreferences.map((preference) => {
            if (
                preference.id !== preferenceId ||
                !preference.interpretation ||
                preference.interpretation.status !== "success"
            ) {
                return preference;
            }

            return {
                ...preference,
                interpretation: {
                ...preference.interpretation,
                confirmed: true,
                },
            };
            }),
        );
    }


  function handleEditPreference(preference: Preference) {
    setEditingId(preference.id);

    setDraft({
      category: preference.category,
      statement: preference.statement,
      importance: preference.importance,
      visibility: preference.visibility,
    });

    setFormError("");
    setIsPreferenceComposerOpen(true)

    window.scrollTo({
    top: 0,
    behavior: "smooth",
    });
}   


  function handleDeletePreference(preferenceId: string) {
    setPreferences((currentPreferences) =>
      currentPreferences.filter(
        (preference) => preference.id !== preferenceId,
      ),
    );

    if (editingId === preferenceId) {
      resetDraft();
    }
  }

    const confirmedDistancePreference = preferences.find(
        (preference) =>
        preference.category === "distance" &&
        preference.interpretation?.status === "success" &&
        preference.interpretation.confirmed === true &&
        typeof preference.interpretation.structuredData
            .maxDistanceMiles === "number",
    );


  const rankedCandidates =
  candidates
    .map((candidate) => {
      const score =
      evaluateRestaurantScore(
        candidate,
        preferences,
      );

      return {
        candidate,
        ...score,
      };
    })
    .sort((a, b) => {
      if (
        a.totalScore === null &&
        b.totalScore === null
      ) {
        return a.candidate.distanceMiles -
          b.candidate.distanceMiles;
      }
      if (a.totalScore === null) return 1;
      if (b.totalScore === null) return -1;
      return b.totalScore - a.totalScore;
    });

  if (!hasLoaded) {
    return (
      <main className="room-page">
        <PlanningBackground />

        <section className="room-card">
          <p className="text-gray-500">
            Loading your local agent...
          </p>
        </section>
      </main>
    );
  }

   
  

    return (
        <main className="room-page">
            <PlanningBackground />


            <section className="room-shell">

                <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
                    <span className="rounded-full border border-purple-100 bg-white/80 px-4 py-2 text-gray-700">
                        Starting point: {privateOriginAddress}
                    </span>

                    <span className="rounded-full border border-purple-100 bg-white/80 px-4 py-2 text-gray-700">
                        {preferences.length} preferences
                    </span>
                </div>

                <header className="workspace-header flex items-start justify-between gap-6">
                    <div>
                        <p className="text-sm font-semibold uppercase tracking-widest text-purple-600">
                        Local Agent
                        </p>

                        <h1 className="mt-2 text-4xl font-bold tracking-tight text-gray-900">
                        What matters to you?
                        </h1>

                        <p className="mt-2 text-gray-600">
                        Review your constraints and explore recommendations.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={() =>
                        setIsPreferenceComposerOpen((current) => !current)
                        }
                        className="shrink-0 rounded-2xl bg-purple-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-purple-700"
                    >
                        {isPreferenceComposerOpen
                        ? "Close"
                        : "+ Add preference"}
                    </button>
                </header>

                {isPreferenceComposerOpen && (
                    <form
                        onSubmit={handlePreferenceSubmit}
                        className="mb-6 rounded-3xl border border-white/80 bg-white/90 p-6 shadow-xl shadow-purple-100/50 backdrop-blur-xl"
                    >
                                            {/* Category and visibility */}
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                        <label
                            htmlFor="preference-category"
                            className="mb-2 block text-sm font-semibold text-gray-800"
                        >
                            Category
                        </label>

                        <select
                            id="preference-category"
                            value={draft.category}
                            onChange={(event) =>
                            updateDraft(
                                "category",
                                event.target.value as PreferenceCategory,
                            )
                            }
                            className="w-full rounded-2xl border border-gray-300 bg-gray-50 px-4 py-3 text-gray-900 outline-none transition focus:border-purple-500 focus:bg-white focus:ring-4 focus:ring-purple-100"
                        >
                            {selectedCategories.map((category) => (
                              <option
                                key={category}
                                value={category}
                              >
                                {categoryLabels[category]}
                              </option>
                            ))}
                        </select>
                        </div>

                        <div>
                        <label
                            htmlFor="preference-visibility"
                            className="mb-2 block text-sm font-semibold text-gray-800"
                        >
                            Visibility
                        </label>

                        <select
                            id="preference-visibility"
                            value={draft.visibility}
                            onChange={(event) =>
                            updateDraft(
                                "visibility",
                                event.target.value as Visibility,
                            )
                            }
                            className="w-full rounded-2xl border border-gray-300 bg-gray-50 px-4 py-3 text-gray-900 outline-none transition focus:border-purple-500 focus:bg-white focus:ring-4 focus:ring-purple-100"
                        >
                            {Object.entries(visibilityLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                            ))}
                        </select>
                        </div>

                        
                    </div>

                
                    {/* Preference statement */}
                    <div className="mt-5">
                        <label
                        htmlFor="preference"
                        className="mb-2 block text-sm font-semibold text-gray-800"
                        >
                        Describe your preference
                        </label>

                        <input
                        id="preference"
                        value={draft.statement}
                        onChange={(event) =>
                            updateDraft("statement", event.target.value)
                        }
                        placeholder="For example: I would prefer Japanese food"
                        className="w-full rounded-2xl border border-gray-300 bg-gray-50 px-4 py-3 text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-purple-500 focus:bg-white focus:ring-4 focus:ring-purple-100"
                        />

                        {formError && (
                        <p className="mt-2 text-sm text-red-600">
                            {formError}
                        </p>
                        )}
                    </div>

                        

                    {/* Importance selection */}
                    <fieldset className="mt-5">
                        <legend className="text-sm font-semibold text-gray-800">
                        How important is this?
                        </legend>

                        <div className="mt-3 grid grid-cols-5 gap-2">
                        {([1, 2, 3, 4, 5] as Importance[]).map((importance) => {
                            const selected = draft.importance === importance;

                            return (
                            <button
                                key={importance}
                                type="button"
                                onClick={() =>
                                updateDraft("importance", importance)
                                }
                                className={`rounded-2xl border py-3 font-semibold transition ${
                                selected
                                    ? "border-purple-600 bg-purple-600 text-white"
                                    : "border-gray-200 bg-gray-50 text-gray-700 hover:border-purple-300 hover:bg-purple-50"
                                }`}
                            >
                                {importance}
                            </button>
                            );
                        })}
                        </div>

                        <p className="mt-3 text-sm font-medium text-purple-700">
                        {importanceLabels[draft.importance]}
                        </p>
                    </fieldset>

                        <div className="mt-6 flex gap-3">
                        <button
                            type="submit"
                            className="flex-1 rounded-2xl bg-purple-600 px-6 py-3 font-semibold text-white transition hover:bg-purple-700"
                        >
                            {editingId
                            ? "Update preference"
                            : "Add preference"}
                        </button>

                        <button
                            type="button"
                            onClick={() => {
                            resetDraft();
                            setIsPreferenceComposerOpen(false);
                            }}
                            className="rounded-2xl border border-gray-200 bg-white px-5 py-3 font-semibold text-gray-600 transition hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                        </div>
                    </form>
                    )}
                


                <div className = "room-workspace">
                    <aside
                    className="
                    room-sidebar
                    sticky
                    top-6
                    h-fit
                    "
                    >
                    <section className="mt-8">
                        <div className="mb-4 flex items-center justify-between">
                        <h2 className="text-xl font-semibold text-gray-900">
                            Your preferences
                        </h2>

                        <span className="rounded-full bg-purple-100 px-3 py-1 text-sm font-medium text-purple-700">
                            {preferences.length}
                        </span>
                        </div>

                        {preferences.length === 0 ? (
                        <div className="rounded-3xl border border-dashed border-purple-300 bg-white/70 px-6 py-12 text-center">
                            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-purple-100 text-xl">
                            ✦
                            </div>

                            <p className="mt-4 font-medium text-gray-700">
                            Your local section is empty.
                            </p>

                            <p className="mt-1 text-sm text-gray-500">
                            Add your first preference above.
                            </p>
                        </div>
                        ) : (
                        <div className="space-y-3">
                            {preferences.map((preference, index) => {


                                return (

                                <article
                                key={preference.id}

                                // onClick={() =>
                                //   handleEditPreference(preference)
                                // }

                                // className="
                                // cursor-pointer
                                // rounded-2xl
                                // border
                                // border-gray-200
                                // bg-white
                                // p-6
                                // shadow-sm
                                // transition
                                // hover:border-purple-300
                                // hover:shadow-md
                                // "
                                // >

                              
                                className="
                                rounded-2xl
                                border
                                border-gray-200
                                bg-white
                                p-5
                                shadow-sm
                                "
                                >


                                <div className="flex items-start justify-between">



                                  <div className="flex items-start gap-3">

                                  <span>
                                    {index+1}
                                  </span>

                                  <div>

                                  <h3 className="
                                  font-semibold
                                  text-gray-900
                                  ">
                                  {categoryLabels[preference.category]}
                                  </h3>

                                {renderPreferenceDetails(preference)}

                                </div>


                                </div>
                                <div className="flex items-center gap-4">

                                {(preference.category === "distance" || preference.category === "budget") && (
                                  <button
                                    type="button"
                                    onClick={() => handleInterpret(preference)}
                                    className="
                                      text-sm
                                      font-semibold
                                      text-purple-600
                                    "
                                  >
                                    ✦ Reinterpret
                                  </button>
                                )}


                                <button
                                  type="button"
                                  onClick={() => handleEditPreference(preference)}
                                  className="
                                    text-sm
                                    font-semibold
                                    text-gray-500
                                  "
                                >
                                  ✎ Edit
                                </button>

                              </div>

                                

                                

                              </div>
                            </article>
                            );

                                 

                                

                                
                                
                           })}
                        
                    
                    </div>
                  )};
                
                </section>
                          
                </aside>
                
                
                <section className="room-results">
                   <section className="candidate-lab relative overflow-hidden rounded-3xl bg-gray-950 p-6 text-white shadow-2xl shadow-purple-950/20">
                        {/* Decorative glows */}
                        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-purple-600/25 blur-3xl" />
                        <div className="pointer-events-none absolute -bottom-28 -left-20 h-72 w-72 rounded-full bg-blue-500/15 blur-3xl" />

                        <div className="relative">
                            <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-purple-300">
                                Candidate lab
                                </p>

                                <h2 className="mt-2 text-2xl font-semibold">
                                Restaurant options
                                </h2>

                                <p className="mt-2 max-w-xl text-sm leading-6 text-gray-400">
                                Ranked using your confirmed preferences.
                                </p>
                            </div>

                            <div className="flex items-center gap-3">
                                <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-sm font-semibold text-gray-200">
                                    {candidates.length} options
                                </span>

                                <button
                                    type="button"
                                    onClick={handleGenerateCandidates}
                                    disabled={isGeneratingCandidates || preferences.length===0}
                                    className="rounded-xl bg-purple-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-400 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isGeneratingCandidates
                                    ? "Generating..."
                                    : candidates.length > 0
                                        ? "Regenerate options"
                                        : "Generate options"}
                                </button>
                            </div>

                            {candidateGenerationError && (
                            <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3">
                                <p className="text-sm font-medium text-red-200">
                                {candidateGenerationError}
                                </p>
                            </div>
                            )}

                            
                            </div>

                            {!confirmedDistancePreference ? (
                            <div className="mt-6 rounded-2xl border border-dashed border-white/15 bg-white/5 px-6 py-10 text-center">
                                <p className="font-medium text-white">
                                Your local agent is not ready
                                </p>

                                <p className="mt-2 text-sm text-gray-400">
                                Interpret and confirm a distance preference first.
                                </p>
                            </div>
                            ) : candidates.length === 0 ? (
                            <div className="mt-6 rounded-2xl border border-dashed border-white/15 bg-white/5 px-6 py-10 text-center">
                                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-purple-500/15 text-purple-300">
                                ✦
                                </div>

                                <p className="mt-4 font-medium text-white">
                                No candidate options yet
                                </p>

                                <p className="mt-2 text-sm text-gray-400">
                                Ask the coordinator to generate options for this plan.
                                </p>
                            </div>
                            ) : (
                            <div className="mt-6 grid gap-4 lg:grid-cols-3">
                                {rankedCandidates.map(
                                ({ candidate, totalScore, breakdown}, index) => (
                                    <article
                                    key={candidate.id}
                                    className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.07] p-5 backdrop-blur-sm transition hover:-translate-y-1 hover:border-purple-400/40 hover:bg-white/[0.1]"
                                    >
                                    <div className="flex items-start justify-between gap-3">
                                        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 text-xs font-bold text-gray-300">
                                        {index + 1}
                                        </span>

                                        <div className="flex flex-wrap justify-end gap-2">
                                          <span className="rounded-full bg-purple-500/20 px-3 py-1 text-xs font-semibold text-purple-200">
                                            {totalScore === null
                                              ? `Score pending · ${breakdown.filter((item) => item.status !== "pending").length}/${breakdown.length} checked`
                                              : breakdown.some((item) => item.status === "uncertain")
                                                ? `Estimated score ${Math.round(totalScore * 100)}%`
                                                : `Score ${Math.round(totalScore * 100)}%`}
                                          </span>
                                          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-gray-200">
                                            {candidate.distanceMiles} miles
                                          </span>
                                        </div>
                                    </div>

                                    <h3 className="mt-5 text-lg font-semibold text-white">
                                        {candidate.name}
                                    </h3>

                                    <p className="mt-1 text-sm text-gray-400">
                                        {candidate.address}
                                    </p>

                                    <BudgetEstimatePanel candidate={candidate} />
                                    </article>
                                ),
                                )}
                            </div>
                            )}
                        </div>
                        </section>
                </section>

                </div>

                    
                </section>
            </main>
        );
    }
