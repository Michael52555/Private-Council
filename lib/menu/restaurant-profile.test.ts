import assert from "node:assert/strict";
import test from "node:test";
import { classifyRestaurantMealProfile } from "@/lib/menu/restaurant-profile";

test("uses Google fast-food types before estimation", () => {
  assert.equal(
    classifyRestaurantMealProfile({
      name: "Campus Burger",
      primaryType: "fast_food_restaurant",
      placeTypes: ["restaurant", "food"],
    }),
    "fast_food",
  );
});

test("recognizes common chains when Google returns only restaurant", () => {
  for (const name of ["Taco Bell", "Chipotle Mexican Grill", "Chick-fil-A", "Panda Express"]) {
    assert.equal(
      classifyRestaurantMealProfile({ name, primaryType: "restaurant" }),
      "fast_food",
    );
  }
});

test("treats ordinary cuisine restaurants as sit-down", () => {
  for (const primaryType of ["japanese_restaurant", "korean_restaurant", "italian_restaurant"]) {
    assert.equal(
      classifyRestaurantMealProfile({ name: "Local Kitchen", primaryType }),
      "sit_down",
    );
  }
});

test("does not mistake takeout availability for fast-food service", () => {
  assert.equal(
    classifyRestaurantMealProfile({
      name: "Local Italian Kitchen",
      primaryType: "italian_restaurant",
      placeTypes: ["italian_restaurant", "meal_takeaway", "restaurant"],
    }),
    "sit_down",
  );
});
