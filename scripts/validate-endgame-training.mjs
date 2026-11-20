import assert from "node:assert/strict";
import { Chess } from "chess.js";

const positions = [
  ["queen-mate", "7k/8/5KQ1/8/8/8/8/8 w - - 0 1", "mate"],
  ["rook-mate", "k7/8/2K5/8/8/8/8/1R6 w - - 0 1", "mate"],
  ["passed-pawn", "8/P7/8/8/4k3/8/4K3/8 w - - 0 1", "promotion"],
  ["connected-pawns", "8/1PP5/8/8/4k3/8/4K3/8 w - - 0 1", "promotion"],
  ["queen-technique", "7k/8/5K2/8/8/8/8/6Q1 w - - 0 1", "mate"],
  ["rook-pawn-mate", "7k/8/5K2/8/8/8/6P1/6R1 w - - 0 1", "mate"],
  ["outside-passer", "8/8/P7/1K6/3k4/8/8/8 w - - 0 1", "promotion"],
];

assert.equal(new Set(positions.map(([id]) => id)).size, positions.length, "Endgame exercise IDs must be unique.");
assert.ok(positions.length >= 5, "The five-position challenge needs at least five exercises.");

for (const [id, fen, goal] of positions) {
  const game = new Chess(fen);
  assert.equal(game.turn(), "w", id + ": the player must move first.");
  assert.ok(game.moves().length > 0, id + ": the starting position must have a legal move.");
  assert.ok(!game.isGameOver(), id + ": the starting position must not already be terminal.");
  assert.ok(["mate", "promotion"].includes(goal), id + ": unknown objective.");
}

const chosen = [...positions].sort(() => 0.5 - Math.random()).slice(0, 5);
assert.equal(chosen.length, 5, "The challenge must contain exactly five positions.");
assert.equal(new Set(chosen.map(([id]) => id)).size, 5, "A challenge must not repeat a position.");

console.log("Validated " + positions.length + " legal endgame positions and a unique five-position challenge.");
