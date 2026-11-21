import assert from "node:assert/strict";
import {
  classifyMove,
  classifyOrdinaryMove,
  qualifiesAsGreat,
  qualifiesAsMiss,
} from "../src/lib/moveClassification.ts";

const ordinaryCases = [
  [0, "excellent"],
  [1.999, "excellent"],
  [2, "good"],
  [4.999, "good"],
  [5, "inaccuracy"],
  [9.999, "inaccuracy"],
  [10, "mistake"],
  [19.999, "mistake"],
  [20, "blunder"],
  [45, "blunder"],
];
for (const [loss, expected] of ordinaryCases) {
  assert.equal(classifyOrdinaryMove(loss), expected, `loss=${loss}`);
}

const base = {
  forced: false,
  book: false,
  brilliant: false,
  playedIsBest: false,
  winLoss: 0,
  winBefore: 50,
  winAfter: 50,
  secondLinePresent: true,
  secondLineGap: 0,
  legalMoves: 20,
  previousOpponentLoss: 0,
  missedMateInOne: false,
  lostForcedMate: false,
  allowedMate: false,
  elo: 1200,
};

assert.equal(classifyMove({ ...base, playedIsBest: true }), "best");
assert.equal(classifyMove({ ...base, forced: true, book: true }), "forced",
  "Forced has priority over Book.");
assert.equal(classifyMove({ ...base, book: true, brilliant: true }), "book",
  "Opening-book prefix remains a separate label.");
assert.equal(classifyMove({ ...base, brilliant: true }), "brilliant");
assert.equal(classifyMove({ ...base, brilliant: true, allowedMate: true }), "blunder",
  "Allowing a forced mate always overrides a candidate Brilliant label.");


assert.equal(qualifiesAsGreat({
  playedIsBest: true, winBefore: 70, secondLinePresent: true,
  secondLineGap: 8, legalMoves: 22, elo: 1800,
}), true, "Crossing from winning to equal can be Great even below the general gap cutoff.");
assert.equal(qualifiesAsGreat({
  playedIsBest: true, winBefore: 80, secondLinePresent: true,
  secondLineGap: 12, legalMoves: 22, elo: 700,
}), true, "The same gap is more generous for a beginner.");
assert.equal(qualifiesAsGreat({
  playedIsBest: true, winBefore: 80, secondLinePresent: true,
  secondLineGap: 12, legalMoves: 22, elo: 1800,
}), false, "A 12-point same-band gap is below the stronger-player Great threshold.");
assert.equal(qualifiesAsGreat({
  playedIsBest: false, winBefore: 80, secondLinePresent: true,
  secondLineGap: 30, legalMoves: 22, elo: 700,
}), false, "Great requires the played move to be the top engine choice.");
assert.equal(qualifiesAsGreat({
  playedIsBest: true, winBefore: 80, secondLinePresent: false,
  secondLineGap: 30, legalMoves: 22, elo: 700,
}), false, "Great needs an alternative line to establish criticality.");

assert.equal(qualifiesAsMiss({
  missedMateInOne: false, lostForcedMate: false, allowedMate: false,
  previousOpponentLoss: 12, winBefore: 75, winAfter: 55,
}), true, "Returning a winning chance immediately after an opponent mistake is a Miss.");
assert.equal(qualifiesAsMiss({
  missedMateInOne: false, lostForcedMate: false, allowedMate: false,
  previousOpponentLoss: 12, winBefore: 64.9, winAfter: 40,
}), false, "A position below the winning band is not a missed winning chance.");
assert.equal(qualifiesAsMiss({
  missedMateInOne: false, lostForcedMate: false, allowedMate: false,
  previousOpponentLoss: 9.99, winBefore: 80, winAfter: 50,
}), false, "A small previous loss is not treated as a major opponent error.");
assert.equal(qualifiesAsMiss({
  missedMateInOne: false, lostForcedMate: false, allowedMate: false,
  previousOpponentLoss: 15, winBefore: 80, winAfter: 55.01,
}), false, "The resulting position must be equal or worse.");
assert.equal(qualifiesAsMiss({
  missedMateInOne: true, lostForcedMate: false, allowedMate: false,
  previousOpponentLoss: 0, winBefore: 100, winAfter: 100,
}), true, "Skipping mate in one is a Miss even when the EP loss is almost invisible.");
assert.equal(qualifiesAsMiss({
  missedMateInOne: false, lostForcedMate: true, allowedMate: false,
  previousOpponentLoss: 0, winBefore: 100, winAfter: 88,
}), true, "Losing a forced mate while retaining a winning position is still a Miss.");
assert.equal(qualifiesAsMiss({
  missedMateInOne: true, lostForcedMate: true, allowedMate: true,
  previousOpponentLoss: 15, winBefore: 90, winAfter: 0,
}), false, "Allowing the opponent a forced mate is a Blunder, not a Miss.");

assert.equal(classifyMove({
  ...base,
  previousOpponentLoss: 15,
  winBefore: 80,
  winAfter: 50,
  winLoss: 30,
}), "miss", "Miss must take priority over a numeric Blunder when a winning chance is immediately returned.");
assert.equal(classifyMove({
  ...base,
  missedMateInOne: true,
  winBefore: 100,
  winAfter: 100,
}), "miss");
assert.equal(classifyMove({
  ...base,
  allowedMate: true,
  winLoss: 0,
}), "blunder");

console.log("All move-classification tests passed: Best, Excellent, Good, Inaccuracy, Mistake, Blunder, Great, Miss, Book, Forced and Brilliant.");
