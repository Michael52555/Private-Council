"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

type Importance = 1 | 2 | 3 | 4 | 5;

type Visibility = "private" | "anonymous" | "shareable";

type PreferenceCategory =
  | "location"
  | "distance"
  | "transportation"
  | "food"
  | "departure_time"
  | "return_time"
  | "other";

type StructuredPreferenceData = {
  locationText?: string;
  maxDistanceMiles?: number;
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

type PreferenceInterpretation = {
  status: "success" | "needs_clarification";
  summary: string;
  structuredData: StructuredPreferenceData;
  clarificationQuestion: string | null;
  source: "mock" | "ai";
  confirmed: boolean;
};

type Preference = {
  id: string;
  category: PreferenceCategory;
  statement: string;
  importance: Importance;
  visibility: Visibility;

  interpretation?: PreferenceInterpretation;
};

type LocalAgentState = {
  version: 1;
  displayName: string;
  preferences: Preference[];
  updatedAt: string;
};

type PreferenceDraft = {
  category: PreferenceCategory;
  statement: string;
  importance: Importance;
  visibility: Visibility;
};

type CandidatePlan = {
  id: string;
  name: string;
  distanceMiles: number;
};

type RestaurantCandidate = CandidatePlan & {
  address: string;
};

const demoCandidates: RestaurantCandidate[] = [
  {
    id: "restaurant-1",
    name: "Sakura Table",
    address: "123 Demo Street",
    distanceMiles: 3.4,
  },
  {
    id: "restaurant-2",
    name: "Nori House",
    address: "456 Demo Avenue",
    distanceMiles: 5.8,
  },
  {
    id: "restaurant-3",
    name: "Tokyo Garden",
    address: "789 Demo Boulevard",
    distanceMiles: 8.1,
  },
];

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
  departure_time: "Departure time",
  return_time: "Return time",
  other: "Something else",
};

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

function evaluateDistancePreference(
  candidate: CandidatePlan,
  preference: Preference,
): DistanceEvaluation {
  const interpretation = preference.interpretation;

  if (
    preference.category !== "distance" ||
    !interpretation ||
    interpretation.status !== "success" ||
    !interpretation.confirmed ||
    typeof interpretation.structuredData.maxDistanceMiles !== "number"
  ) {
    return {
      status: "not_ready",
      privateReason:
        "This distance preference has not been successfully interpreted and confirmed.",
    };
  }

  const maxDistanceMiles =
    interpretation.structuredData.maxDistanceMiles;

  const excessMiles =
    candidate.distanceMiles - maxDistanceMiles;

  if (excessMiles <= 0) {
    return {
      status: "acceptable",
      excessMiles: 0,
      privateReason: `${candidate.name} is within your ${maxDistanceMiles}-mile limit.`,
    };
  }

  const roundedExcessMiles =
    Math.round(excessMiles * 10) / 10;

  if (preference.importance === 5) {
    return {
      status: "infeasible",
      excessMiles: roundedExcessMiles,
      privateReason: `${candidate.name} exceeds your non-negotiable distance limit by ${roundedExcessMiles} miles.`,
    };
  }

  if (preference.importance === 4) {
    return {
      status: "compromise_required",
      excessMiles: roundedExcessMiles,
      privateReason: `${candidate.name} exceeds your strict distance limit by ${roundedExcessMiles} miles.`,
    };
  }

  return {
    status: "acceptable_with_penalty",
    excessMiles: roundedExcessMiles,
    privateReason: `${candidate.name} is ${roundedExcessMiles} miles beyond your preferred distance.`,
  };
}

const evaluationLabels: Record<
  DistanceEvaluation["status"],
  string
> = {
  acceptable: "Acceptable",
  acceptable_with_penalty: "Acceptable with penalty",
  compromise_required: "Compromise required",
  infeasible: "Infeasible",
  not_ready: "Not ready",
};

const evaluationPriority: Record<
  DistanceEvaluation["status"],
  number
> = {
  acceptable: 0,
  acceptable_with_penalty: 1,
  compromise_required: 2,
  infeasible: 3,
  not_ready: 4,
};

