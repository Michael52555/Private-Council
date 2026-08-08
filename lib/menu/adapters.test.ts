import assert from "node:assert/strict";
import test from "node:test";
import {
  MAJOR_PROVIDER_ADAPTER_IDS,
  majorProviderAdapterForControlLabel,
  majorProviderAdapterForUrl,
  menuAdapterForControlLabel,
  menuAdapterForUrl,
} from "@/lib/menu/adapters";

test("matches major platform and chain ordering adapters", () => {
  assert.equal(
    menuAdapterForUrl("https://www.doordash.com/store/example")?.id,
    "doordash",
  );
  assert.equal(
    menuAdapterForUrl("https://order.habitburger.com/menu/example")?.id,
    "habit_burger",
  );
  assert.equal(
    menuAdapterForControlLabel("Order with Toast")?.id,
    "toast",
  );
  assert.equal(
    menuAdapterForUrl("https://order.chick-fil-a.com/location/example")?.id,
    "chick_fil_a",
  );
  assert.equal(
    menuAdapterForControlLabel("chick-fil-a.com Merchant website")?.id,
    "chick_fil_a",
  );
});

test("leaves unsupported first-party providers out of the adapter registry", () => {
  assert.equal(menuAdapterForUrl("https://pressed.com/order"), undefined);
  assert.equal(menuAdapterForControlLabel("pressed.com Merchant website"), undefined);
});

test("uses an explicit major-provider allowlist for unified discovery", () => {
  assert.deepEqual(MAJOR_PROVIDER_ADAPTER_IDS, [
    "doordash",
    "ubereats",
    "grubhub",
    "toast",
    "olo",
    "chownow",
    "square",
    "clover",
  ]);
  assert.equal(
    majorProviderAdapterForUrl("https://www.doordash.com/store/example")?.id,
    "doordash",
  );
  assert.equal(
    majorProviderAdapterForControlLabel("Order with Toast")?.id,
    "toast",
  );
  assert.equal(
    majorProviderAdapterForUrl("https://order.chick-fil-a.com/load-dot-com"),
    undefined,
  );
  assert.equal(
    majorProviderAdapterForControlLabel("chick-fil-a.com Merchant website"),
    undefined,
  );
});
