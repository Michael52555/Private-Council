"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import type {
  Importance,
  Visibility,
  PlanningMode,
  PreferenceCategory,
  PreferenceInterpretation,
  Preference,
  RoomConfig,
  LocalAgentState,
  FoodType,
} from "@/lib/planning-types";
import {
  foodTypeLabel,
} from "@/lib/planning-types";
import { FoodTypePicker } from "@/app/components/food-type-picker";


// type PlanningMode =
//   | "restaurant"
//   | "activity"
//   | "meeting_place"
//   | "custom";

type SetupSection =
  | "location"
  | "distance"
  | "food"
  | "transportation"
  | "departure_time"
  | "budget"
  | "return_time"
  | "other";

type RoomSetupState = {
  version: 1;
  mode: PlanningMode;
  selectedCategories: SetupSection[];
  updatedAt: string;
};

// type Importance = 1 | 2 | 3 | 4 | 5;

// type Visibility =
//   | "private"
//   | "anonymous"
//   | "shareable";

// type PreferenceInterpretation = {
//   status: "success" | "needs_clarification";
//   summary: string;
//   structuredData: {
//     maxDistanceMiles?: number;
//   };
//   clarificationQuestion: string | null;
//   source: "ai";
//   confirmed: boolean;
// };

// type Preference = {
//   id: string;
//   category: string;
//   statement: string;
//   importance: Importance;
//   visibility: Visibility;
//   interpretation?: PreferenceInterpretation;
// };

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
      minPriceDollarsPerPerson:number;
      maxPriceDollarsPerPerson:number;
      clarificationQuestion: null;
    }
  | {
      status: "needs_clarification";
      summary: string;
      minDollarsPerPerson: number;
      maxDollarsPerPerson: null;
      clarificationQuestion: string;
};

type SetupStep = "choose_sections" | "configure_preferences";

const modeLabels: Record<PlanningMode, string> = {
  restaurant: "Restaurant",
  activity: "Activity",
  meeting_place: "Meeting place",
  custom: "Custom",
};

const sectionLabels: Record<SetupSection, string> = {
  location: "Starting location",
  distance: "Distance",
  food: "Food preferences",
  transportation: "Transportation",
  budget: "Budget",
  departure_time: "Departure time",
  return_time: "Return time",
  other: "Something else",
};

const importanceLabels: Record<Importance, string> = {
  1: "Flexible",
  2: "Nice to have",
  3: "Preferred",
  4: "Strong preference",
  5: "Must match",
};

const visibilityDescriptions: Record<Visibility, string> = {
  private: "Only your local agent uses this preference.",
  anonymous: "The group can use it without seeing that it came from you.",
  shareable: "This preference may be shown to other people in the room.",
};



const modeDefaults: Record<PlanningMode, SetupSection[]> = {
  restaurant: [
    "location",
    "distance",
    "food",
    "transportation",
    "departure_time",
  ],

  activity: [
    "location",
    "distance",
    "transportation",
    "departure_time",
    "return_time",
  ],

  meeting_place: [
    "location",
    "distance",
    "transportation",
    "departure_time",
  ],

  custom: [],
};