const evaluationStyles: Record<
  DistanceEvaluation["status"],
  string
> = {
  acceptable:
    "border-green-200 bg-green-50 text-green-900",
  acceptable_with_penalty:
    "border-amber-200 bg-amber-50 text-amber-900",
  compromise_required:
    "border-orange-200 bg-orange-50 text-orange-900",
  infeasible:
    "border-red-200 bg-red-50 text-red-900",
  not_ready:
    "border-gray-200 bg-gray-50 text-gray-800",
};

export default function RoomPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();

  const roomId = params.id;
  const planName = searchParams.get("name") ?? "Untitled plan";
  const storageKey = `glued:${roomId}:local-agent`;

  const [copied, setCopied] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [preferences, setPreferences] = useState<Preference[]>([]);

  const [draft, setDraft] = useState<PreferenceDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [interpretingId, setInterpretingId] =
  useState<string | null>(null);

  const [interpretErrors, setInterpretErrors] = useState<
    Record<string, string>
    >({});

    const [candidateName, setCandidateName] =
    useState("Test Restaurant");

    const [candidateDistance, setCandidateDistance] =
        useState("7.2");

    const [distanceEvaluation, setDistanceEvaluation] =
        useState<DistanceEvaluation | null>(null);

    const [candidateError, setCandidateError] = useState("");

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

        if (typeof parsedState.displayName === "string") {
          setDisplayName(parsedState.displayName);
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
    if (!hasLoaded) {
      return;
    }

    setSaveStatus("saving");

    const timer = window.setTimeout(() => {
      const localAgentState: LocalAgentState = {
        version: 1,
        displayName,
        preferences,
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
  }, [displayName, preferences, hasLoaded, storageKey]);

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
      setPreferences((currentPreferences) =>
        currentPreferences.map((preference) =>
          preference.id === editingId
            ? {
                ...preference,
                category: draft.category,
                statement: trimmedStatement,
                importance: draft.importance,
                visibility: draft.visibility,
                interpretation: undefined,
                }
            : preference
        ),
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
  }

  

    async function handleInterpret(preference: Preference) {
        if (preference.category !== "distance") {
            setInterpretErrors((currentErrors) => ({
            ...currentErrors,
            [preference.id]:
                "Real interpretation currently supports Distance only.",
            }));

            return;
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

  function handleEvaluateCandidate(
    event: FormEvent<HTMLFormElement>,
    ) {
    event.preventDefault();

    const trimmedCandidateName = candidateName.trim();
    const parsedDistance = Number(candidateDistance);

    if (!trimmedCandidateName) {
        setCandidateError("Please enter a candidate name.");
        setDistanceEvaluation(null);
        return;
    }

    const candidate: CandidatePlan = {
        id: "manual-distance-test",
        name: trimmedCandidateName,
        distanceMiles: parsedDistance,
    };

    if (!confirmedDistancePreference) {
        setCandidateError(
        "Interpret and confirm a distance preference first.",
        );
        setDistanceEvaluation(null);
        return;
    }

    if (
        !Number.isFinite(parsedDistance) ||
        parsedDistance < 0
    ) {
        setCandidateError(
        "Please enter a valid non-negative distance.",
        );
        setDistanceEvaluation(null);
        return;
    }
    

    const evaluation = evaluateDistancePreference(
        candidate,
        confirmedDistancePreference,
    );

    setCandidateError("");
    setDistanceEvaluation(evaluation);
}

    const confirmedDistancePreference = preferences.find(
        (preference) =>
        preference.category === "distance" &&
        preference.interpretation?.status === "success" &&
        preference.interpretation.confirmed === true &&
        typeof preference.interpretation.structuredData
            .maxDistanceMiles === "number",
    );

    const evaluatedDemoCandidates = confirmedDistancePreference
    ? demoCandidates.map((candidate) => ({
        candidate,
        evaluation: evaluateDistancePreference(
            candidate,
            confirmedDistancePreference,
        ),
        }))
    : [];

    const sortedDemoCandidates = [
        ...evaluatedDemoCandidates,
        ].sort((first, second) => {
        const statusDifference =
            evaluationPriority[first.evaluation.status] -
            evaluationPriority[second.evaluation.status];

        if (statusDifference !== 0) {
            return statusDifference;
        }

        return (
            first.candidate.distanceMiles -
            second.candidate.distanceMiles
        );
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

            <section className="room-card">
                <header className="mb-8 text-center">
                    <p className="text-sm font-semibold uppercase tracking-widest text-purple-600">
                    Local Agent
                    </p>

                    <h1 className="mt-3 text-4xl font-bold tracking-tight text-gray-900">
                    What matters to you?
                    </h1>

                    <p className="mx-auto mt-3 max-w-lg leading-7 text-gray-600">
                    Add your private preferences one at a time. They currently stay
                    only on this page.
                    </p>
                </header>

                <form
                    onSubmit={handlePreferenceSubmit}
                    className="rounded-3xl border border-gray-200 bg-white p-6 shadow-xl shadow-purple-100/50"
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
                        {Object.entries(categoryLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                            {label}
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


                <button
                    type="submit"
                    className="mt-6 w-full rounded-2xl bg-purple-600 px-6 py-3 font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-purple-700 hover:shadow-md"
                >
                    {editingId ? "Update preference" : "Add preference"}
                </button>
                </form>

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
                        {preferences.map((preference, index) => (
                        <article
                        key={preference.id}
                        className="relative rounded-2xl border border-gray-200 bg-white p-6 pr-28 shadow-sm transition hover:-translate-y-0.5 hover:border-purple-200 hover:shadow-md"
                        >
                            <div className="absolute right-4 top-4 flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => handleEditPreference(preference)}
                                    aria-label="Edit preference"
                                    className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition hover:bg-purple-50 hover:text-purple-700"
                                >
                                    <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="red"
                                    strokeWidth="2.4"
                                    className="h-4 w-4"
                                    >
                                    <path d="M12 20h9" />
                                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
                                    </svg>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => handleDeletePreference(preference.id)}
                                    aria-label="Delete preference"
                                    className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                                >
                                    <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="red"
                                    strokeWidth="1.8"
                                    className="h-4 w-4"
                                    >
                                    <path d="M3 6h18" />
                                    <path d="M8 6V4h8v2" />
                                    <path d="M19 6l-1 14H6L5 6" />
                                    <path d="M10 10v6M14 10v6" />
                                    </svg>
                                </button>
                            </div>

                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-100 text-sm font-bold text-purple-700">
                            {index + 1}
                            </span>
                            <div>
                                <p className="break-words leading-7 text-gray-800">
                                    {preference.statement}
                                </p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-700">
                                        {categoryLabels[preference.category]}
                                    </span>

                                    <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                                        {preference.importance}/5 ·{" "}
                                        {importanceLabels[preference.importance]}
                                    </span>

                                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                                        {visibilityLabels[preference.visibility]}
                                    </span>
                                    
                                </div>

                                {!preference.interpretation && (
                                    <div className="mt-4">
                                        <button
                                        type="button"
                                        onClick={() => handleInterpret(preference)}
                                        className="inline-flex items-center gap-2 text-sm font-semibold text-purple-600 transition hover:text-purple-800"
                                        >
                                        <span>✦</span>
                                        Interpret with agent
                                        </button>
                                    </div>
                                )}

                                {interpretErrors[preference.id] && (
                                    <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
                                        <p className="text-sm font-medium text-red-700">
                                        {interpretErrors[preference.id]}
                                        </p>
                                    </div>
                                )}
                                


                                {preference.interpretation && (
                                    <div className="mt-5 overflow-hidden rounded-2xl border border-purple-100 bg-gradient-to-r from-purple-50/80 to-blue-50/70">
                                        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                                        <div className="flex min-w-0 items-center gap-4">
                                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-lg text-purple-600 shadow-sm">
                                            ✦
                                            </div>

                                            <div className="min-w-0">
                                            <p className="text-xs font-semibold uppercase tracking-widest text-purple-600">
                                                Agent understood
                                            </p>

                                            <p className="mt-1 truncate font-medium text-gray-900">
                                                {preference.interpretation.summary}
                                            </p>
                                            </div>
                                        </div>

                                        {preference.interpretation.status ===
                                            "needs_clarification" &&
                                            preference.interpretation.clarificationQuestion && (
                                                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                                                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                                                    Agent needs one detail
                                                </p>

                                                <p className="mt-1 text-sm text-amber-900">
                                                    {
                                                    preference.interpretation
                                                        .clarificationQuestion
                                                    }
                                                </p>

                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                    handleEditPreference(preference)
                                                    }
                                                    className="mt-3 text-sm font-semibold text-amber-800 hover:text-amber-950"
                                                >
                                                    Edit preference
                                                </button>
                                                </div>
                                            )}

                                        <div className="flex shrink-0 items-center gap-3">
                                        {preference.interpretation.status === "success" && !preference.interpretation.confirmed && (
                                            <button
                                            type="button"
                                            onClick={() =>
                                                handleConfirmInterpretation(preference.id)
                                            }
                                            className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700"
                                            >
                                            Confirm
                                            </button>
                                        )}
                                        </div>  

                                        <button
                                            type="button"
                                            onClick={() => handleInterpret(preference)}
                                            className="shrink-0 text-sm font-semibold text-purple-600 transition hover:text-purple-800"
                                        >
                                            Re-interpret
                                        </button>
                                        </div>

                                        {typeof preference.interpretation.structuredData
                                        .maxDistanceMiles === "number" && (
                                        <div className="border-t border-purple-100/80 bg-white/60 px-5 py-3">
                                            <div className="flex items-center justify-between gap-4">
                                            <span className="text-sm text-gray-500">
                                                Maximum distance
                                            </span>

                                            <span className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 shadow-sm">
                                                {
                                                preference.interpretation.structuredData
                                                    .maxDistanceMiles
                                                }{" "}
                                                miles
                                            </span>
                                            </div>
                                        </div>
                                        )}
                                    </div>
                                    )}
                                
                            </div>

                            
                        </article>
                        ))}
                    </div>
                    )}
                </section>
                <section className="mt-8 rounded-3xl border border-purple-100 bg-white p-6 shadow-xl shadow-purple-100/40">
                    <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-purple-100 text-xl text-purple-700">
                        ◆
                        </div>

                        <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-purple-600">
                            Local candidate test
                        </p>

                        <h2 className="mt-1 text-xl font-semibold text-gray-900">
                            Can this plan work for you?
                        </h2>

                        <p className="mt-1 text-sm leading-6 text-gray-500">
                            This evaluation runs locally using your confirmed
                            distance preference.
                        </p>
                        </div>
                    </div>

                    <form
                        onSubmit={handleEvaluateCandidate}
                        className="mt-6 grid gap-4 sm:grid-cols-[1fr_180px]"
                    >
                        <div>
                        <label
                            htmlFor="candidate-name"
                            className="mb-2 block text-sm font-semibold text-gray-800"
                        >
                            Candidate name
                        </label>

                        <input
                            id="candidate-name"
                            type="text"
                            value={candidateName}
                            onChange={(event) => {
                            setCandidateName(event.target.value);
                            setDistanceEvaluation(null);
                            }}
                            className="w-full rounded-2xl border border-gray-300 bg-gray-50 px-4 py-3 text-gray-900 outline-none transition focus:border-purple-500 focus:bg-white focus:ring-4 focus:ring-purple-100"
                        />
                        </div>

                        <div>
                        <label
                            htmlFor="candidate-distance"
                            className="mb-2 block text-sm font-semibold text-gray-800"
                        >
                            Distance
                        </label>

                        <div className="relative">
                            <input
                            id="candidate-distance"
                            type="number"
                            min="0"
                            step="0.1"
                            value={candidateDistance}
                            onChange={(event) => {
                                setCandidateDistance(event.target.value);
                                setDistanceEvaluation(null);
                            }}
                            className="w-full rounded-2xl border border-gray-300 bg-gray-50 px-4 py-3 pr-16 text-gray-900 outline-none transition focus:border-purple-500 focus:bg-white focus:ring-4 focus:ring-purple-100"
                            />

                            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-400">
                            miles
                            </span>
                        </div>
                        </div>

                        <button
                        type="submit"
                        className="rounded-2xl bg-gray-900 px-6 py-3 font-semibold text-white transition hover:-translate-y-0.5 hover:bg-purple-700 sm:col-span-2"
                        >
                        Evaluate locally
                        </button>
                    </form>

                    {candidateError && (
                        <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3">
                        <p className="text-sm font-medium text-red-700">
                            {candidateError}
                        </p>
                        </div>
                    )}

                    {distanceEvaluation && (
                        <div
                        className={`mt-5 rounded-2xl border px-5 py-4 ${
                            evaluationStyles[distanceEvaluation.status]
                        }`}
                        >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                            <p className="text-xs font-semibold uppercase tracking-widest opacity-70">
                                Local agent result
                            </p>

                            <p className="mt-1 text-lg font-semibold">
                                {evaluationLabels[distanceEvaluation.status]}
                            </p>
                            </div>

                            {distanceEvaluation.status !== "not_ready" &&
                            distanceEvaluation.excessMiles > 0 && (
                                <span className="rounded-full bg-white/70 px-3 py-1 text-sm font-semibold">
                                +{distanceEvaluation.excessMiles} miles
                                </span>
                            )}
                        </div>

                        <p className="mt-3 text-sm leading-6">
                            {distanceEvaluation.privateReason}
                        </p>

                        <p className="mt-3 text-xs opacity-60">
                            Private explanation · Not shared with the group
                        </p>
                        </div>
                    )}
                    </section>

                    <section className="relative mt-8 overflow-hidden rounded-3xl bg-gray-950 p-6 text-white shadow-2xl shadow-purple-950/20">
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
                                Your local agent evaluates each option using your
                                confirmed distance preference.
                                </p>
                            </div>

                            <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-sm font-semibold text-gray-200">
                                {demoCandidates.length} options
                            </span>
                            </div>

                            {!confirmedDistancePreference ? (
                            <div className="mt-6 rounded-2xl border border-dashed border-white/15 bg-white/5 px-6 py-10 text-center">
                                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-purple-500/15 text-purple-300">
                                ✦
                                </div>

                                <p className="mt-4 font-medium text-white">
                                Your agent is not ready to compare options
                                </p>

                                <p className="mt-2 text-sm text-gray-400">
                                Add, interpret, and confirm a distance preference
                                first.
                                </p>
                            </div>
                            ) : (
                            <div className="mt-6 grid gap-4 lg:grid-cols-3">
                                {sortedDemoCandidates.map(
                                ({ candidate, evaluation }, index) => (
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
                                    </div>

                                    <h3 className="mt-5 text-lg font-semibold text-white">
                                        {candidate.name}
                                    </h3>

                                    <p className="mt-1 text-sm text-gray-400">
                                        {candidate.address}
                                    </p>

                                    <div className="mt-5">
                                        <span
                                        className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${
                                            evaluationStyles[evaluation.status]
                                        }`}
                                        >
                                        {evaluationLabels[evaluation.status]}
                                        </span>
                                    </div>

                                    <p className="mt-4 text-sm leading-6 text-gray-300">
                                        {evaluation.privateReason}
                                    </p>

                                    {"excessMiles" in evaluation &&
                                        evaluation.excessMiles > 0 && (
                                        <div className="mt-4 border-t border-white/10 pt-4">
                                            <p className="text-xs font-medium text-gray-400">
                                            Exceeds preference by
                                            </p>

                                            <p className="mt-1 font-semibold text-white">
                                            {evaluation.excessMiles} miles
                                            </p>
                                        </div>
                                        )}

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
            </main>
        );
    }
