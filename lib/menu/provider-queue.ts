import type { OrderingProvider } from "@/lib/menu/types";

type ProviderQueueGlobal = typeof globalThis & {
  restaurantProviderQueue?: {
    tails: Map<string, Promise<void>>;
    lastFinishedAt: Map<string, number>;
  };
};

function queueState(): NonNullable<ProviderQueueGlobal["restaurantProviderQueue"]> {
  const queueGlobal = globalThis as ProviderQueueGlobal;
  queueGlobal.restaurantProviderQueue ??= {
    tails: new Map(),
    lastFinishedAt: new Map(),
  };
  return queueGlobal.restaurantProviderQueue;
}

function wait(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const providerCooldownMs: Partial<Record<OrderingProvider, number>> = {
  // Grubhub begins returning HTTP 429 when several browser-backed restaurant
  // extractions start together. Central-model work is therefore serialized
  // and briefly spaced even when several clients request it concurrently.
  grubhub: 2_500,
  // DoorDash also serves dynamic, browser-backed menus and can throttle bursts
  // independently of Grubhub. Keep a separate provider queue so the two
  // integrations can proceed concurrently without hammering either platform.
  doordash: 2_500,
};

export async function runProviderQueued<T>(
  provider: OrderingProvider,
  task: () => Promise<T>,
  options: { cooldownMs?: number } = {},
): Promise<T> {
  const state = queueState();
  const previousTail = state.tails.get(provider) ?? Promise.resolve();
  let releaseCurrent: (() => void) | undefined;
  const currentSlot = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const currentTail = previousTail
    .catch(() => undefined)
    .then(() => currentSlot);
  state.tails.set(provider, currentTail);

  await previousTail.catch(() => undefined);
  const cooldownMs = options.cooldownMs ?? providerCooldownMs[provider] ?? 0;
  const lastFinishedAt = state.lastFinishedAt.get(provider) ?? 0;
  await wait(Math.max(0, cooldownMs - (Date.now() - lastFinishedAt)));

  try {
    return await task();
  } finally {
    state.lastFinishedAt.set(provider, Date.now());
    releaseCurrent?.();
    if (state.tails.get(provider) === currentTail) {
      state.tails.delete(provider);
    }
  }
}
