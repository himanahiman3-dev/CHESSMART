import assert from "node:assert/strict";
import { getRushTargetRating, selectRushPuzzle } from "../src/lib/puzzleRush.ts";

assert.equal(getRushTargetRating(0), 1000);
assert.equal(getRushTargetRating(1), 1000);
assert.equal(getRushTargetRating(2), 1100);
assert.equal(getRushTargetRating(10), 1500);
assert.equal(getRushTargetRating(100), 2400);
assert.equal(getRushTargetRating(-5), 1000);

const bank = [
  { id: "easy", rating: 800 },
  { id: "starter", rating: 1000 },
  { id: "mid", rating: 1150 },
  { id: "upper", rating: 1290 },
  { id: "hard", rating: 1800 },
  { id: "expert", rating: 2400 },
];

const first = selectRushPuzzle(bank, 0, [], () => 0);
assert.equal(first?.id, "starter", "The opening Rush pool should be near 1000 Elo.");

const next = selectRushPuzzle(bank, 4, ["starter", "mid"], () => 0);
assert.ok(next);
assert.ok(!["starter", "mid"].includes(next.id), "A played puzzle must not repeat.");
assert.ok(Math.abs(next.rating - getRushTargetRating(4)) <= 300);

const later = selectRushPuzzle(bank, 10, [], () => 0);
assert.equal(later?.id, "hard", "Higher scores should select from a stronger pool when available.");

const fallback = selectRushPuzzle([{ id: "far", rating: 3200 }], 0, [], () => 0);
assert.equal(fallback?.id, "far", "The selector should still choose a puzzle when the target band is empty.");

const exhausted = selectRushPuzzle(bank, 0, bank.map((item) => item.id));
assert.equal(exhausted, null, "A run must not repeat any puzzle after the available bank is exhausted.");

console.log("Puzzle Rush: rising difficulty target, played-puzzle exclusion and empty-pool fallback passed.");
