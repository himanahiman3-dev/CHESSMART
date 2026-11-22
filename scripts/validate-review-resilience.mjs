import assert from "node:assert/strict";
import { reviewGame } from "../src/lib/analyze.ts";
import { createAnalysisConfig } from "../src/lib/analysisBudget.ts";

const pgn = `[Event "Review worker recovery"]
[Site "CHESSMART"]
[Date "2026.11.22"]
[Round "?"]
[White "A"]
[Black "B"]
[Result "*"]

1. e4 *
`;

function makeWorker({ failsFirstSearch = false } = {}) {
  return {
    variant: "lite",
    threads: 1,
    threaded: false,
    isAlive: true,
    searches: 0,
    terminated: false,
    newGame() {},
    search(options) {
      this.searches++;
      if (failsFirstSearch && this.searches === 1) {
        this.isAlive = false;
        return {
          promise: Promise.reject(new Error("simulated first-position worker crash")),
          stop() {},
        };
      }
      const turn = options.fen.split(" ")[1];
      const move = turn === "b" ? "e7e5" : "e2e4";
      return {
        promise: Promise.resolve([{
          multipv: 1,
          depth: 12,
          score: { cp: 0 },
          pv: [move],
        }]),
        stop() {},
      };
    },
    terminate() {
      this.terminated = true;
      this.isAlive = false;
    },
  };
}

const workers = [
  makeWorker({ failsFirstSearch: true }),
  makeWorker({ failsFirstSearch: true }),
  makeWorker(),
  makeWorker(),
];
const progress = [];
const review = await reviewGame(
  pgn,
  createAnalysisConfig("fast"),
  workers,
  (value) => progress.push(value),
  undefined,
  {
    mainMultiPv: 1,
    device: "desktop",
    reviewWorkers: 4,
    verifierMaxMoves: 0,
  },
);

assert.equal(review.moves.length, 1, "The review must include the supplied 1.e4 game.");
assert.equal(review.moves[0].san, "e4");
assert.equal(review.positions.length, 2, "Both the initial and post-e4 positions must be evaluated.");
assert.equal(review.positions[0].lines[0].pv[0], "e2e4",
  "The initial position must be re-evaluated by a surviving worker.");
assert.equal(review.positions[0].depth, 12);
assert.equal(workers[0].searches, 1, "The first failing worker must not be reused.");
assert.equal(workers[1].searches, 1, "The second failing worker must not be reused.");
assert.equal(workers[0].terminated, true);
assert.equal(workers[1].terminated, true);
assert.equal(workers[2].searches, 1, "A surviving worker must pick up a failed worker's position.");
assert.equal(workers[3].searches, 1, "The second surviving worker must complete the other queued position.");
assert.ok(progress.some((entry) => entry.stage === "scan" && entry.activeWorkers > 0),
  "The UI must receive active scan progress after the initial queue starts.");
assert.ok(progress.at(-1)?.stage === "finalize",
  "The review must reach finalization instead of remaining stuck at the first ply.");

console.log("Review resilience passed: two failed first-search workers were removed and both positions were requeued to surviving workers.");
