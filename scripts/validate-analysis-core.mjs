import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { fenKey } from "../src/lib/format.ts";
import { positionKey } from "../src/lib/db.ts";
import { buildPositionCommand } from "../src/lib/engine.ts";
import { buildReview } from "../src/lib/analyze.ts";
import { qBalance } from "../src/lib/see.ts";
import { gameBudgetMs, slotForPosition, timePerMoveForDepth, MINIMUM_ANALYSIS_DEPTH } from "../src/lib/analysisBudget.ts";

assert.equal(gameBudgetMs(10), 4000, "A ten-ply game gets the configured base budget");
assert.equal(gameBudgetMs(10, 1400), 14000, "A desktop profile receives a larger per-move budget");
assert.equal(gameBudgetMs(10, 80), 1320, "Low requested budgets still reserve the minimum for every position");
assert.equal(gameBudgetMs(1), 400, "A one-ply game still budgets both evaluated positions");
assert.equal(MINIMUM_ANALYSIS_DEPTH, 41, "Every non-terminal position must reach depth 41 before the review advances.");
assert.equal(timePerMoveForDepth(14, 1000, 4750), 1000, "Existing quick presets keep their original response time");
assert.equal(timePerMoveForDepth(245, 1000, 4750), 4750, "Depth 245 receives the desktop high-depth budget");
assert.ok(timePerMoveForDepth(120, 1000, 4750) > 1000, "Higher target depths receive progressively more search time");
assert.equal(gameBudgetMs(80, timePerMoveForDepth(245, 1000, 4750)), 380000,
  "An 80-ply desktop game reserves about 380 seconds for the main pass");
assert.ok(gameBudgetMs(10) >= 11 * 120, "The total budget reserves the minimum for every position");
assert.equal(slotForPosition(4000, 0, 11), 364, "The initial position receives an even share");
assert.equal(slotForPosition(4000, 3970, 1), 30, "A position never receives more than the remaining budget");
assert.equal(slotForPosition(0, 0, 1), 1, "An exhausted budget cannot create an over-budget slot");

const board = "4k3/8/8/8/8/8/8/4K3 w - -";
const fresh = `${board} 0 1`;
const fiftyMoveSensitive = `${board} 99 1`;
const sameRuleStateDifferentMoveNumber = `${board} 0 88`;

assert.notEqual(fenKey(fresh), fenKey(fiftyMoveSensitive), "FEN cache key must keep the 50-move counter");
assert.equal(fenKey(fresh), fenKey(sameRuleStateDifferentMoveNumber), "Fullmove number must not fragment the position cache");
assert.notEqual(
  positionKey(fresh, 18, 2),
  positionKey(fiftyMoveSensitive, 18, 2),
  "Position cache must distinguish 0 and 99 halfmoves",
);
assert.notEqual(
  positionKey(fresh, 18, 2, "start|e2e4"),
  positionKey(fresh, 18, 2, "start|d2d4"),
  "Position cache must distinguish different repetition histories",
);

const rootFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
assert.equal(
  buildPositionCommand("child-fen-is-not-used", { startFen: rootFen, moves: ["e2e4", "e7e5", "g1f3"] }),
  `position fen ${rootFen} moves e2e4 e7e5 g1f3`,
  "Stockfish must receive the full path from the original PGN root",
);
assert.equal(
  buildPositionCommand("branch-fen-is-not-used", {
    startFen: rootFen,
    moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"],
  }),
  `position fen ${rootFen} moves e2e4 e7e5 g1f3 b8c6 f1b5 a7a6`,
  "Stockfish must receive the original game path plus every move in an explored variation",
);

