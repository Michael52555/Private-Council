import assert from "node:assert/strict";
import test from "node:test";
import {
  isDeliveryOrderingModeLabel,
  providerStartUrl,
  scoreGoogleOrderControlLabel,
  selectFirstSupportedOrderingLink,
  selectGoogleOrderingLinkCandidates,
  selectSupportedOrderingLinks,
} from "@/lib/menu/browser";

test("recognizes English and Chinese delivery mode labels", () => {
  assert.equal(isDeliveryOrderingModeLabel("Delivery"), true);
  assert.equal(isDeliveryOrderingModeLabel("外送"), true);
  assert.equal(isDeliveryOrderingModeLabel("外卖"), true);
  assert.equal(isDeliveryOrderingModeLabel("× 自取"), false);
  assert.equal(isDeliveryOrderingModeLabel("Pickup"), false);
});

test("starts Panda location discovery on the restaurant city page", () => {
  assert.equal(
    providerStartUrl("https://www.pandaexpress.com/locations", {
      adapterId: "panda_express",
      restaurantAddress: "2190 Barranca Pkwy, Irvine, CA 92606, USA",
    }),
    "https://www.pandaexpress.com/locations/ca/irvine/",
  );
  assert.equal(
    providerStartUrl("https://www.pandaexpress.com/location", {
      adapterId: "panda_express",
      restaurantAddress: "2190 Barranca Pkwy, Irvine, CA 92606, USA",
    }),
    "https://www.pandaexpress.com/locations/ca/irvine/",
  );
});

test("recognizes the Chinese online-order control but rejects sponsored order ads", () => {
  assert.equal(scoreGoogleOrderControlLabel("在线订餐"), 100);
  assert.equal(scoreGoogleOrderControlLabel("立即订餐 · 广告主: GrubHub, Inc."), -1);
});

test("skips non-Grubhub providers and selects Grubhub", () => {
  const selected = selectFirstSupportedOrderingLink([
    { href: "https://pressed.com/order", text: "Pressed" },
    { href: "https://www.doordash.com/store/pressed-123", text: "DoorDash" },
    { href: "https://www.grubhub.com/restaurant/pressed-123", text: "Grubhub" },
  ]);

  assert.equal(selected?.href, "https://www.grubhub.com/restaurant/pressed-123");
});

test("selects only the first Grubhub link when Google exposes variants", () => {
  const selected = selectFirstSupportedOrderingLink([
    { href: "https://www.grubhub.com/restaurant/subway-delivery", text: "Grubhub delivery" },
    { href: "https://www.grubhub.com/restaurant/subway-pickup", text: "Grubhub pickup" },
  ]);

  assert.equal(selected?.href, "https://www.grubhub.com/restaurant/subway-delivery");
});

test("keeps only Grubhub ordering links", () => {
  const selected = selectSupportedOrderingLinks([
    { href: "https://pressed.com/order", text: "Pressed" },
    { href: "https://www.pandaexpress.com/location", text: "Panda pickup" },
    { href: "https://www.doordash.com/store/panda-123", text: "DoorDash delivery" },
    { href: "https://www.grubhub.com/restaurant/panda-123", text: "Grubhub delivery" },
  ]);

  assert.deepEqual(selected.map((candidate) => candidate.text), [
    "Grubhub delivery",
  ]);
});

test("skips a chain website and other delivery platforms for Grubhub", () => {
  const selected = selectSupportedOrderingLinks([
    {
      href: "https://order.chick-fil-a.com/load-dot-com?locationNumber=03260",
      text: "Chick-fil-A pickup",
    },
    {
      href: "https://www.doordash.com/store/chick-fil-a-123",
      text: "DoorDash delivery",
    },
    {
      href: "https://www.ubereats.com/store/chick-fil-a/example",
      text: "Uber Eats delivery",
    },
    {
      href: "https://www.grubhub.com/restaurant/chick-fil-a-123",
      text: "Grubhub delivery",
    },
  ]);

  assert.deepEqual(selected.map((candidate) => candidate.text), [
    "Grubhub delivery",
  ]);
  assert.equal(
    selectFirstSupportedOrderingLink(selected)?.text,
    "Grubhub delivery",
  );
});

test("keeps custom provider links when they are scoped to the Google ordering dialog", () => {
  const links = selectGoogleOrderingLinkCandidates(
    [
      { href: "https://order.example-restaurant.com/store/123", text: "Order pickup" },
      { href: "https://policies.google.com/privacy", text: "Privacy" },
      {
        href: "https://www.grubhub.com/restaurant/sponsored",
        text: "Sponsored · Claim $10 off your first order",
      },
    ],
    { withinDialog: true },
  );

  assert.deepEqual(links, [
    { href: "https://order.example-restaurant.com/store/123", text: "Order pickup" },
  ]);
});

test("outside a dialog only keeps newly exposed links with ordering evidence", () => {
  const baselineHrefs = new Set(["https://restaurant.example/"]);
  const links = selectGoogleOrderingLinkCandidates(
    [
      { href: "https://restaurant.example/", text: "Restaurant website" },
      { href: "https://unrelated.example/", text: "Nearby business" },
      { href: "https://www.doordash.com/store/example-123", text: "DoorDash" },
      { href: "https://order.custom.example/location/123", text: "Order online" },
    ],
    { baselineHrefs, withinDialog: false },
  );

  assert.deepEqual(
    links.map((link) => link.href),
    [
      "https://www.doordash.com/store/example-123",
      "https://order.custom.example/location/123",
    ],
  );
});

test("unwraps Google redirect links before provider selection", () => {
  const target = "https://order.toasttab.com/online/example";
  const links = selectGoogleOrderingLinkCandidates(
    [
      {
        href: `https://www.google.com/url?url=${encodeURIComponent(target)}`,
        text: "Order with Toast",
      },
    ],
    { withinDialog: true },
  );

  assert.equal(links[0]?.href, target);
});

test("rejects Google short links and anti-bot infrastructure as ordering providers", () => {
  const links = selectGoogleOrderingLinkCandidates(
    [
      { href: "https://goo.gle/maps-help", text: "Google Maps help" },
      {
        href: "https://geo.captcha-delivery.com/captcha/?initialCid=example",
        text: "Document navigation",
      },
      {
        href: "https://i.liadm.com/pixel?redirect=example",
        text: "Tracking navigation",
      },
      { href: "https://www.pandaexpress.com/location/123", text: "Panda Express" },
    ],
    { withinDialog: true },
  );

  assert.deepEqual(links, [
    { href: "https://www.pandaexpress.com/location/123", text: "Panda Express" },
  ]);
});
