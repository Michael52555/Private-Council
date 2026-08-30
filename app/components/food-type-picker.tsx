"use client";

import {
  FOOD_TYPE_FACETS,
  FOOD_TYPE_OPTIONS,
  type FoodType,
} from "@/lib/planning-types";

type FoodTypePickerProps = {
  selected: FoodType[];
  onChange: (foodTypes: FoodType[]) => void;
};

export function FoodTypePicker({
  selected,
  onChange,
}: FoodTypePickerProps) {
  return (
    <div>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <p className="text-sm font-medium text-gray-600" aria-live="polite">
          {selected.length === 0
            ? "Nothing selected yet"
            : `${selected.length} selected`}
        </p>

        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="shrink-0 text-sm font-semibold text-purple-700 transition hover:text-purple-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="mt-4 space-y-5">
        {FOOD_TYPE_FACETS.map((facet) => (
          <fieldset key={facet.value}>
            <legend className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
              {facet.label}
            </legend>

            <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
              {FOOD_TYPE_OPTIONS
                .filter((option) => option.facet === facet.value)
                .map((option) => {
                  const isSelected = selected.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() =>
                        onChange(
                          isSelected
                            ? selected.filter((value) => value !== option.value)
                            : [...selected, option.value],
                        )
                      }
                      className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 ${
                        isSelected
                          ? "border-purple-600 bg-purple-600 text-white shadow-sm"
                          : "border-gray-200 bg-gray-50 text-gray-700 hover:border-purple-300 hover:bg-purple-50"
                      }`}
                    >
                      {isSelected && (
                        <span aria-hidden="true" className="text-base leading-none">
                          &#10003;
                        </span>
                      )}
                      {option.label}
                    </button>
                  );
                })}
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  );
}
