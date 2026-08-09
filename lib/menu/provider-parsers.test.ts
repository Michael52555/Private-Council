import assert from "node:assert/strict";
import test from "node:test";
import {
  extractProviderMenuFromHtml,
  extractProviderMenuFromJson,
} from "@/lib/menu/provider-parsers";
import { makeOrderingSource } from "@/lib/menu/providers";

test("extracts DoorDash menu items but not modifier choices", () => {
  const source = makeOrderingSource({
    url: "https://www.doordash.com/store/example-123",
    discoveredFrom: "google_maps",
  });
  const result = extractProviderMenuFromJson([
    {
      url: "https://www.doordash.com/graphql/storePage",
      status: 200,
      contentType: "application/json",
      data: {
        data: {
          store: {
            menuCategories: [{
              name: "Bowls",
              items: [{
                name: "Teriyaki bowl",
                price: 1499,
                modifiers: [{ name: "Extra sauce", price: 50 }],
              }],
            }],
          },
        },
      },
    },
  ], source, "doordash");

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, "Teriyaki bowl");
  assert.equal(result.items[0].price, 14.99);
  assert.equal(result.items[0].section, "Bowls");
});

test("extracts Toast and Olo-style provider money schemas", () => {
  const source = makeOrderingSource({
    url: "https://order.toasttab.com/online/example",
    discoveredFrom: "google_maps",
  });
  const result = extractProviderMenuFromJson([
    {
      url: "https://ws-api.toasttab.com/menu",
      status: 200,
      contentType: "application/json",
      data: {
        menuGroups: [{
          name: "Tacos",
          menuItems: [{
            displayName: "Fish taco",
            priceInfo: { basePriceMoney: { amount: 625, currencyCode: "USD" } },
          }],
        }],
      },
    },
  ], source, "toast");

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].price, 6.25);
  assert.equal(result.items[0].section, "Tacos");
});

test("extracts chain menu products from Panda, Habit, and Taco payload shapes", () => {
  for (const [adapterId, url] of [
    ["panda_express", "https://www.pandaexpress.com/locations/ca/irvine/1141"],
    ["habit_burger", "https://order.habitburger.com/menu/123"],
    ["taco_bell", "https://www.tacobell.com/food?store=003904"],
  ] as const) {
    const source = makeOrderingSource({ url, discoveredFrom: "google_maps" });
    const result = extractProviderMenuFromJson([
      {
        url: `${new URL(url).origin}/api/menu`,
        status: 200,
        contentType: "application/json",
        data: {
          categories: [{
            name: "Featured",
            products: [{ productName: "Sample entree", displayPrice: "$11.25" }],
          }],
        },
      },
    ], source, adapterId);
    assert.equal(result.items[0]?.price, 11.25);
    assert.equal(result.items[0]?.section, "Featured");
  }
});

test("applies the provider schema to embedded Taco Bell state", () => {
  const source = makeOrderingSource({
    url: "https://www.tacobell.com/food?store=003904",
    discoveredFrom: "google_maps",
  });
  const result = extractProviderMenuFromHtml(`
    <script id="__NEXT_DATA__" type="application/json">
      {"menuProductCategories":[{"name":"Tacos","menuProducts":[
        {"name":"Crunchy Taco","price":199,"modifierGroups":[
          {"items":[{"name":"Extra cheese","price":75}]}
        ]}
      ]}]}
    </script>
  `, source, "taco_bell");

  assert.deepEqual(result.items.map((item) => item.name), ["Crunchy Taco"]);
  assert.equal(result.items[0].price, 1.99);
});

test("extracts only the Grubhub Best Sellers section from semantic headings", () => {
  const source = makeOrderingSource({
    url: "https://www.grubhub.com/restaurant/example/123",
    discoveredFrom: "google_maps",
  });
  const result = extractProviderMenuFromHtml(`
    <main>
      <section>
        <h2>Best Sellers</h2>
        <p>Most ordered on Grubhub</p>
        <article><h4>Hawaiian BBQ Chicken</h4><p>Rice and macaroni salad.</p><span>$22.99</span></article>
        <article><h4>Chicken Katsu</h4><p>Crispy breaded chicken.</p><span>$21.99</span></article>
        <article><h4>Teriyaki Chicken</h4><span>$20.99</span></article>
        <article><h4>Maui Pineapple Chicken</h4><span>$24.99</span></article>
        <h2>Entrées</h2>
        <article><h4>Entire Menu Item</h4><span>$99.99</span></article>
      </section>
    </main>
  `, source, "grubhub");

  assert.deepEqual(
    result.items.map((item) => [item.name, item.price]),
    [
      ["Hawaiian BBQ Chicken", 22.99],
      ["Chicken Katsu", 21.99],
      ["Teriyaki Chicken", 20.99],
      ["Maui Pineapple Chicken", 24.99],
    ],
  );
  assert(result.methods.has("dom"));
  assert(result.items.every((item) => item.section === "Best Sellers"));
});

test("uses a Grubhub Best Seller badge when the featured section is absent", () => {
  const source = makeOrderingSource({
    url: "https://www.grubhub.com/restaurant/example/123",
    discoveredFrom: "google_maps",
  });
  const result = extractProviderMenuFromHtml(`
    <main>
      <h2>Entrées</h2>
      <article><h4>Spicy Deluxe Sandwich</h4><span>Best Seller</span><span>$10.25</span></article>
      <article><h4>Regular Sandwich</h4><span>$8.45</span></article>
    </main>
  `, source, "grubhub");

  assert.deepEqual(
    result.items.map((item) => [item.name, item.price, item.section]),
    [["Spicy Deluxe Sandwich", 10.25, "Best Sellers"]],
  );
});

test("filters Grubhub JSON payloads to Best Sellers", () => {
  const source = makeOrderingSource({
    url: "https://www.grubhub.com/restaurant/example/123",
    discoveredFrom: "google_maps",
  });
  const result = extractProviderMenuFromJson([
    {
      url: "https://www.grubhub.com/api/menu",
      status: 200,
      contentType: "application/json",
      data: {
        categories: [
          {
            name: "Best Sellers",
            items: [
              { name: "Chicken Sandwich", displayPrice: "$8.45" },
              { name: "Spicy Deluxe Sandwich", displayPrice: "$10.25" },
            ],
          },
          {
            name: "Sides",
            items: [{ name: "Waffle Fries", displayPrice: "$4.49" }],
          },
        ],
      },
    },
  ], source, "grubhub");

  assert.deepEqual(
    result.items.map((item) => [item.name, item.price, item.section]),
    [
      ["Chicken Sandwich", 8.45, "Best Sellers"],
      ["Spicy Deluxe Sandwich", 10.25, "Best Sellers"],
    ],
  );
});
