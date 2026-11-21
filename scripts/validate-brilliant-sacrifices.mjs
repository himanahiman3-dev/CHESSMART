import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { detectSacrifice } from "../src/lib/see.ts";
import { qualifiesAsBrilliant } from "../src/lib/brilliant.ts";
import { isSacrificeVerificationCandidate } from "../src/lib/criticalPositionRanking.ts";
import { findPersistentSacrificeContinuation } from "../src/lib/persistentSacrifice.ts";

const pgn = `[Event "Paris Opera"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[Round "?"]
[White "Paul Morphy"]
[Black "Duke of Brunswick & Count Isouard"]
[Result "1-0"]
[WhiteElo "2690"]
[BlackElo "2100"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5
6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5
11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6
15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

const game = new Chess();
game.loadPgn(pgn);
const history = game.history({ verbose: true });
const replay = new Chess();

const targets = new Map([
  ["Nxb5:w", "10.Nxb5"],
  ["Rxd7:w", "13.Rxd7"],
  ["Qb8+:w", "16.Qb8+"],
]);
const found = new Set();

for (const move of history) {
  const before = replay.fen();
  const played = replay.move(move.san);
  assert.ok(played, `Could not replay ${move.san}`);
  const targetKey = `${move.san}:${move.color}`;
  if (!targets.has(targetKey)) continue;

  const uci = move.from + move.to + (move.promotion ?? "");
  const sacrifice = detectSacrifice(before, uci, 2690);
  assert.equal(
    sacrifice.sacrifice,
    true,
    `${targets.get(targetKey)} must be detected as a sound piece/exchange sacrifice; got ${JSON.stringify(sacrifice)}`,
  );
  found.add(targetKey);
}

for (const [key, label] of targets) {
  assert.ok(found.has(key), `The sample game is missing target move ${label}`);
}

// The shared Brilliant rule must accept a strong sacrifice that is nearly best,
// leaves a sound position, and was not played from an already completely won position.
for (const label of targets.values()) {
  assert.equal(
    qualifiesAsBrilliant({
      sacrifice: true,
      legalMoves: 24,
      alternativeWin: 90,
      lostMate: false,
      allowedMate: false,
      winLoss: 1.2,
      winAfter: 78,
      elo: 2690,
    }),
    true,
    `${label} should pass the common Brilliant criteria`,
  );
}

assert.equal(qualifiesAsBrilliant({
  sacrifice: true, legalMoves: 24, alternativeWin: 97,
  lostMate: false, allowedMate: false, winLoss: 1, winAfter: 80, elo: 2690,
}), false, "Already completely winning alternatives must not be Brilliant");

assert.equal(qualifiesAsBrilliant({
  sacrifice: true, legalMoves: 24, alternativeWin: 90,
  lostMate: false, allowedMate: false, winLoss: 4, winAfter: 80, elo: 2690,
}), false, "A move that is not nearly best must not be Brilliant");

assert.equal(qualifiesAsBrilliant({
  sacrifice: true, legalMoves: 24, alternativeWin: 90,
  lostMate: false, allowedMate: false, winLoss: 1, winAfter: 35, elo: 2690,
}), false, "A sacrifice that leaves a bad position must not be Brilliant");


const userGamePgn = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.11.21"]
[Round "?"]
[White "NOBODYCHESS9"]
[Black "leothegodofkilll"]
[Result "1-0"]
[TimeControl "180"]
[WhiteElo "378"]
[BlackElo "375"]

1. e4 c5 2. f4 d6 3. Nf3 Nc6 4. Nc3 Be6 5. b3 Nf6 6. e5 dxe5
7. fxe5 Nd7 8. Bb5 Ncxe5 9. Bxd7+ Qxd7 10. Nxe5 Qd4 11. Nf3 Qf6
12. d3 O-O-O 13. Bg5 Qg6 14. Qe2 c4 15. dxc4 f6 16. Be3 a6
17. Bd2 Qh6 18. Bxh6 gxh6 19. O-O Bg4 20. h3 Bh5 21. Qe6+ Rd7
22. Rad1 Rg8 23. Qxd7+ Kb8 24. Qd8+ Ka7 25. Nb5+ axb5
26. Qa5+ Kb8 27. Rd8# 1-0`;

