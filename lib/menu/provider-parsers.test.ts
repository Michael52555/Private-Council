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

test("extracts complete DoorDash sections, restaurant tags, and popular items", () => {
  const source = makeOrderingSource({
    url: "https://www.doordash.com/store/example-456",
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
            name: "Example Bowls",
            businessTags: [{ name: "Bowls" }, { name: "Healthy" }],
            menus: [{
              name: "Main Menu",
              menuCategories: [
                {
                  name: "Most Ordered",
                  items: [{
                    name: "Chicken Teriyaki Bowl",
                    description: "Chicken, rice, and vegetables",
                    price: 1499,
                    isPopular: true,
                  }],
                },
                {
                  name: "Bowls",
                  items: [
                    { name: "Chicken Teriyaki Bowl", price: 1499 },
                    { name: "Salmon Bowl", price: 1799 },
                  ],
                },
              ],
            }],
          },
        },
      },
    },
  ], source, "doordash");

  assert.deepEqual(result.restaurantTags, ["Bowls", "Healthy"]);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].name, "Chicken Teriyaki Bowl");
  assert.equal(result.items[0].section, "Bowls");
  assert.equal(result.items[0].featured, true);
  assert.equal(result.items[1].price, 17.99);
});

test("extracts DoorDash menu cards from rendered semantic HTML", () => {
  const source = makeOrderingSource({
    url: "https://www.doordash.com/store/example-789",
    discoveredFrom: "google_maps",
  });
  const result = extractProviderMenuFromHtml(`
    <main>
      <h2>Most Ordered</h2>
      <article data-testid="MenuItem">
        <h3 data-testid="item-name">Spicy Chicken Sandwich</h3>
        <p>Crispy chicken with pickles</p>
        <span>$12.49</span>
        <span>Most ordered</span>
      </article>
      <h2>Drinks</h2>
      <article data-testid="MenuItem">
        <h3 data-testid="item-name">Iced Tea</h3>
        <span>$3.25</span>
      </article>
    </main>
  `, source, "doordash");

  assert.deepEqual(result.items.map((item) => item.name), [
    "Spicy Chicken Sandwich",
    "Iced Tea",
  ]);
  assert.equal(result.items[0].section, "Most Ordered");
  assert.equal(result.items[0].featured, true);
  assert.equal(result.items[1].section, "Drinks");
  assert(result.methods.has("dom"));
});

test("extracts the server-rendered DoorDash Schema.org menu", () => {
  const source = makeOrderingSource({
    url: "https://www.doordash.com/store/blaze-pizza-irvine-385222/",
    discoveredFrom: "google_maps",
  });
  const result = extractProviderMenuFromHtml(`
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Menu",
        "hasMenuSection": [{
          "@type": "MenuSection",
          "name": "Most Ordered",
          "hasMenuItem": [{
            "@type": "MenuItem",
            "name": "Build Your Own Pizza (11-inch)",
            "description": "Choose your toppings",
            "offers": {"@type": "Offer", "price": "$17.68", "priceCurrency": "USD"}
          }, {
            "@type": "MenuItem",
            "name": "2 Top Pizza",
            "offers": {"@type": "Offer", "price": "$15.24"}
          }]
        }]
      }
    </script>
  `, source, "doordash");

  assert.deepEqual(
    result.items.map((item) => [item.name, item.price, item.section]),
    [
      ["Build Your Own Pizza (11-inch)", 17.68, "Most Ordered"],
      ["2 Top Pizza", 15.24, "Most Ordered"],
    ],
  );
  assert(result.methods.has("json_ld"));
});

