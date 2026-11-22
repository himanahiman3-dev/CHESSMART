import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { fenKey } from "../src/lib/format.ts";
import { positionKey } from "../src/lib/db.ts";
import { buildPositionCommand, buildSearchCommand } from "../src/lib/engine.ts";
import { hasOnlyLegalMove } from "../src/lib/forcedMove.ts";
import { shouldRecheckCriticalPosition } from "../src/lib/criticalPositionRanking.ts";
import { qBalance } from "../src/lib/see.ts";
import { gameBudgetMs, slotForPosition, normalizeAnalysisTimeMs, REVIEW_TARGET_DEPTH, ANALYSIS_TIME_MODES, DEFAULT_ANALYSIS_CONFIG, createAnalysisConfig, resolveAnalysisBudget, positionComplexityFactor, scalePositionLimit } from "../src/lib/analysisBudget.ts";
import { summarizeReview } from "../src/lib/learningStats.ts";
import { getDeviceAnalysisProfile } from "../src/lib/computeProfile.ts";
import { countPositionPieces } from "../src/lib/endgameTablebase.ts";

assert.equal(REVIEW_TARGET_DEPTH, 28, "Node-first review uses depth 28 as a safety ceiling.");
assert.equal(ANALYSIS_TIME_MODES[0].timeMs, 300, "Fast mode gives each position 300 ms.");
assert.equal(ANALYSIS_TIME_MODES[1].timeMs, 1000, "Optimal mode gives each position 1000 ms.");
assert.equal(ANALYSIS_TIME_MODES[2].timeMs, 3000, "Deep mode gives each position 3000 ms.");
assert.equal(normalizeAnalysisTimeMs(1700), 1000, "Unknown time values fall back to the optimal mode.");

assert.equal(
  buildSearchCommand({ depth: 18, nodes: 250000, movetimeMs: 180 }),
  "go nodes 250000 depth 18 movetime 180",
  "UCI node budget is emitted first; explicit hybrid mode may still add movetime",
);
assert.equal(
  buildSearchCommand({ nodes: 350000, depth: 24 }),
  "go nodes 350000 depth 24",
  "Node-first searches combine the primary node ceiling with a safety depth cap",
);
assert.equal(buildSearchCommand({ nodes: 1000000 }), "go nodes 1000000",
  "Nodes-only mode must not add a depth or time cap");
assert.equal(buildSearchCommand({ movetimeMs: 400 }), "go movetime 400",
  "Time-only mode must not add a depth cap");

const autoMobile = resolveAnalysisBudget(DEFAULT_ANALYSIS_CONFIG, { device: "mobile", reviewWorkers: 1 }, 50);
assert.equal(autoMobile.preset, "fast", "Auto should select the faster preset on phones");
assert.equal(autoMobile.nodes, 350000);
assert.equal(autoMobile.depthLimit, 24);
assert.equal(autoMobile.hardTimeoutMs, 6000);
assert.equal(autoMobile.movetimeMs, undefined);

const standardDesktop = resolveAnalysisBudget(createAnalysisConfig("standard"), { device: "desktop", reviewWorkers: 2 }, 50);
assert.equal(standardDesktop.preset, "standard");
assert.equal(standardDesktop.depthLimit, 28);
assert.equal(standardDesktop.nodes, 1000000);
assert.equal(standardDesktop.hardTimeoutMs, 15000);
assert.equal(standardDesktop.movetimeMs, undefined);

const timeOnly = resolveAnalysisBudget(createAnalysisConfig("standard", "time"), { device: "desktop" }, 50);
assert.equal(timeOnly.movetimeMs, 400);
assert.equal(timeOnly.nodes, undefined);
assert.equal(timeOnly.depthLimit, undefined);
assert.equal(timeOnly.hardTimeoutMs, 15000);

const nodesOnly = resolveAnalysisBudget(createAnalysisConfig("standard", "nodes"), { device: "desktop" }, 50);
assert.equal(nodesOnly.nodes, 1000000);
assert.equal(nodesOnly.movetimeMs, undefined);
assert.equal(nodesOnly.depthLimit, undefined);
assert.equal(nodesOnly.hardTimeoutMs, 15000);

const autoBullet = resolveAnalysisBudget(DEFAULT_ANALYSIS_CONFIG, { device: "desktop" }, 50, "60+0");
assert.equal(autoBullet.preset, "fast", "Auto selects Fast for bullet time controls");
const autoRapid = resolveAnalysisBudget(DEFAULT_ANALYSIS_CONFIG, { device: "desktop" }, 50, "900+10");
assert.equal(autoRapid.preset, "standard", "Auto keeps Standard for rapid/classical controls");
const deep = resolveAnalysisBudget(createAnalysisConfig("deep"), { device: "desktop" }, 50);
assert.equal(deep.nodes, 3000000);
assert.equal(deep.depthLimit, 30);
assert.equal(deep.hardTimeoutMs, 45000);

assert.equal(normalizeAnalysisTimeMs(3000), 3000);

const quietEndgameFen = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";
const normalOpeningFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const checkedTacticalFen = "4r2k/8/8/8/2b5/8/RP6/4K3 w - - 0 1";
const quietFactor = positionComplexityFactor(quietEndgameFen);
const openingFactor = positionComplexityFactor(normalOpeningFen);
const tacticalFactor = positionComplexityFactor(checkedTacticalFen);
assert.ok(quietFactor < openingFactor,
  "Quiet low-branching positions must receive a smaller node/time budget than the opening.");