const userGame = new Chess();
userGame.loadPgn(userGamePgn);
const userMoves = userGame.history({ verbose: true });
const userReplay = new Chess();
let knightSacrificeBefore = "";
let knightSacrificeUci = "";
let knightSacrificeLegalMoves = 0;
for (const move of userMoves) {
  const before = userReplay.fen();
  userReplay.move(move.san);
  if (move.san === "Nb5+") {
    knightSacrificeBefore = before;
    knightSacrificeUci = move.from + move.to + (move.promotion ?? "");
    knightSacrificeLegalMoves = new Chess(before).moves().length;
  }
}
assert.ok(knightSacrificeBefore, "The supplied Chess.com game must contain 25.Nb5+.");
const knightSacrificeInfo = detectSacrifice(knightSacrificeBefore, knightSacrificeUci, 378);
assert.equal(
  knightSacrificeInfo.sacrifice,
  true,
  `25.Nb5+ must be recognized as a knight sacrifice; got ${JSON.stringify(knightSacrificeInfo)}`,
);

// Simulate a fast first pass: the move is the top engine line and loses 0
// expected points. It must still enter the deeper sacrifice-verification queue.
assert.equal(
  isSacrificeVerificationCandidate(knightSacrificeInfo.sacrifice, knightSacrificeLegalMoves, true, 0),
  true,
  "25.Nb5+ must be queued for deeper verification even when first-pass loss is zero.",
);
assert.equal(
  isSacrificeVerificationCandidate(true, 1, true, 0),
  false,
  "A move with exactly one legal alternative state must not be called a sacrifice candidate.",
);
assert.equal(
  isSacrificeVerificationCandidate(true, 20, false, 4),
  false,
  "A non-best sacrifice outside the near-best loss threshold must not be queued.",
);

// Rating-aware leniency: a sound sacrifice by a 378-Elo player may qualify at
// a wider alternative-line threshold than the same move for a titled player.
assert.equal(qualifiesAsBrilliant({
  sacrifice: true, legalMoves: 24, alternativeWin: 97.5,
  lostMate: false, allowedMate: false, winLoss: 1, winAfter: 55, elo: 378,
}), true, "Beginner rating should retain Chess.com's more generous Brilliant treatment.");

// A short mating line does not waive the requirement that the alternative
// position must not already be completely winning.
assert.equal(qualifiesAsBrilliant({
  sacrifice: true,
  legalMoves: knightSacrificeLegalMoves,
  alternativeWin: 99.9,
  lostMate: false,
  allowedMate: false,
  winLoss: 0,
  winAfter: 100,
  elo: 378,
  matingSacrifice: true,
}), true, "A verified short mating sacrifice may qualify even when a quiet line also wins.");

assert.equal(qualifiesAsBrilliant({
  sacrifice: true,
  legalMoves: knightSacrificeLegalMoves,
  alternativeWin: 99.9,
  lostMate: false,
  allowedMate: false,
  winLoss: 0,
  winAfter: 35,
  elo: 378,
  matingSacrifice: true,
}), false, "The short-mate exception must not accept a sacrifice that leaves a bad position.");

assert.equal(qualifiesAsBrilliant({
  sacrifice: true,
  legalMoves: knightSacrificeLegalMoves,
  alternativeWin: 99.9,
  lostMate: true,
  allowedMate: false,
  winLoss: 0,
  winAfter: 100,
  elo: 378,
  matingSacrifice: true,
}), false, "The short-mate exception must not override a lost forced mate.");

assert.equal(qualifiesAsBrilliant({
  sacrifice: true,
  legalMoves: 24,
  alternativeWin: 99.9,
  lostMate: false,
  allowedMate: false,
  winLoss: 1,
  winAfter: 75,
  elo: 524,
  continuation: true,
}), true, "A verified persistent sacrifice continuation may bypass the unrelated quiet-line cutoff.");


