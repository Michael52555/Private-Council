import assert from "node:assert/strict";
import test from "node:test";
import { runProviderQueued } from "@/lib/menu/provider-queue";

test("serializes concurrent work for the same provider", async () => {
  let activeTasks = 0;
  let maximumActiveTasks = 0;
  const executionOrder: string[] = [];
  const task = (name: string) => runProviderQueued("grubhub", async () => {
    activeTasks += 1;
    maximumActiveTasks = Math.max(maximumActiveTasks, activeTasks);
    executionOrder.push(`start:${name}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    executionOrder.push(`finish:${name}`);
    activeTasks -= 1;
    return name;
  }, { cooldownMs: 0 });

  assert.deepEqual(await Promise.all([task("first"), task("second"), task("third")]), [
    "first",
    "second",
    "third",
  ]);
  assert.equal(maximumActiveTasks, 1);
  assert.deepEqual(executionOrder, [
    "start:first",
    "finish:first",
    "start:second",
    "finish:second",
    "start:third",
    "finish:third",
  ]);
});

test("does not serialize unrelated providers behind Grubhub", async () => {
  let releaseGrubhub: (() => void) | undefined;
  const grubhubGate = new Promise<void>((resolve) => {
    releaseGrubhub = resolve;
  });
  const grubhub = runProviderQueued("grubhub", () => grubhubGate, {
    cooldownMs: 0,
  });
  let toastCompleted = false;
  await runProviderQueued("toast", async () => {
    toastCompleted = true;
  }, { cooldownMs: 0 });

  assert.equal(toastCompleted, true);
  releaseGrubhub?.();
  await grubhub;
});
