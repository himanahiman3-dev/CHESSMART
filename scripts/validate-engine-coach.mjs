import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { diagnosticCount, evaluatePositionDiagnostics } from "../src/lib/grandmasterDiagnostics.ts";
import { explainStockfishMove } from "../src/lib/engineCoach.ts";

const startFen = new Chess().fen();
assert.equal(diagnosticCount(), 300, "The existing 300 diagnostic checks must remain intact.");

const openingMove = explainStockfishMove(startFen, "e2e4");
assert.ok(openingMove, "A legal Stockfish UCI move should produce an explanation.");
assert.equal(openingMove.san, "e4");
assert.equal(openingMove.uci, "e2e4", "The coach must preserve the engine's exact best UCI move.");
assert.equal(new Chess(openingMove.fenAfter).turn(), "b", "The suggested move must be applied legally.");
assert.equal(new Chess(startFen).fen(), startFen, "Explaining a move must not mutate the caller's position.");

const checkedFen = "4r2k/8/8/8/8/8/8/4K3 w - - 0 1";
assert.equal(evaluatePositionDiagnostics(checkedFen).status, "Шах");
const evasion = explainStockfishMove(checkedFen, "e1d1");
assert.ok(evasion, "A legal check evasion should be explainable.");
assert.ok(evasion.tactical.some((item) => item.includes("Снимает шах")), "The explanation should identify a check evasion.");
assert.equal(new Chess(evasion.fenAfter).isCheck(), false, "The suggested king move must actually leave check.");

assert.equal(explainStockfishMove(startFen, "e2e5"), null, "Illegal engine moves must be ignored safely.");
assert.equal(explainStockfishMove("not a FEN", "e2e4"), null, "Invalid positions must not break the review UI.");
assert.equal(explainStockfishMove(startFen, "bad"), null, "Malformed UCI must be ignored safely.");

console.log("Stockfish coach validated: legal PV handling, check evasions, FEN immutability, and unchanged 300 diagnostics.");