assert.ok(tacticalFactor > openingFactor,
  "A checked tactical position must receive a larger node/time budget.");
assert.equal(scalePositionLimit(1_000_000, 0.7), 700_000);
assert.equal(scalePositionLimit(1_000_000, 1.5), 1_500_000);
assert.equal(scalePositionLimit(undefined, 1.5), undefined);
assert.equal(scalePositionLimit(100_000, 4, 250_000), 250_000);
assert.equal(countPositionPieces("4k3/8/8/8/8/8/8/4K3 w - - 0 1"), 2);
assert.equal(countPositionPieces("4k3/8/8/8/8/8/PPPP4/4K2Q w - - 0 1"), 7);
assert.equal(countPositionPieces(normalOpeningFen), 32,
  "Syzygy guard must count every piece, including kings and pawns.");



assert.equal(getDeviceAnalysisProfile({ hardwareConcurrency: 4 }).maxThreads, 2,
  "A four-thread desktop must reserve two logical cores for UI and OS work.");
assert.equal(getDeviceAnalysisProfile({ hardwareConcurrency: 8 }).maxThreads, 6,
  "A typical desktop must keep two logical cores available for rendering.");
assert.equal(getDeviceAnalysisProfile({ hardwareConcurrency: 32 }).maxThreads, 10,
  "Large desktop CPUs must cap Stockfish worker count to protect browser responsiveness.");

// Capable desktops request four independent workers; runtime smoke tests can
// remove an instance that fails its simultaneous-search checks.
const i3DesktopProfile = getDeviceAnalysisProfile({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/157.0.0.0",
  hardwareConcurrency: 8,
  deviceMemory: 8,
});
assert.equal(i3DesktopProfile.reviewWorkers, 4,
  "An 8-thread desktop should request four independently verified review workers.");

assert.equal(getDeviceAnalysisProfile({
  userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile",
  hardwareConcurrency: 8,
  deviceMemory: 8,
}).reviewWorkers, 1,
  "Mobile devices must retain a single review worker.");

assert.equal(getDeviceAnalysisProfile({
  hardwareConcurrency: 4,
  deviceMemory: 16,
}).reviewWorkers, 1,
  "Low-resource desktops must not be forced to create a multi-worker pool.");

assert.equal(getDeviceAnalysisProfile({
  hardwareConcurrency: 6,
  deviceMemory: 8,
}).reviewWorkers, 4,
  "A six-thread desktop should request four verified workers.");

assert.equal(getDeviceAnalysisProfile({
  hardwareConcurrency: 8,
  deviceMemory: 4,
}).reviewWorkers, 1,
  "Desktop devices with 4 GB memory remain on one worker to avoid memory pressure.");
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
assert.notEqual(
  positionKey(fresh, 28, 1, "game-path", "nodes=350000;depth=24;engine=19.0.1-lite"),
  positionKey(fresh, 28, 1, "game-path", "nodes=1000000;depth=28;engine=19.0.1-lite"),
  "Position cache must isolate node budgets and engine/search configuration",
);
assert.notEqual(
  positionKey(fresh, 28, 1, "game-path", "engine=19.0.1-lite;book=eco-name-map-v1"),
  positionKey(fresh, 28, 1, "game-path", "engine=19.0.1-full;book=eco-name-map-v2"),
  "Position cache must isolate engine/network and opening-book revisions",
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
assert.equal(hasOnlyLegalMove(forcedLegal.length), true,
  "Exactly one legal move is detected internally so it is not penalized as an avoidable mistake.");
assert.equal(hasOnlyLegalMove(0), false,
  "A position with no legal moves is checkmate or stalemate.");
assert.equal(hasOnlyLegalMove(2), false,
  "Two or more legal moves are not internally marked as forced.");

assert.equal(shouldRecheckCriticalPosition(0, 0, 20, false, true), true,
  "A forced-mate opportunity must be rechecked even when the expected-points curve is flat.");
assert.equal(shouldRecheckCriticalPosition(0, 0, 10, false, false), false,
  "Quiet, non-critical positions must not consume deeper-review budget.");

const ordinaryFen = "4k3/8/8/8/8/8/8/R3K3 w - - 0 1";
const ordinaryChess = new Chess(ordinaryFen);
const ordinaryLegalCount = ordinaryChess.moves().length;
assert.ok(ordinaryLegalCount > 1, "The comparison position must have several legal moves.");
assert.equal(hasOnlyLegalMove(ordinaryLegalCount), false,
  "A position with multiple legal moves is not internally marked as forced.");


const reviewFixture = (moves) => ({
  headers: { Site: "fixture", Date: "2026.11.20", White: "A", Black: "B", Result: "*" },
  startFen: new Chess().fen(),
  moves: moves.map((uci, index) => ({
    uci,
    index,
    color: index % 2 === 0 ? "w" : "b",
    fenBefore: new Chess().fen(),
    accuracy: 80,
    cls: "good",
    san: "e4",
    comment: "",
  })),
  accuracy: { w: 80, b: 80 },
});
const firstGameSummary = summarizeReview(reviewFixture(["e2e4", "e7e5", "g1f3"]));
const secondGameSummary = summarizeReview(reviewFixture(["e2e4", "c7c5", "g1f3"]));
assert.notEqual(
  firstGameSummary.id,
  secondGameSummary.id,
  "Different game move sequences must not collide merely because the first/last moves match.",
);

console.log("Analysis core validated: FEN cache identity, repetition history, and quiet check evasions.");
