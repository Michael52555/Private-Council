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

import {
  evaluateBudgetScore,
  evaluateDistanceScore,
  evaluateRestaurantScore,
  combineScores,
  importanceWeight,
} from "@/lib/scoring";

import { FormEvent, useEffect, useState } from "react";
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
    setIsGeneratingCandidates(true);
    setCandidateGenerationError("");

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
    .sort(
      (a, b) =>
        b.totalScore - a.totalScore,
    );


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
                                Your local agent evaluates each option using your confirmed preferences.
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

                                        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-gray-200">
                                        {candidate.distanceMiles} miles
                                        </span>

                                        <p className="mt-1 text-sm text-gray-400">
                                        ${candidate.estimatedPriceMin}-
                                        ${candidate.estimatedPriceMax} / person
                                      </p>
                                    </div>

                                    <h3 className="mt-5 text-lg font-semibold text-white">
                                        {candidate.name}
                                    </h3>

                                    <p className="mt-1 text-sm text-gray-400">
                                        {candidate.address}
                                    </p>

                                    <div className="mt-5">
                                      <span
                                      className="
                                      inline-flex
                                      rounded-full
                                      bg-purple-500/20
                                      px-3
                                      py-1
                                      text-xs
                                      font-semibold
                                      text-purple-200
                                      "
                                      >
                                          Score {Math.round(totalScore * 100)}%
                                      </span>
                                  </div>

                                  <div className="mt-4 space-y-2">
                                  {
                                  breakdown.map((item)=>(
                                      <div
                                      key={item.category}
                                      className="
                                      flex
                                      justify-between
                                      text-sm
                                      text-gray-300
                                      "
                                      >
                                          <span>
                                              {item.category}
                                          </span>

                                          <span>
                                              {Math.round(item.score * 100)}%
                                          </span>
                                      </div>
                                  ))
                                  }
                                  </div>

                                    <p className="mt-4 text-xs text-gray-500">
                                        Evaluated privately on this device
                                    </p>
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
