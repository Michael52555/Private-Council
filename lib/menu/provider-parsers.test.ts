import assert from "node:assert/strict";
import test from "node:test";
import {
  extractProviderMenuFromHtml,
  extractProviderMenuFromJson,
  providerOrderingEntryUrl,
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

test("resolves a Chick-fil-A location page to its store-specific ordering app", () => {
  const source = makeOrderingSource({
    url: "https://www.chick-fil-a.com/locations/ca/university-center-irvine",
    discoveredFrom: "google_maps",
  });
  const result = providerOrderingEntryUrl(`
    <a href="https://order.chick-fil-a.com/load-catering?locationNumber=03260">
      Order catering
    </a>
    <a href="https://order.chick-fil-a.com/load-dot-com?locationNumber=03260">
      Order pickup
    </a>
  `, source, "chick_fil_a");

  assert.equal(
    result,
    "https://order.chick-fil-a.com/load-dot-com?locationNumber=03260",
  );
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

test("extracts a public Grubhub menu from semantic headings when its JSON API is unavailable", () => {
  const source = makeOrderingSource({
    url: "https://www.grubhub.com/restaurant/example/123",
    discoveredFrom: "google_maps",
  });
  const result = extractProviderMenuFromHtml(`
    <main>
      <section>
        <h3>Chicken</h3>
        <article><h6>Hawaiian BBQ Chicken</h6><p>Rice and macaroni salad.</p><span>$22.99</span></article>
        <article><h6>Chicken Katsu</h6><p>Crispy breaded chicken.</p><span>$21.99</span></article>
        <article><h6>Teriyaki Chicken</h6><span>$20.99</span></article>
        <article><h6>Maui Pineapple Chicken</h6><span>$24.99</span></article>
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
});
