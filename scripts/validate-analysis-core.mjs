import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { fenKey } from "../src/lib/format.ts";
import { positionKey } from "../src/lib/db.ts";
import { buildPositionCommand } from "../src/lib/engine.ts";
import { qBalance } from "../src/lib/see.ts";
import { gameBudgetMs, slotForPosition } from "../src/lib/analysisBudget.ts";

assert.equal(gameBudgetMs(10), 4000, "A ten-ply game gets the configured base budget");
assert.equal(gameBudgetMs(1), 400, "A one-ply game still budgets both evaluated positions");
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

console.log("Analysis core validated: FEN cache identity, repetition history, and quiet check evasions.");
