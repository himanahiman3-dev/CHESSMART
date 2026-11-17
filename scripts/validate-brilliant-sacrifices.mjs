import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { detectSacrifice, hangingLoss, qBalance } from "../src/lib/see.ts";
import { qualifiesAsBrilliant } from "../src/lib/brilliant.ts";

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
  ["Nxb5", "10.Nxb5"],
  ["Rxd7", "13.Rxd7"],
  ["Qb8+", "16.Qb8+"],
]);
const found = new Set();

for (const move of history) {
  const before = replay.fen();
  const played = replay.move(move.san);
  assert.ok(played, `Could not replay ${move.san}`);
  if (!targets.has(move.san)) continue;

  const uci = move.from + move.to + (move.promotion ?? "");
  const sacrifice = detectSacrifice(before, uci, 2690);
  if (!sacrifice.sacrifice && move.san === "Rxd7") {
    const afterBoard = new Chess(before);
    afterBoard.move(move.san);
    const fields = before.split(" ");
    fields[1] = fields[1] === "w" ? "b" : "w";
    fields[3] = "-";
    const passFen = fields.join(" ");
    const captures = afterBoard.moves({ verbose: true }).filter((candidate) => candidate.to === move.to);
    console.log("Rxd7 diagnostic", JSON.stringify({
      before, after: afterBoard.fen(), captures,
      defendedByUs: afterBoard.isAttacked(move.to, move.color),
      qBefore: qBalance(before), qAfter: qBalance(afterBoard.fen()),
      passThreat: hangingLoss(passFen), afterHanging: hangingLoss(afterBoard.fen()),
    }));
  }
  assert.equal(
    sacrifice.sacrifice,
    true,
    `${targets.get(move.san)} must be detected as a sound piece/exchange sacrifice; got ${JSON.stringify(sacrifice)}`,
  );
  found.add(move.san);
}

for (const san of targets.keys()) {
  assert.ok(found.has(san), `The sample game is missing target move ${san}`);
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

console.log("Morphy Opera Game: 10.Nxb5, 13.Rxd7 and 16.Qb8+ sacrifices detected.");
