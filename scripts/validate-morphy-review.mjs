import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { reviewGame } from "../src/lib/analyze.ts";
import { createAnalysisConfig } from "../src/lib/analysisBudget.ts";

const pgn = `[Event "Paris Opera"]
[Site "Paris FRA"]
[Date "1858.??.??"]
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
const moves = game.history({ verbose: true });
const indexByFen = new Map(moves.map((move, index) => [move.before, index]));
const expected = new Map(["Nxb5", "Rxd7", "Qb8+"].map((san) => {
  const move = moves.find((entry) => entry.san === san && entry.color === "w");
  assert.ok(move, `Morphy fixture is missing ${san}`);
  return [san, move];
}));
const verifierCalls = [];

function uci(move) {
  return move.from + move.to + (move.promotion ?? "");
}

function makeWorker(id) {
  return {
    id,
    variant: "lite",
    threads: 1,
    threaded: false,
    isAlive: true,
    newGame() {},
    search(options) {
      const index = indexByFen.get(options.fen);
      const played = index === undefined ? null : moves[index];
      const position = new Chess(options.fen);
      const chosenUci = played ? uci(played) : uci(position.moves({ verbose: true })[0]);
      const depth = options.depth ?? 28;
      const legal = position.moves({ verbose: true });
      const alternative = legal.find((move) => uci(move) !== chosenUci);
      const lines = [{
        multipv: 1,
        depth,
        score: { cp: 0 },
        pv: [chosenUci],
      }];

      if (options.multipv === 2) {
        if (expected.has(played?.san ?? "") && played?.color === "w") {
          verifierCalls.push({
            san: played.san,
            nodes: options.nodes ?? 0,
            depth,
            worker: id,
          });
        }
        if (alternative) {
          lines.push({
            multipv: 2,
            depth,
            score: { cp: 0 },
            pv: [uci(alternative)],
          });
        }
      }

      return {
        promise: Promise.resolve(lines),
        stop() {},
      };
    },
    terminate() {
      this.isAlive = false;
    },
  };
}

const workers = Array.from({ length: 4 }, (_, index) => makeWorker(index + 1));
const review = await reviewGame(
  pgn,
  createAnalysisConfig("standard"),
  workers,
  () => {},
  undefined,
  {
    mainMultiPv: 1,
    device: "desktop",
    reviewWorkers: 4,
    verifierMaxMoves: 0,
  },
);

for (const [san, fixtureMove] of expected) {
  const classified = review.moves.find((move) =>
    move.san === san && move.color === "w"
  );
  assert.ok(classified, `Review omitted Morphy's ${san}`);
  assert.equal(
    classified.cls,
    "brilliant",
    `The full review pipeline must preserve ${san} as Brilliant; got ${classified.cls}`,
  );

  const searches = verifierCalls.filter((call) => call.san === san);
  assert.equal(
    searches.length,
    1,
    `${san} must actually enter the MultiPV 2 verifier queue`,
  );
  assert.ok(
    searches[0].nodes >= 3_000_000,
    `${san} must receive at least 3M verifier nodes; got ${searches[0].nodes}`,
  );
  assert.equal(searches[0].depth, 30, `${san} must be checked two plies deeper`);
}

console.log("Morphy full-review regression passed: Nxb5, Rxd7 and Qb8+ all reached the 3M-node MultiPV 2 verifier and remained Brilliant.");