const checkedFen = "4r2k/8/8/8/2b5/8/RP6/4K3 w - - 0 1";
const checked = new Chess(checkedFen);
assert.equal(checked.isCheck(), true, "Test position must actually be check");
assert.ok(
  checked.moves({ verbose: true }).some((move) => !move.captured),
  "Test position must have a quiet check evasion",
);
const checkedEval = qBalance(checkedFen);
assert.ok(Number.isFinite(checkedEval), "Quiescence search must return a finite score while in check");
assert.ok(
  checkedEval < -500,
  `Quiescence search must see the quiet check evasion followed by Bxa2; got ${checkedEval} cp`,
);
const forcedFen = "k6R/8/2K5/8/8/8/8/8 b - - 0 1";
const forcedChess = new Chess(forcedFen);
const forcedLegal = forcedChess.moves({ verbose: true });
assert.equal(forcedLegal.length, 1, "The forced-move fixture must have exactly one legal move.");
const forcedPlayed = forcedChess.move({
  from: forcedLegal[0].from,
  to: forcedLegal[0].to,
  promotion: forcedLegal[0].promotion,
});
assert.ok(forcedPlayed, "The only legal move must apply successfully.");
const forcedUci = forcedPlayed.from + forcedPlayed.to + (forcedPlayed.promotion ?? "");
const forcedGame = {
  headers: {},
  startFen: forcedFen,
  moves: [{
    san: forcedPlayed.san,
    uci: forcedUci,
    from: forcedPlayed.from,
    to: forcedPlayed.to,
    piece: forcedPlayed.piece,
    captured: forcedPlayed.captured,
    color: forcedPlayed.color,
    fenBefore: forcedPlayed.before,
    fenAfter: forcedPlayed.after,
  }],
  fens: [forcedPlayed.before, forcedPlayed.after],
};
const forcedBefore = {
  fen: forcedPlayed.before,
  depth: 41,
  lines: [{ multipv: 1, depth: 41, score: { cp: -350 }, pv: [forcedUci] }],
};
const forcedAfter = {
  fen: forcedPlayed.after,
  depth: 41,
  lines: [{ multipv: 1, depth: 41, score: { cp: -350 }, pv: ["h8h7"] }],
};
const forcedReview = buildReview(forcedGame, [forcedBefore, forcedAfter], 41);
assert.equal(forcedReview.moves[0].playedIsBest, true,
  "The single legal move may also match the engine's first line.");
assert.equal(forcedReview.moves[0].cls, "forced",
  "A forced move must be classified as Forced, not Best.");
assert.equal(forcedReview.moves[0].accuracy, 100,
  "A player must not lose accuracy for having no legal alternative.");
assert.equal(forcedReview.moves[0].winLoss, 0,
  "A forced move must not be counted as an avoidable evaluation loss.");
assert.equal(forcedReview.counts.b.forced, 1,
  "Forced moves must appear in the dedicated per-side category totals.");
assert.match(forcedReview.moves[0].comment, /единственный легальный вариант/,
  "The coach must explain why this move was forced.");

const ordinaryFen = "4k3/8/8/8/8/8/8/R3K3 w - - 0 1";
const ordinaryChess = new Chess(ordinaryFen);
assert.ok(ordinaryChess.moves().length > 1, "The comparison position must have several legal moves.");
const ordinaryPlayed = ordinaryChess.move({ from: "a1", to: "a2" });
assert.ok(ordinaryPlayed, "The comparison move must be legal.");
const ordinaryUci = ordinaryPlayed.from + ordinaryPlayed.to + (ordinaryPlayed.promotion ?? "");
const ordinaryGame = {
  headers: {},
  startFen: ordinaryFen,
  moves: [{
    san: ordinaryPlayed.san,
    uci: ordinaryUci,
    from: ordinaryPlayed.from,
    to: ordinaryPlayed.to,
    piece: ordinaryPlayed.piece,
    captured: ordinaryPlayed.captured,
    color: ordinaryPlayed.color,
    fenBefore: ordinaryPlayed.before,
    fenAfter: ordinaryPlayed.after,
  }],
  fens: [ordinaryPlayed.before, ordinaryPlayed.after],
};
const ordinaryBefore = {
  fen: ordinaryPlayed.before,
  depth: 41,
  lines: [{ multipv: 1, depth: 41, score: { cp: 0 }, pv: [ordinaryUci] }],
};
const ordinaryAfter = {
  fen: ordinaryPlayed.after,
  depth: 41,
  lines: [{ multipv: 1, depth: 41, score: { cp: 0 }, pv: ["e8d7"] }],
};
const ordinaryReview = buildReview(ordinaryGame, [ordinaryBefore, ordinaryAfter], 41);
assert.notEqual(ordinaryReview.moves[0].cls, "forced",
  "A position with multiple legal moves must never receive the Forced classification.");


console.log("Analysis core validated: FEN cache identity, repetition history, and quiet check evasions.");