export default function SetupPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const roomId = params.id;
  const planName = searchParams.get("name") ?? "Untitled plan";

  const [step, setStep] =
  useState<SetupStep>("choose_sections");

  const [originAddressDraft, setOriginAddressDraft] =
  useState("");

  const [confirmedOriginAddress, setConfirmedOriginAddress] =
  useState("");

  const [isEditingOrigin, setIsEditingOrigin] =
  useState(true);

  const [originAddressError, setOriginAddressError] =
  useState("");

  const [distanceStatement, setDistanceStatement] =
  useState("");

    const [distanceImportance, setDistanceImportance] =
    useState<Importance>(3);

    const [distanceVisibility, setDistanceVisibility] =
    useState<Visibility>("private");

    const [
    distanceInterpretation,
    setDistanceInterpretation,
    ] = useState<PreferenceInterpretation | null>(null);

    const [isInterpretingDistance, setIsInterpretingDistance] =
    useState(false);

    const [distanceError, setDistanceError] =
    useState("");

    const [preferredFoodTypes, setPreferredFoodTypes] =
    useState<FoodType[]>([]);

    const [foodImportance, setFoodImportance] =
    useState<Importance>(3);

    const [foodVisibility, setFoodVisibility] =
    useState<Visibility>("private");

    const [foodError, setFoodError] =
    useState("");

    const [budgetStatement, setBudgetStatement] =
  useState("");

    const [budgetImportance, setBudgetImportance] =
    useState<Importance>(3);

    const [budgetVisibility, setBudgetVisibility] =
    useState<Visibility>("private");

    const [
    budgetInterpretation,
    setBudgetInterpretation,
    ] = useState<PreferenceInterpretation | null>(
    null,
    );

    const [
    isInterpretingBudget,
    setIsInterpretingBudget,
    ] = useState(false);

    const [budgetError, setBudgetError] =
    useState("");

  

  const [mode, setMode] =
    useState<PlanningMode>("restaurant");

  const [selectedCategories, setselectedCategories] =
    useState<SetupSection[]>(
      modeDefaults.restaurant,
    );

    const [enabledCategories, setEnabledCategories] =
  useState<PreferenceCategory[]>(
    modeDefaults.restaurant,
  );

  const [error, setError] = useState("");

  useEffect(() => {
    const storageKey =
        `glued:${roomId}:local-agent`;

    const savedState =
        window.localStorage.getItem(storageKey);

    if (!savedState) {
        return;
    }

    try {
        const parsedState = JSON.parse(savedState) as {
        privateOriginAddress?: unknown;
        };

        if (
        typeof parsedState.privateOriginAddress ===
            "string" &&
        parsedState.privateOriginAddress.trim()
        ) {
        const savedAddress =
            parsedState.privateOriginAddress.trim();

        // Restoring an external localStorage snapshot is the purpose of this effect.
        /* eslint-disable react-hooks/set-state-in-effect */
        setConfirmedOriginAddress(savedAddress);
        setOriginAddressDraft(savedAddress);
        setIsEditingOrigin(false);
        /* eslint-enable react-hooks/set-state-in-effect */
        }
    } catch (error) {
        console.error(
        "Could not load private starting location:",
        error,
        );
    }
}, [roomId]);

  function handleModeChange(nextMode: PlanningMode) {
    const defaultCategories = [
        ...modeDefaults[nextMode],
    ];

    setMode(nextMode);
    setEnabledCategories(defaultCategories);
    setselectedCategories(defaultCategories);
    setError("");
   }

  function toggleEnabledCategory(
  category: PreferenceCategory,
) {
    setEnabledCategories((currentCategories) =>
        currentCategories.includes(category)
        ? currentCategories.filter(
            (currentCategory) =>
                currentCategory !== category,
            )
        : [...currentCategories, category],
    );

    setError("");
}

  function handleEnterRoom() {
    if (selectedCategories.length === 0) {
        setError(
        "Select at least one section for your local agent.",
        );
        return;
    }

    if (
        selectedCategories.includes("location") &&
        !confirmedOriginAddress
    ) {
        setOriginAddressError(
        "Confirm your starting address before entering the room.",
        );
        return;
    }

    if (
        selectedCategories.includes("distance") &&
        (
        !distanceInterpretation ||
        distanceInterpretation.status !== "success" ||
        !distanceInterpretation.confirmed ||
        typeof distanceInterpretation.structuredData
            .maxDistanceMiles !== "number"
        )
    ) {
        setDistanceError(
        "Interpret and confirm your distance preference before entering the room.",
        );
        return;
    }

    if (
    selectedCategories.includes("budget") &&
    (
        !budgetInterpretation ||
        budgetInterpretation.status !== "success" ||
        !budgetInterpretation.confirmed ||
        typeof budgetInterpretation.structuredData
        .maxPriceDollarsPerPerson !== "number"||
        typeof budgetInterpretation.structuredData
        .minPriceDollarsPerPerson !== "number"
    )
    ) {
    setBudgetError(
        "Interpret and confirm your budget preference before entering the room.",
    );
    return;
    }

    if (
        selectedCategories.includes("food") &&
        preferredFoodTypes.length === 0
    ) {
        setFoodError(
        "Select at least one food type before entering the room.",
        );
        return;
    }

    const roomConfig: RoomConfig = {
        version: 1,
        mode,
        enabledCategories,
        updatedAt: new Date().toISOString(),
    };

    window.localStorage.setItem(
        `glued:${roomId}:room-config`,
        JSON.stringify(roomConfig),
    );

    const localAgentStorageKey =
        `glued:${roomId}:local-agent`;

    let existingLocalAgentState:
        Partial<LocalAgentState> = {};

    const savedLocalAgentState =
        window.localStorage.getItem(
        localAgentStorageKey,
        );

    if (savedLocalAgentState) {
        try {
        existingLocalAgentState =
            JSON.parse(
            savedLocalAgentState,
            ) as Partial<LocalAgentState>;
        } catch {
        existingLocalAgentState = {};
        }
    }

    const existingPreferences =
    Array.isArray(existingLocalAgentState.preferences)
        ? existingLocalAgentState.preferences
        : [];

    const existingDistancePreference =
    existingPreferences.find(
        (preference) =>
        preference.category === "distance",
    );

    const existingBudgetPreference =
    existingPreferences.find(
        (preference) =>
        preference.category === "budget",
    );

    const existingFoodPreference =
    existingPreferences.find(
        (preference) =>
        preference.category === "food",
    );

    const nextPreferences: Preference[] =
    existingPreferences.filter(
        (preference) =>
        preference.category !== "distance" &&
        preference.category !== "budget" &&
        preference.category !== "food" &&
        selectedCategories.includes(
            preference.category,
        ),
    );

    if (
        selectedCategories.includes("distance") &&
        distanceInterpretation &&
        distanceInterpretation.status === "success"
    ) {
        nextPreferences.push({
        id:
            existingDistancePreference?.id ??
            crypto.randomUUID(),

        category: "distance",
        statement: distanceStatement.trim(),
        importance: distanceImportance,
        visibility: distanceVisibility,

        interpretation: {
            status: "success",
            summary:
            distanceInterpretation.summary,

            structuredData: {
            maxDistanceMiles:
                distanceInterpretation
                .structuredData
                .maxDistanceMiles,
            },

            clarificationQuestion: null,
            source: "ai",
            confirmed: true,
        },
        });
    }

    if (
        selectedCategories.includes("budget") &&
        budgetInterpretation &&
        budgetInterpretation.status === "success"
    ) {
        nextPreferences.push({
            id:
            existingBudgetPreference?.id ??
            crypto.randomUUID(),

            category: "budget",
            statement: budgetStatement.trim(),
            importance: budgetImportance,
            visibility: budgetVisibility,

            interpretation: {
            status: "success",
            summary: budgetInterpretation.summary,

            structuredData: {
                maxPriceDollarsPerPerson:
                budgetInterpretation.structuredData
                    .maxPriceDollarsPerPerson,

                minPriceDollarsPerPerson: 
                budgetInterpretation.structuredData.minPriceDollarsPerPerson,
            },

            clarificationQuestion: null,
            source: "ai",
            confirmed: true,
            },
        });
        }

    if (
        selectedCategories.includes("food") &&
        preferredFoodTypes.length > 0
    ) {
        const foodTypeNames = preferredFoodTypes.map(foodTypeLabel);
        nextPreferences.push({
            id:
            existingFoodPreference?.id ??
            crypto.randomUUID(),
            category: "food",
            statement: foodTypeNames.join(", "),
            importance: foodImportance,
            visibility: foodVisibility,
            interpretation: {
                status: "success",
                summary: `Preferred food types: ${foodTypeNames.join(", ")}`,
                structuredData: {
                    preferredFoodTypes,
                },
                clarificationQuestion: null,
                source: "fixed",
                confirmed: true,
            },
        });
    }

    const nextLocalAgentState: LocalAgentState = {
        version: 1,

        displayName:
        typeof existingLocalAgentState
            .displayName === "string"
            ? existingLocalAgentState.displayName
            : "",

        selectedCategories,

        privateOriginAddress:
        confirmedOriginAddress,

        preferences: nextPreferences,

        updatedAt: new Date().toISOString(),
    };

    window.localStorage.setItem(
        localAgentStorageKey,
        JSON.stringify(nextLocalAgentState),
    );

    router.push(
        `/room/${roomId}?name=${encodeURIComponent(
        planName,
        )}`,
    );
}

   function handleContinueToPreferences() {
        if (enabledCategories.length === 0) {
            setError(
            "Select at least one category for this room.",
            );
            return;
        }

        const roomConfig: RoomConfig = {
            version: 1,
            mode,
            enabledCategories,
            updatedAt: new Date().toISOString(),
        };

        window.localStorage.setItem(
            `glued:${roomId}:room-config`,
            JSON.stringify(roomConfig),
        );

        setselectedCategories((currentCategories) => {
            const stillEnabled =
            currentCategories.filter((category) =>
                enabledCategories.includes(category),
            );

            return stillEnabled.length > 0
            ? stillEnabled
            : [...enabledCategories];
        });

        setError("");
        setStep("configure_preferences");
    }

    async function handleInterpretDistance() {
        const statement = distanceStatement.trim();

        if (!statement) {
            setDistanceError(
            "Describe your distance preference first.",
            );
            return;
        }

        setIsInterpretingDistance(true);
        setDistanceError("");
        setDistanceInterpretation(null);

        try {
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

            const data = (await response.json()) as
            | DistanceInterpretationApiResult
            | { error?: string };

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
            setDistanceInterpretation({
                status: "success",
                summary: data.summary,
                structuredData: {
                maxDistanceMiles: data.maxMiles,
                },
                clarificationQuestion: null,
                source: "ai",
                confirmed: false,
            });
            } else {
            setDistanceInterpretation({
                status: "needs_clarification",
                summary: data.summary,
                structuredData: {},
                clarificationQuestion:
                data.clarificationQuestion,
                source: "ai",
                confirmed: false,
            });
            }
        } catch (error) {
            setDistanceError(
            error instanceof Error
                ? error.message
                : "Could not interpret this preference.",
            );
        } finally {
            setIsInterpretingDistance(false);
        }
    }

    async function handleInterpretBudget() {
        const statement =
        budgetStatement.trim();

        if (!statement) {
        setBudgetError(
            "Describe your budget preference first.",
        );
        return;
        }

        setIsInterpretingBudget(true);
        setBudgetError("");
        setBudgetInterpretation(null);

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
            setBudgetInterpretation({
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
            });
        } else {
            setBudgetInterpretation({
            status: "needs_clarification",
            summary: data.summary,
            structuredData: {},
            clarificationQuestion:
                data.clarificationQuestion,
            source: "ai",
            confirmed: false,
            });
        }
        } catch (error) {
        setBudgetError(
            error instanceof Error
            ? error.message
            : "Could not interpret this budget preference.",
        );
        } finally {
        setIsInterpretingBudget(false);
        }
    }

    function handleConfirmDistance() {
    setDistanceInterpretation((current) => {
        if (!current || current.status !== "success") {
        return current;
        }

        return {
        ...current,
        confirmed: true,
        };
    });
    }

    function handleConfirmBudget() {
    setBudgetInterpretation((current) => {
        if (
        !current ||
        current.status !== "success"
        ) {
        return current;
        }

        return {
        ...current,
        confirmed: true,
        };
    });
    }

    function handleConfirmOriginAddress() {
        const trimmedAddress =
            originAddressDraft.trim();

        if (!trimmedAddress) {
            setOriginAddressError(
            "Please enter a starting address.",
            );
            return;
        }

        setConfirmedOriginAddress(trimmedAddress);
        setOriginAddressDraft(trimmedAddress);
        setOriginAddressError("");
        setIsEditingOrigin(false);
    }

    function handleEditOriginAddress() {
        setOriginAddressDraft(
            confirmedOriginAddress,
        );
        setOriginAddressError("");
        setIsEditingOrigin(true);
        }

        function handleCancelOriginEdit() {
        setOriginAddressDraft(
            confirmedOriginAddress,
        );
        setOriginAddressError("");
        setIsEditingOrigin(false);
    }

  return (
    <main className="setup-page">
      <section className = "setup-card">
            <section className="relative z-10 w-full max-w-4xl rounded-[32px] border border-white/80 bg-white/80 p-8 shadow-2xl shadow-purple-950/10 backdrop-blur-2xl">
                <header>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-purple-600">
                    Plan setup
                </p>

                <h1 className="mt-3 text-4xl font-bold tracking-tight text-gray-950">
                    {planName}
                </h1>

                <p className="mt-3 text-gray-600">
                    Choose the kind of plan and the private
                    sections your local agent should collect.
                </p>
                </header>

                {step === "choose_sections" ? (
                <>   

                    <section className="mt-8">
                    <h2 className="text-lg font-semibold text-gray-900">
                        Planning mode
                    </h2>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {(
                        Object.keys(
                            modeLabels,
                        ) as PlanningMode[]
                        ).map((modeValue) => {
                        const selected = mode === modeValue;

                        return (
                            <button
                            key={modeValue}
                            type="button"
                            onClick={() =>
                                handleModeChange(modeValue)
                            }
                            className={`rounded-2xl border px-4 py-5 text-left font-semibold transition ${
                                selected
                                ? "border-purple-600 bg-purple-600 text-white shadow-lg shadow-purple-200"
                                : "border-gray-200 bg-white text-gray-800 hover:border-purple-300 hover:bg-purple-50"
                            }`}
                            >
                            {modeLabels[modeValue]}
                            </button>
                        );
                        })}
                    </div>
                    </section>

                    <section className="mt-8">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900">
                        What should your agent ask about?
                        </h2>

                        <p className="mt-1 text-sm text-gray-500">
                        These become the sections in your room
                        workspace.
                        </p>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {(
                        Object.keys(
                            sectionLabels,
                        ) as SetupSection[]
                        ).map((section) => {
                        const selected =
                            enabledCategories.includes(section);

                        return (
                            <button
                            key={section}
                            type="button"
                            onClick={() =>
                                toggleEnabledCategory(section)
                            }
                            className={`flex items-center justify-between rounded-2xl border px-4 py-4 text-left transition ${
                                selected
                                ? "border-purple-300 bg-purple-50 text-purple-950"
                                : "border-gray-200 bg-white text-gray-600"
                            }`}
                            >
                            <span className="font-semibold">
                                {sectionLabels[section]}
                            </span>

                            <span
                                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                                selected
                                    ? "bg-purple-600 text-white"
                                    : "bg-gray-100 text-gray-400"
                                }`}
                            >
                                {selected ? "✓" : "+"}
                            </span>
                            </button>
                        );
                        })}
                    </div>
                    </section>

                    {error && (
                    <p className="mt-5 text-sm font-medium text-red-600">
                        {error}
                    </p>
                    )}

                    <button
                    type="button"
                    onClick={handleContinueToPreferences}
                    className="mt-8 w-full rounded-2xl bg-purple-600 px-6 py-4 font-semibold text-white transition hover:-translate-y-0.5 hover:bg-purple-700"
                    >
                    Continue to private setup →
                    </button>
                </>
                ) : (
                <section className="mt-8">
                    <button
                        type="button"
                        onClick={() =>
                        setStep("choose_sections")
                        }
                        className="text-sm font-semibold text-purple-700 transition hover:text-purple-900"
                    >
                        ← Back to sections
                    </button>

                    <p className="mt-6 text-center text-sm font-semibold uppercase tracking-[0.18em] text-purple-600">
                        Private setup
                    </p>

                    <h2 className="mt-2 text-center text-3xl font-bold text-gray-950">
                        Configure your local agent
                    </h2>

                    <section className="mt-8 rounded-3xl border border-purple-100 bg-white p-6 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-600">
                            Your sections
                        </p>

                        <h3 className="mt-2 text-xl font-semibold text-gray-950">
                            What matters to you personally?
                        </h3>

                        <p className="mt-2 text-sm leading-6 text-gray-500">
                            The room supports these categories, but you only
                            need to configure the ones that matter to you.
                        </p>

                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                            {enabledCategories.map((category) => {
                            const selected =
                                selectedCategories.includes(category);

                            return (
                                <button
                                key={category}
                                type="button"
                                onClick={() =>
                                    setselectedCategories(
                                    (currentCategories) =>
                                        currentCategories.includes(category)
                                        ? currentCategories.filter(
                                            (currentCategory) =>
                                                currentCategory !== category,
                                            )
                                        : [
                                            ...currentCategories,
                                            category,
                                            ],
                                    )
                                }
                                className={`flex items-center justify-between rounded-2xl border px-4 py-4 text-left transition ${
                                    selected
                                    ? "border-purple-300 bg-purple-50 text-purple-950"
                                    : "border-gray-200 bg-white text-gray-500"
                                }`}
                                >
                                <span className="font-semibold">
                                    {sectionLabels[category]}
                                </span>

                                <span
                                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                                    selected
                                        ? "bg-purple-600 text-white"
                                        : "bg-gray-100 text-gray-400"
                                    }`}
                                >
                                    {selected ? "✓" : "+"}
                                </span>
                                </button>
                            );
                            })}
                        </div>
                    </section>

                    <p className="mt-3 text-center text-gray-600">
                        This is where the inputs for your selected
                        sections will go.
                    </p>

                    {selectedCategories.includes("location") && (
                        <section className="mt-8 rounded-3xl border border-purple-100 bg-white p-6 shadow-sm">
                            <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-600">
                                Starting location
                                </p>

                                <h3 className="mt-2 text-xl font-semibold text-gray-950">
                                Where are you starting from?
                                </h3>

                                <p className="mt-2 text-sm leading-6 text-gray-500">
                                Your exact address is used to find nearby
                                options and is never shown to other
                                participants.
                                </p>
                            </div>

                            {!isEditingOrigin &&
                                confirmedOriginAddress && (
                                <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                                    Confirmed
                                </span>
                                )}
                            </div>

                            {isEditingOrigin ? (
                            <div className="mt-6">
                                <label
                                htmlFor="setup-origin-address"
                                className="block text-sm font-semibold text-gray-800"
                                >
                                Address
                                </label>

                                <input
                                id="setup-origin-address"
                                type="text"
                                value={originAddressDraft}
                                onChange={(event) => {
                                    setOriginAddressDraft(
                                    event.target.value,
                                    );
                                    setOriginAddressError("");
                                }}
                                placeholder="3551 Trousdale Pkwy, Los Angeles, CA"
                                autoComplete="street-address"
                                className="mt-2 w-full rounded-2xl border border-gray-300 bg-gray-50 px-4 py-3 text-gray-900 outline-none transition focus:border-purple-500 focus:bg-white focus:ring-4 focus:ring-purple-100"
                                />

                                {originAddressError && (
                                <p className="mt-2 text-sm font-medium text-red-600">
                                    {originAddressError}
                                </p>
                                )}

                                <div className="mt-4 flex gap-3">
                                <button
                                    type="button"
                                    onClick={handleConfirmOriginAddress}
                                    className="flex-1 rounded-xl bg-purple-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-purple-700"
                                >
                                    Confirm address
                                </button>

                                {confirmedOriginAddress && (
                                    <button
                                    type="button"
                                    onClick={handleCancelOriginEdit}
                                    className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
                                    >
                                    Cancel
                                    </button>
                                )}
                                </div>
                            </div>
                            ) : (
                            <div className="mt-6 rounded-2xl border border-green-100 bg-green-50/70 p-4">
                                <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-wide text-green-700">
                                    Confirmed starting point
                                    </p>

                                    <p className="mt-2 break-words text-sm font-medium leading-6 text-gray-900">
                                    {confirmedOriginAddress}
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    onClick={handleEditOriginAddress}
                                    className="shrink-0 text-sm font-semibold text-purple-700 transition hover:text-purple-900"
                                >
                                    Edit
                                </button>
                                </div>
                            </div>
                            )}
                        </section>

                        
                        )}
                    
                    {selectedCategories.includes("distance") && (
                        <section className="mt-5 rounded-3xl border border-purple-100 bg-white p-6 shadow-sm">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-600">
                            Distance
                            </p>

                            <h3 className="mt-2 text-xl font-semibold text-gray-950">
                            How far are you willing to travel?
                            </h3>

                            <input
                            type="text"
                            value={distanceStatement}
                            onChange={(event) => {
                                setDistanceStatement(event.target.value);
                                setDistanceInterpretation(null);
                                setDistanceError("");
                            }}
                            placeholder="For example: at most 5 miles"
                            className="mt-5 w-full rounded-2xl border border-gray-300 bg-gray-50 px-4 py-3 text-gray-900 outline-none transition focus:border-purple-500 focus:bg-white focus:ring-4 focus:ring-purple-100"
                            />

                            <fieldset className="mt-5">
                            <legend className="text-sm font-semibold text-gray-800">
                                How important is this?
                            </legend>

                            <div className="mt-3 grid grid-cols-5 gap-2">
                                {([1, 2, 3, 4, 5] as Importance[]).map(
                                (importance) => (
                                    <button
                                    key={importance}
                                    type="button"
                                    onClick={() =>
                                        setDistanceImportance(importance)
                                    }
                                    className={`rounded-xl border py-3 font-semibold ${
                                        distanceImportance === importance
                                        ? "border-purple-600 bg-purple-600 text-white"
                                        : "border-gray-200 bg-gray-50 text-gray-700"
                                    }`}
                                    >
                                    {importance}
                                    </button>
                                ),
                                )}
                            </div>
                            </fieldset>

                            <label className="mt-5 block text-sm font-semibold text-gray-800">
                            Visibility
                            </label>

                            <select
                            value={distanceVisibility}
                            onChange={(event) =>
                                setDistanceVisibility(
                                event.target.value as Visibility,
                                )
                            }
                            className="mt-2 w-full rounded-2xl border border-gray-300 bg-gray-50 px-4 py-3 text-gray-900"
                            >
                            <option value="private">Only my agent</option>
                            <option value="anonymous">
                                Anonymous to the group
                            </option>
                            <option value="shareable">
                                May be shared
                            </option>
                            </select>

                            {distanceError && (
                            <p className="mt-3 text-sm font-medium text-red-600">
                                {distanceError}
                            </p>
                            )}

                            {!distanceInterpretation && (
                            <button
                                type="button"
                                onClick={handleInterpretDistance}
                                disabled={isInterpretingDistance}
                                className="mt-5 w-full rounded-2xl bg-purple-600 px-5 py-3 font-semibold text-white disabled:opacity-60"
                            >
                                {isInterpretingDistance
                                ? "Interpreting..."
                                : "Interpret with agent"}
                            </button>
                            )}

                            {distanceInterpretation && (
                            <div className="mt-5 rounded-2xl border border-purple-100 bg-purple-50/70 p-5">
                                <p className="text-xs font-semibold uppercase tracking-widest text-purple-600">
                                Agent understood
                                </p>

                                <p className="mt-2 text-gray-900">
                                {distanceInterpretation.summary}
                                </p>

                                {distanceInterpretation.status ===
                                "needs_clarification" && (
                                <p className="mt-3 text-sm text-amber-800">
                                    {
                                    distanceInterpretation.clarificationQuestion
                                    }
                                </p>
                                )}

                                {distanceInterpretation.status === "success" &&
                                !distanceInterpretation.confirmed && (
                                    <button
                                    type="button"
                                    onClick={handleConfirmDistance}
                                    className="mt-4 rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white"
                                    >
                                    Confirm
                                    </button>
                                )}

                                {distanceInterpretation.confirmed && (
                                <span className="mt-4 inline-flex rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-700">
                                    Confirmed
                                </span>
                                )}
                            </div>
                            )}
                        </section>
                        )}

                    {selectedCategories.includes("food") && (
                        <section className="mt-5 rounded-3xl border border-purple-100 bg-white p-6 shadow-sm">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-600">
                            Food preferences
                            </p>

                            <h3 className="mt-2 text-xl font-semibold text-gray-950">
                            What are you in the mood for?
                            </h3>

                            <p className="mt-2 text-sm leading-6 text-gray-500">
                            Choose any cuisines or styles that sound good. Matching any one of them counts.
                            </p>

                            <div className="mt-5">
                            <FoodTypePicker
                                selected={preferredFoodTypes}
                                onChange={(foodTypes) => {
                                setPreferredFoodTypes(foodTypes);
                                setFoodError("");
                                }}
                            />
                            </div>

                            <fieldset className="mt-5">
                            <legend className="text-sm font-semibold text-gray-800">
                                How much should this affect recommendations?
                            </legend>

                            <div className="mt-3 grid grid-cols-5 gap-2">
                                {([1, 2, 3, 4, 5] as Importance[]).map((importance) => (
                                <button
                                    key={importance}
                                    type="button"
                                    onClick={() => setFoodImportance(importance)}
                                    className={`rounded-xl border py-3 font-semibold transition ${
                                    foodImportance === importance
                                        ? "border-purple-600 bg-purple-600 text-white"
                                        : "border-gray-200 bg-gray-50 text-gray-700 hover:border-purple-200 hover:bg-purple-50"
                                    }`}
                                    aria-label={`${importance}: ${importanceLabels[importance]}`}
                                    aria-pressed={foodImportance === importance}
                                >
                                    {importance}
                                </button>
                                ))}
                            </div>

                            <div className="mt-2 flex justify-between text-xs font-medium text-gray-500">
                                <span>Flexible</span>
                                <span>Must match</span>
                            </div>

                            <p className="mt-2 text-sm font-semibold text-purple-700">
                                {importanceLabels[foodImportance]}
                            </p>
                            </fieldset>

                            <label className="mt-5 block text-sm font-semibold text-gray-800">
                            Who can see this preference?
                            </label>

                            <select
                            value={foodVisibility}
                            onChange={(event) =>
                                setFoodVisibility(event.target.value as Visibility)
                            }
                            className="mt-2 w-full rounded-2xl border border-gray-300 bg-gray-50 px-4 py-3 text-gray-900"
                            >
                            <option value="private">Only my agent</option>
                            <option value="anonymous">Anonymous to the group</option>
                            <option value="shareable">May be shared</option>
                            </select>

                            <p className="mt-2 text-sm leading-5 text-gray-500">
                            {visibilityDescriptions[foodVisibility]}
                            </p>

                            {foodError && (
                            <p className="mt-3 text-sm font-medium text-red-600">
                                {foodError}
                            </p>
                            )}

                        </section>
                        )}
                    
                    {selectedCategories.includes("budget") && (
                        <section className="mt-5 rounded-3xl border border-purple-100 bg-white p-6 shadow-sm">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-600">
                            Budget
                            </p>

                            <h3 className="mt-2 text-xl font-semibold text-gray-950">
                            What is your budget range per person?
                            </h3>

                            <p className="mt-2 text-sm leading-6 text-gray-500">
                            Describe the price range you would feel comfortable with for one person&apos;s meal.
                            </p>

                            <input
                            type="text"
                            value={budgetStatement}
                            onChange={(event) => {
                                setBudgetStatement(event.target.value);
                                setBudgetError("");
                            }}
                            placeholder="For example: Between $50 and $100"
                            className="mt-5 w-full rounded-2xl border border-gray-300 bg-gray-50 px-4 py-3 text-gray-900 outline-none transition focus:border-purple-500 focus:bg-white focus:ring-4 focus:ring-purple-100"
                            />

                            <fieldset className="mt-5">
                            <legend className="text-sm font-semibold text-gray-800">
                                How important is this?
                            </legend>

                            <div className="mt-3 grid grid-cols-5 gap-2">
                                {([1, 2, 3, 4, 5] as Importance[]).map(
                                (importance) => (
                                    <button
                                    key={importance}
                                    type="button"
                                    onClick={() =>
                                        setBudgetImportance(importance)
                                    }
                                    className={`rounded-xl border py-3 font-semibold transition ${
                                        budgetImportance === importance
                                        ? "border-purple-600 bg-purple-600 text-white"
                                        : "border-gray-200 bg-gray-50 text-gray-700 hover:border-purple-200 hover:bg-purple-50"
                                    }`}
                                    >
                                    {importance}
                                    </button>
                                ),
                                )}
                            </div>

                            <p className="mt-2 text-sm font-medium text-purple-600">
                                {budgetImportance <= 3
                                ? "Open to compromise"
                                : budgetImportance === 4
                                    ? "Strong preference"
                                    : "Must be respected"}
                            </p>
                            </fieldset>

                            <label className="mt-5 block text-sm font-semibold text-gray-800">
                            Visibility
                            </label>

                            <select
                            value={budgetVisibility}
                            onChange={(event) =>
                                setBudgetVisibility(
                                event.target.value as Visibility,
                                )
                            }
                            className="mt-2 w-full rounded-2xl border border-gray-300 bg-gray-50 px-4 py-3 text-gray-900 outline-none transition focus:border-purple-500 focus:bg-white focus:ring-4 focus:ring-purple-100"
                            >
                            <option value="private">
                                Only my agent
                            </option>

                            <option value="anonymous">
                                Anonymous to the group
                            </option>

                            <option value="shareable">
                                May be shared
                            </option>
                            </select>

                            {budgetError && (
                            <p className="mt-3 text-sm font-medium text-red-600">
                                {budgetError}
                            </p>
                            )}

                            {!budgetInterpretation && (
                            <button
                                type="button"
                                onClick={handleInterpretBudget}
                                disabled={isInterpretingBudget}
                                className="mt-5 w-full rounded-2xl bg-purple-600 px-5 py-3 font-semibold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isInterpretingBudget
                                ? "Interpreting..."
                                : "Interpret with agent"}
                            </button>
                            )}

                            {budgetInterpretation && (
                            <div className="mt-5 overflow-hidden rounded-2xl border border-purple-100 bg-purple-50/70">
                                <div className="p-5">
                                <p className="text-xs font-semibold uppercase tracking-widest text-purple-600">
                                    Agent understood
                                </p>

                                <p className="mt-2 leading-6 text-gray-900">
                                    {budgetInterpretation.summary}
                                </p>

                                {budgetInterpretation.status ===
                                    "needs_clarification" && (
                                    <>
                                    <p className="mt-3 text-sm font-medium text-amber-800">
                                        {
                                        budgetInterpretation.clarificationQuestion
                                        }
                                    </p>

                                    <button
                                        type="button"
                                        onClick={() => {
                                        setBudgetInterpretation(null);
                                        setBudgetError("");
                                        }}
                                        className="mt-4 text-sm font-semibold text-purple-600 hover:text-purple-800"
                                    >
                                        Revise preference
                                    </button>
                                    </>
                                )}

                                {budgetInterpretation.status === "success" &&
                                    !budgetInterpretation.confirmed && (
                                    <div className="mt-4 flex flex-wrap gap-3">
                                        <button
                                        type="button"
                                        onClick={handleConfirmBudget}
                                        className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700"
                                        >
                                        Confirm
                                        </button>
                                    </div>
                                    )}

                                {budgetInterpretation.confirmed && (
                                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                    <span className="inline-flex rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-700">
                                        Confirmed
                                    </span>

                                    
                                    </div>
                                )}
                                </div>

                                {budgetInterpretation.status === "success" &&
                                (
                                <div className="flex items-center justify-between border-t border-purple-100 bg-white/60 px-5 py-4">
                                    <span className="text-sm text-gray-500">
                                    Budget Constraint
                                    </span>

                                <span className="rounded-xl bg-white px-4 py-2 font-semibold text-gray-900 shadow-sm">
                                {(() => {
                                    const min =
                                    budgetInterpretation.structuredData
                                        .minPriceDollarsPerPerson;

                                    const max =
                                    budgetInterpretation.structuredData
                                        .maxPriceDollarsPerPerson;

                                    if (
                                    typeof min === "number" &&
                                    typeof max === "number"
                                    ) {
                                    return `$${min} - $${max} / person`;
                                    }

                                    if (typeof max === "number") {
                                    return `$${max} max / person`;
                                    }

                                    if (typeof min === "number") {
                                    return `$${min}+ / person`;
                                    }

                                    return "";
                                })()}
                                </span>
                                </div>

                                
                                )}
                            </div>  
                            )}
                        </section>
                        )}

                    <button
                        type="button"
                        onClick={handleEnterRoom}
                        className="mt-8 w-full rounded-2xl bg-purple-600 px-6 py-4 font-semibold text-white transition hover:-translate-y-0.5 hover:bg-purple-700"
                    >
                        Enter room →
                    </button>
                </section>
                )}
            </section>
      </section>
    </main>
  );
}