const coachGamePgn = `[Event "Play vs Coach"]
[Site "Chess.com"]
[Date "2026.11.21"]
[Round "?"]
[White "NOBODYCHESS9"]
[Black "Coach-Mittens"]
[Result "1-0"]
[TimeControl "-"]
[WhiteElo "524"]
[BlackElo "3200"]
[Termination "NOBODYCHESS9 поставил мат"]
[ECO "C00"]
[EndDate "2026.11.21"]
[Link "https://www.chess.com/game/coach/363695780?move=0"]

1. d4 e6 2. e4 b6 3. Nf3 Bb7 4. Bd3 Nf6 5. e5 Ne4 6. Qe2 f5
7. Nbd2 Nxd2 8. Bxd2 Be7 9. Rg1 O-O 10. O-O-O Qe8 11. Ng5 h6
12. Nh3 g5 13. Nf4 Nc6 14. c3 Nd8 15. g4 Kh8 16. d5 gxf4
17. Bxf4 Bxd5 18. Bxh6 f4 19. g5 f3 20. g6 Rf5 21. Qc2 Bc4
22. Bxf5 exf5 23. Qxf5 Kg8 24. Qh5 Ne6 25. Be3 Nf8 26. Rd4 Bd3
27. Rxd3 d6 28. Bd4 c5 29. Rxf3 Bg5+ 30. Rxg5 Qd7 31. Rf7 Qe6
32. Qh8+ Kxh8 33. g7+ Kh7 34. g8=Q+ Kh6 35. Qg7# 1-0`;

const coachGame = new Chess();
coachGame.loadPgn(coachGamePgn);
const coachVerboseMoves = coachGame.history({ verbose: true });
const coachSnapshots = coachVerboseMoves.map((move) => ({
  color: move.color,
  piece: move.piece,
  from: move.from,
  to: move.to,
  fenBefore: move.before,
  fenAfter: move.after,
}));
const coachOfferIndex = coachVerboseMoves.findIndex((move) => move.san === "Nf4");
assert.ok(coachOfferIndex >= 0, "The Coach game must contain 13.Nf4.");
const coachOffer = coachVerboseMoves[coachOfferIndex];
const coachOfferSacrifice = detectSacrifice(
  coachOffer.before,
  coachOffer.from + coachOffer.to + (coachOffer.promotion ?? ""),
  524,
);
assert.equal(coachOfferSacrifice.sacrifice, true,
  "13.Nf4 must be recognized as the original piece offer.");

const coachSoundOffers = new Array(coachVerboseMoves.length).fill(false);
coachSoundOffers[coachOfferIndex] = true;
for (const san of ["c3", "g4", "d5"]) {
  const continuationIndex = coachVerboseMoves.findIndex(
    (move, index) => index > coachOfferIndex && move.san === san && move.color === "w",
  );
  assert.ok(continuationIndex >= 0, `The Coach game must contain the ${san} continuation.`);
  const continuation = findPersistentSacrificeContinuation(
    coachSnapshots,
    continuationIndex,
    coachSoundOffers,
  );
  assert.deepEqual(continuation, {
    originIndex: coachOfferIndex,
    square: "f4",
    pieceType: "n",
  }, `${san} must retain the declined knight sacrifice while the knight remains capturable.`);
}

const afterKnightWasTakenIndex = coachVerboseMoves.findIndex(
  (move) => move.san === "Bxf4" && move.color === "w",
);
assert.ok(afterKnightWasTakenIndex >= 0, "The Coach game must contain 17.Bxf4.");
assert.equal(
  findPersistentSacrificeContinuation(coachSnapshots, afterKnightWasTakenIndex, coachSoundOffers),
  null,
  "The old offer must expire after 16...gxf4 actually takes the knight.",
);

console.log("Brilliant regression fixtures passed: Morphy sacrifices and the 25.Nb5+ Chess.com knight sacrifice.");
