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

type PreferenceInterpretation = {
  summary: string;
  structuredData: StructuredPreferenceData;
  source: "mock";
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

function mockInterpretPreference(
  preference: Preference,
): PreferenceInterpretation {
  const text = preference.statement.trim();

  if (
    preference.category === "location" ||
    preference.category === "distance"
  ) {
    const distanceMatch = text.match(
      /(\d+(?:\.\d+)?)\s*(?:mile|miles|mi)\b/i,
    );

    const maxDistanceMiles = distanceMatch
      ? Number(distanceMatch[1])
      : undefined;

    return {
      summary:
        maxDistanceMiles !== undefined
          ? `Stay within ${maxDistanceMiles} miles of the stated location`
          : "Use the stated location as a planning reference",
      structuredData: {
        locationText: text,
        maxDistanceMiles,
      },
      source: "mock",
    };
  }

  return {
    summary: text,
    structuredData: {},
    source: "mock",
  };
}

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
        <path d="M120 180 C350 220 430 350 610 410" />
        <path d="M1320 160 C1100 210 1030 330 830 400" />
        <path d="M90 700 C300 650 410 570 610 500" />
        <path d="M1350 720 C1120 660 1030 580 830 510" />
      </svg>

      <span className="agent agent-one" />
      <span className="agent agent-two" />
      <span className="agent agent-three" />
      <span className="agent agent-four" />
      <span className="agent agent-five" />
    </div>
  );
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

  const [draft, setDraft] = useState<PreferenceDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);

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
              }
            : preference,
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

    function handleMockInterpret(preferenceId: string) {
    setPreferences((currentPreferences) =>
        currentPreferences.map((preference) => {
        if (preference.id !== preferenceId) {
            return preference;
        }

        return {
            ...preference,
            interpretation: mockInterpretPreference(preference),
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
                                        onClick={() => handleMockInterpret(preference.id)}
                                        className="inline-flex items-center gap-2 text-sm font-semibold text-purple-600 transition hover:text-purple-800"
                                        >
                                        <span>✦</span>
                                        Interpret with agent
                                        </button>
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

                                        <button
                                            type="button"
                                            onClick={() => handleMockInterpret(preference.id)}
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
                </section>
            </main>
        );
}