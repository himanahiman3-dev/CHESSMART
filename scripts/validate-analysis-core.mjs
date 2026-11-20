import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { fenKey } from "../src/lib/format.ts";
import { positionKey } from "../src/lib/db.ts";
import { buildPositionCommand } from "../src/lib/engine.ts";
import { forcedMoveClass } from "../src/lib/forcedMove.ts";
import { qBalance } from "../src/lib/see.ts";
import { gameBudgetMs, slotForPosition, normalizeAnalysisTimeMs, REVIEW_TARGET_DEPTH, ANALYSIS_TIME_MODES } from "../src/lib/analysisBudget.ts";

assert.equal(REVIEW_TARGET_DEPTH, 22, "Timed game review uses depth 22 as its maximum target.");
assert.equal(ANALYSIS_TIME_MODES[0].timeMs, 300, "Fast mode gives each position 300 ms.");
assert.equal(ANALYSIS_TIME_MODES[1].timeMs, 1000, "Optimal mode gives each position 1000 ms.");
assert.equal(ANALYSIS_TIME_MODES[2].timeMs, 3000, "Deep mode gives each position 3000 ms.");
assert.equal(normalizeAnalysisTimeMs(1700), 1000, "Unknown time values fall back to the optimal mode.");
assert.equal(gameBudgetMs(10, 300), 3300, "A 10-ply game reviews 11 positions at 300 ms each.");
assert.equal(gameBudgetMs(10, 1000), 11000, "A 10-ply game reviews 11 positions at one second each.");
assert.equal(gameBudgetMs(10, 3000), 33000, "A 10-ply game reviews 11 positions at three seconds each.");
assert.equal(gameBudgetMs(245, 300), 73800, "A 245-ply game has 246 timed positions in fast mode.");
assert.equal(gameBudgetMs(245, 1000), 246000, "A 245-ply game has 246 timed positions in optimal mode.");
assert.equal(gameBudgetMs(245, 3000), 738000, "A 245-ply game has 246 timed positions in deep mode.");

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
assert.equal(forcedMoveClass(forcedLegal.length), "forced",
  "Exactly one legal move must map to the Forced classification.");
assert.equal(forcedMoveClass(0), null,
  "A position with no legal moves is checkmate or stalemate, not a forced move.");
assert.equal(forcedMoveClass(2), null,
  "Two or more legal moves must not receive the Forced classification.");

const ordinaryFen = "4k3/8/8/8/8/8/8/R3K3 w - - 0 1";
const ordinaryChess = new Chess(ordinaryFen);
const ordinaryLegalCount = ordinaryChess.moves().length;
assert.ok(ordinaryLegalCount > 1, "The comparison position must have several legal moves.");
assert.equal(forcedMoveClass(ordinaryLegalCount), null,
  "A position with multiple legal moves must never receive the Forced classification.");

console.log("Analysis core validated: FEN cache identity, repetition history, and quiet check evasions.");
