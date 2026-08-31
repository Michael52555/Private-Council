import assert from "node:assert/strict";
import test from "node:test";
import { mergeRestaurantCandidatePools } from "@/lib/restaurant-candidate-pool";

type Candidate = { id: string; source: string };

function pool(prefix: string, count: number, source = prefix): Candidate[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    source,
  }));
}

test("reserves twelve nearest and twelve preference candidates", () => {
  const merged = mergeRestaurantCandidatePools({
    nearest: pool("near", 20),
    preferred: pool("preferred", 20),
    general: pool("general", 20),
  });

  assert.equal(merged.length, 24);
  assert.deepEqual(
    merged.slice(0, 12).map((candidate) => candidate.id),
    pool("near", 12).map((candidate) => candidate.id),
  );
  assert.deepEqual(
    merged.slice(12).map((candidate) => candidate.id),
    pool("preferred", 12).map((candidate) => candidate.id),
  );
});

test("scans past overlap to preserve the preference quota", () => {
  const nearest = pool("near", 20);
  const preferred = [
    ...nearest.slice(0, 10),
    ...pool("preferred", 14),
  ];
  const merged = mergeRestaurantCandidatePools({
    nearest,
    preferred,
    general: [],
  });

  assert.equal(
    merged.filter((candidate) => candidate.id.startsWith("preferred-")).length,
    12,
  );
  assert.equal(new Set(merged.map((candidate) => candidate.id)).size, 24);
});

test("fills a missing preference pool with more nearby and broad choices", () => {
  const merged = mergeRestaurantCandidatePools({
    nearest: pool("near", 20),
    preferred: [],
    general: [
      ...pool("near", 5),
      ...pool("general", 10),
    ],
  });

  assert.equal(merged.length, 24);
  assert.deepEqual(
    merged.slice(0, 20).map((candidate) => candidate.id),
    pool("near", 20).map((candidate) => candidate.id),
  );
  assert.deepEqual(
    merged.slice(20).map((candidate) => candidate.id),
    pool("general", 4).map((candidate) => candidate.id),
  );
});
