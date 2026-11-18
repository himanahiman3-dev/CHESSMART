import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { selectCriticalPositions } from "../src/lib/analyze.ts";

function makeGame(san) {
  const chess = new Chess();
  const startFen = chess.fen();
  const move = chess.move(san);
  assert.ok(move, `Test move ${san} must be legal`);
  const afterFen = chess.fen();
  return {
    headers: { WhiteElo: "1500", BlackElo: "1500" },
    startFen,
    moves: [{
      san: move.san,
      uci: move.from + move.to + (move.promotion ?? ""),
      from: move.from,
      to: move.to,
      piece: move.piece,
      captured: move.captured,
      color: move.color,
      fenBefore: startFen,
      fenAfter: afterFen,
    }],
    fens: [startFen, afterFen],
  };
}

const tacticalGame = makeGame("h3");
const tacticalPositions = [
  {
    fen: tacticalGame.fens[0],
    depth: 12,
    lines: [
      { multipv: 1, depth: 12, score: { cp: 350 }, pv: ["g1f3", "d7d5"] },
      { multipv: 2, depth: 12, score: { cp: 80 }, pv: ["d2d4", "d7d5"] },
    ],
  },
  {
    fen: tacticalGame.fens[1],
    depth: 12,
    lines: [{ multipv: 1, depth: 12, score: { cp: -450 }, pv: ["d7d5"] }],
  },
];

const candidates = selectCriticalPositions(tacticalGame, tacticalPositions);
assert.equal(candidates.length, 1, "A move with a large first-pass evaluation swing must be re-checked");
assert.equal(candidates[0].index, 0, "The re-check must point to the move that caused the swing");
assert.ok(candidates[0].estimatedLoss > 10, "The candidate must expose its estimated expected-points loss");

const openingGame = makeGame("e4");
const openingPositions = [
  {
    fen: openingGame.fens[0],
    depth: 12,
    lines: [
      { multipv: 1, depth: 12, score: { cp: 350 }, pv: ["g1f3"] },
      { multipv: 2, depth: 12, score: { cp: 80 }, pv: ["d2d4"] },
    ],
  },
  {
    fen: openingGame.fens[1],
    depth: 12,
    lines: [{ multipv: 1, depth: 12, score: { cp: -450 }, pv: ["d7d5"] }],
  },
];
assert.equal(selectCriticalPositions(openingGame, openingPositions).length, 0,
  "Opening-book moves must not waste the secondary engine budget");

assert.equal(selectCriticalPositions(tacticalGame, tacticalPositions, 0).length, 0,
  "The caller must be able to disable candidate selection with a zero limit");

console.log("Multi-engine candidate selection validated: critical swings, opening exclusion, and limits.");
