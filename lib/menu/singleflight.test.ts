import assert from "node:assert/strict";
import test from "node:test";
import { runSingleFlight } from "@/lib/menu/singleflight";

test("coalesces concurrent central-model work for the same restaurant", async () => {
  let executionCount = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const task = async () => {
    executionCount += 1;
    await gate;
    return "menu";
  };

  const first = runSingleFlight("menu:place-1", task);
  const second = runSingleFlight("menu:place-1", task);
  release?.();

  assert.deepEqual(await Promise.all([first, second]), ["menu", "menu"]);
  assert.equal(executionCount, 1);
});

test("does not coalesce work for different restaurants", async () => {
  let executionCount = 0;
  const task = async () => {
    executionCount += 1;
    return "menu";
  };

  await Promise.all([
    runSingleFlight("menu:place-a", task),
    runSingleFlight("menu:place-b", task),
  ]);
  assert.equal(executionCount, 2);
});

