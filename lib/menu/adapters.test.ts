import assert from "node:assert/strict";
import test from "node:test";
import {
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
});

test("leaves unsupported first-party providers out of the adapter registry", () => {
  assert.equal(menuAdapterForUrl("https://pressed.com/order"), undefined);
  assert.equal(menuAdapterForControlLabel("pressed.com Merchant website"), undefined);
});
