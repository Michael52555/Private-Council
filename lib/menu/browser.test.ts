import assert from "node:assert/strict";
import test from "node:test";
import {
  scoreGoogleOrderControlLabel,
  selectFirstSupportedOrderingLink,
  selectGoogleOrderingLinkCandidates,
} from "@/lib/menu/browser";

test("recognizes the Chinese online-order control but rejects sponsored order ads", () => {
  assert.equal(scoreGoogleOrderControlLabel("在线订餐"), 100);
  assert.equal(scoreGoogleOrderControlLabel("立即订餐 · 广告主: GrubHub, Inc."), -1);
});

test("skips an unsupported first provider and selects the next registered adapter", () => {
  const selected = selectFirstSupportedOrderingLink([
    { href: "https://pressed.com/order", text: "Pressed" },
    { href: "https://www.doordash.com/store/pressed-123", text: "DoorDash" },
    { href: "https://www.grubhub.com/restaurant/pressed-123", text: "Grubhub" },
  ]);

  assert.equal(selected?.href, "https://www.doordash.com/store/pressed-123");
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
