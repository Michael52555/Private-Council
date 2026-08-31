import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeRestaurantCandidatePools,
  preferenceSearchResultTarget,
  roundRobinRestaurantPools,
} from "@/lib/restaurant-candidate-pool";

type Candidate = { id: string; source: string };

function pool(prefix: string, count: number, source = prefix): Candidate[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    source,
  }));
}

test("reserves fifty nearest and fifty preference candidates", () => {
  const merged = mergeRestaurantCandidatePools({
    nearest: pool("near", 60),
    preferred: pool("preferred", 60),
    general: pool("general", 60),
  });

  assert.equal(merged.length, 100);
  assert.deepEqual(
    merged.slice(0, 50).map((candidate) => candidate.id),
    pool("near", 50).map((candidate) => candidate.id),
  );
  assert.deepEqual(
    merged.slice(50).map((candidate) => candidate.id),
    pool("preferred", 50).map((candidate) => candidate.id),
  );
});

test("scans past overlap to preserve the preference quota", () => {
  const nearest = pool("near", 60);
  const preferred = [
    ...nearest.slice(0, 30),
    ...pool("preferred", 60),
  ];
  const merged = mergeRestaurantCandidatePools({
    nearest,
    preferred,
    general: [],
  });

  assert.equal(
    merged.filter((candidate) => candidate.id.startsWith("preferred-")).length,
    50,
  );
  assert.equal(new Set(merged.map((candidate) => candidate.id)).size, 100);
});

test("fills a missing preference pool with more nearby and broad choices", () => {
  const merged = mergeRestaurantCandidatePools({
    nearest: pool("near", 60),
    preferred: [],
    general: [
      ...pool("near", 10),
      ...pool("general", 50),
    ],
  });

  assert.equal(merged.length, 100);
  assert.deepEqual(
    merged.slice(0, 60).map((candidate) => candidate.id),
    pool("near", 60).map((candidate) => candidate.id),
  );
  assert.deepEqual(
    merged.slice(60).map((candidate) => candidate.id),
    pool("general", 40).map((candidate) => candidate.id),
  );
});

test("interleaves preference searches so every selected label gets early slots", () => {
  const merged = roundRobinRestaurantPools([
    pool("chinese", 3),
    pool("korean", 2),
    pool("seafood", 1),
  ]);

  assert.deepEqual(
    merged.map((candidate) => candidate.id),
    [
      "chinese-1",
      "korean-1",
      "seafood-1",
      "chinese-2",
      "korean-2",
      "chinese-3",
    ],
  );
});

test("overfetches preference searches to survive overlap with nearest results", () => {
  assert.equal(preferenceSearchResultTarget(0), 0);
  assert.equal(preferenceSearchResultTarget(1), 60);
  assert.equal(preferenceSearchResultTarget(2), 38);
  assert.equal(preferenceSearchResultTarget(3), 25);
  assert.equal(preferenceSearchResultTarget(4), 20);
  assert.equal(preferenceSearchResultTarget(20), 20);
});
