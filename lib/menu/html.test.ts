import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverOrderLinksFromHtml,
  extractMenuFromHtml,
  extractMenuFromJsonPayloads,
} from "@/lib/menu/html";
import { inferProvider, makeOrderingSource } from "@/lib/menu/providers";

test("extracts schema.org menu sections and items", () => {
  const source = makeOrderingSource({
    url: "https://example.com/menu",
    discoveredFrom: "restaurant_website",
  });
  const html = `
    <script type="application/ld+json">
      {
        "@type": "Menu",
        "hasMenuSection": [{
          "@type": "MenuSection",
          "name": "Noodles",
          "hasMenuItem": [{
            "@type": "MenuItem",
            "name": "Spicy ramen",
            "description": "Pork broth and chili",
            "offers": {"@type": "Offer", "price": "18.50", "priceCurrency": "USD"}
          }]
        }]
      }
    </script>
  `;

  const result = extractMenuFromHtml(html, source);
  assert.equal(result.items.length, 1);
  assert.deepEqual(
    {
      name: result.items[0].name,
      section: result.items[0].section,
      price: result.items[0].price,
      currency: result.items[0].currency,
    },
    { name: "Spicy ramen", section: "Noodles", price: 18.5, currency: "USD" },
  );
  assert(result.methods.has("json_ld"));
});

test("extracts embedded provider JSON and converts cents", () => {
  const source = makeOrderingSource({
    url: "https://www.doordash.com/store/example-123",
    discoveredFrom: "google_maps",
  });
  const html = `
    <script id="__NEXT_DATA__" type="application/json">
      {"menu":{"categories":[{"name":"Bowls","items":[
        {"name":"Chicken bowl","description":"Rice and salsa","price":1299,"currencyCode":"USD"}
      ]}]}}
    </script>
  `;

  const result = extractMenuFromHtml(html, source);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, "Chicken bowl");
  assert.equal(result.items[0].section, "Bowls");
  assert.equal(result.items[0].price, 12.99);
  assert(result.methods.has("embedded_json"));
});

test("deduplicates repeated copies of the same item across embedded sections", () => {
  const source = makeOrderingSource({
    url: "https://www.doordash.com/store/example-123",
    discoveredFrom: "google_maps",
  });
  const html = `
    <script id="__NEXT_DATA__" type="application/json">
      {"menu":{"categories":[
        {"name":"Popular","items":[{"name":"Chicken bowl","price":1299}]},
        {"name":"Bowls","items":[{"name":"Chicken bowl","price":1299}]}
      ]}}
    </script>
  `;

  const result = extractMenuFromHtml(html, source);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, "Chicken bowl");
  assert.equal(result.items[0].price, 12.99);
});

test("extracts menu items from browser-captured provider JSON", () => {
  const source = makeOrderingSource({
    url: "https://www.doordash.com/store/example-123",
    discoveredFrom: "google_maps",
  });
  const result = extractMenuFromJsonPayloads(
    [
      {
        menu: {
          categories: [
            {
              name: "Tacos",
              items: [
                { name: "Crunchy taco", price: 299, currencyCode: "USD" },
              ],
            },
          ],
        },
      },
    ],
    source,
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, "Crunchy taco");
  assert.equal(result.items[0].price, 2.99);
  assert(result.methods.has("embedded_json"));
});

test("unwraps captured response metadata and recognizes nested provider money", () => {
  const source = makeOrderingSource({
    url: "https://order.toasttab.com/online/example",
    discoveredFrom: "google_maps",
  });
  const result = extractMenuFromJsonPayloads(
    [
      {
        url: "https://ws-api.toasttab.com/consumer-app-bff/menu",
        status: 200,
        contentType: "application/json",
        data: {
          categories: [{
            name: "Entrees",
            items: [{
              displayName: "Garlic noodles",
              priceInfo: {
                basePriceMoney: { amount: 1599, currencyCode: "USD" },
              },
            }],
          }],
        },
      },
    ],
    source,
    "toast",
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, "Garlic noodles");
  assert.equal(result.items[0].price, 15.99);
});

test("filters provider customization instructions from captured menus", () => {
  const source = makeOrderingSource({
    url: "https://www.doordash.com/store/example-123",
    discoveredFrom: "google_maps",
  });
  const result = extractMenuFromJsonPayloads(
    [{
      menu: {
        items: [
          { name: "Chicken bowl", price: 1299 },
          { name: "Choose a side", price: 199 },
          { name: "Utensils", price: 0 },
        ],
      },
    }],
    source,
    "doordash",
  );

  assert.deepEqual(result.items.map((item) => item.name), ["Chicken bowl"]);
});

test("discovers both known providers and custom order links", () => {
  const sources = discoverOrderLinksFromHtml(
    `
      <a href="https://www.doordash.com/store/example">DoorDash</a>
      <a href="/order-now">Order pickup</a>
      <a href="/about">About us</a>
    `,
    "https://restaurant.example/",
  );

  assert.equal(sources.length, 2);
  assert(sources.some((source) => source.provider === "doordash"));
  assert(sources.some((source) => source.url === "https://restaurant.example/order-now"));
});

test("identifies common ordering providers by subdomain", () => {
  assert.equal(inferProvider("https://order.toasttab.com/online/example").provider, "toast");
  assert.equal(inferProvider("https://www.ubereats.com/store/example").provider, "ubereats");
  assert.equal(inferProvider("https://ordering.olo.com/menu/example").provider, "olo");
});