test("extracts DoorDash button cards whose product name is an aria-label", () => {
  const source = makeOrderingSource({
    url: "https://www.doordash.com/store/example-aria-card",
    discoveredFrom: "google_maps",
  });
  const result = extractProviderMenuFromHtml(`
    <main>
      <h2 data-category-scroll-selector="popular-items">Most Ordered</h2>
      <div aria-label="Build Your Own Pizza (11-inch)" tabindex="0" role="button">
        <span>Build Your Own Pizza (11-inch)</span>
        <span>$17.68</span>
      </div>
    </main>
  `, source, "doordash");

  assert.equal(result.items[0]?.name, "Build Your Own Pizza (11-inch)");
  assert.equal(result.items[0]?.price, 17.68);
  assert.equal(result.items[0]?.section, "Most Ordered");
  assert(result.methods.has("dom"));
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

test("extracts the full Grubhub menu and marks Best Sellers as featured", () => {
  const source = makeOrderingSource({
    url: "https://www.grubhub.com/restaurant/example/123",
    discoveredFrom: "google_maps",
  });
  const result = extractProviderMenuFromHtml(`
    <main>
      <p>Bowls, Dinner, Healthy · $$</p>
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
      ["Entire Menu Item", 99.99],
    ],
  );
  assert(result.methods.has("dom"));
  assert.deepEqual(
    result.items.map((item) => [item.section, item.featured ?? false]),
    [
      ["Best Sellers", true],
      ["Best Sellers", true],
      ["Best Sellers", true],
      ["Best Sellers", true],
      ["Entrées", false],
    ],
  );
  assert.deepEqual(result.restaurantTags, ["Bowls", "Dinner", "Healthy"]);
});

test("extracts Grubhub restaurant cuisine tags from embedded state", () => {
  const source = makeOrderingSource({
    url: "https://www.grubhub.com/restaurant/example/123",
    discoveredFrom: "google_maps",
  });
  const result = extractProviderMenuFromJson([
    {
      url: "https://www.grubhub.com/api/restaurant",
      status: 200,
      contentType: "application/json",
      data: {
        restaurant: {
          cuisines: [{ name: "Sushi" }, { name: "Japanese" }],
          categories: [{ name: "Best Sellers" }],
        },
      },
    },
  ], source, "grubhub");

  assert.deepEqual(result.restaurantTags, ["Sushi", "Japanese"]);
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
    result.items.map((item) => [item.name, item.price, item.section, item.featured ?? false]),
    [
      ["Spicy Deluxe Sandwich", 10.25, "Entrées", true],
      ["Regular Sandwich", 8.45, "Entrées", false],
    ],
  );
});

test("recovers a Grubhub product name when only its price is a heading", () => {
  const source = makeOrderingSource({
    url: "https://www.grubhub.com/restaurant/luna-grill/123",
    discoveredFrom: "google_maps",
  });
  const result = extractProviderMenuFromHtml(`
    <main>
      <h2>Best Sellers</h2>
      <article>
        <a href="/menu-item/modern-greek-combo">
          <div><span>Modern Greek Combo</span><p>Chicken, rice, pita, and salad.</p></div>
          <div><span role="heading" aria-level="4">$17.49+</span></div>
        </a>
      </article>
      <article>
        <a href="/menu-item/chicken-kabob-plate">
          <div><span>Chicken Kabob Plate</span><p>Two skewers with rice and salad.</p></div>
          <div><span role="heading" aria-level="4">$20.69+</span></div>
        </a>
      </article>
      <article>
        <a href="/menu-item/gyro-plate">
          <div><span>Gyro Plate</span><p>Gyro, rice, pita, and salad.</p></div>
          <div><span role="heading" aria-level="4">$21.89+</span></div>
        </a>
      </article>
    </main>
  `, source, "grubhub");

  assert.deepEqual(
    result.items.map((item) => [item.name, item.price, item.section]),
    [
      ["Modern Greek Combo", 17.49, "Best Sellers"],
      ["Chicken Kabob Plate", 20.69, "Best Sellers"],
      ["Gyro Plate", 21.89, "Best Sellers"],
    ],
  );
});

test("drops price-only Grubhub products when no real name can be recovered", () => {
  const source = makeOrderingSource({
    url: "https://www.grubhub.com/restaurant/example/123",
    discoveredFrom: "google_maps",
  });
  const result = extractProviderMenuFromHtml(`
    <main>
      <h2>Best Sellers</h2>
      <div><span role="heading" aria-level="4">$17.49+</span></div>
    </main>
  `, source, "grubhub");

  assert.deepEqual(result.items, []);
});

test("keeps all Grubhub JSON menu sections while prioritizing Best Sellers", () => {
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
    result.items.map((item) => [item.name, item.price, item.section, item.featured ?? false]),
    [
      ["Chicken Sandwich", 8.45, "Best Sellers", true],
      ["Spicy Deluxe Sandwich", 10.25, "Best Sellers", true],
      ["Waffle Fries", 4.49, "Sides", false],
    ],
  );
});

test("extracts Grubhub entrees when the restaurant has no Best Sellers", () => {
  const source = makeOrderingSource({
    url: "https://www.grubhub.com/restaurant/no-featured-section/456",
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
            name: "Entrées",
            items: [
              { name: "Chicken Curry", displayPrice: "$16.49" },
              { name: "Katsu Curry", displayPrice: "$18.29" },
              { name: "Beef Curry", displayPrice: "$19.49" },
            ],
          },
          {
            name: "Beverages",
            items: [{ name: "Iced Tea", displayPrice: "$3.49" }],
          },
        ],
      },
    },
  ], source, "grubhub");

  assert.deepEqual(
    result.items.map((item) => [item.name, item.section]),
    [
      ["Chicken Curry", "Entrées"],
      ["Katsu Curry", "Entrées"],
      ["Beef Curry", "Entrées"],
      ["Iced Tea", "Beverages"],
    ],
  );
});

test("deduplicates featured products into their real Grubhub section", () => {
  const source = makeOrderingSource({
    url: "https://www.grubhub.com/restaurant/duplicate-menu/789",
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
            items: [{ name: "Chicken Sandwich", displayPrice: "$8.45" }],
          },
          {
            name: "Sandwiches",
            items: [{ name: "Chicken Sandwich", displayPrice: "$8.45" }],
          },
        ],
      },
    },
  ], source, "grubhub");

  assert.deepEqual(
    result.items.map((item) => [item.name, item.section, item.featured]),
    [["Chicken Sandwich", "Sandwiches", true]],
  );
});
