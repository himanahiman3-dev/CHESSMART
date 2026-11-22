import assert from "node:assert/strict";
import { getDeviceAnalysisProfile } from "../src/lib/computeProfile.ts";
import { rankCriticalPositions, shouldRecheckCriticalPosition } from "../src/lib/criticalPositionRanking.ts";
import { verifyReviewWorkerPool } from "../src/lib/reviewPoolHealth.ts";

const powerfulDesktop = getDeviceAnalysisProfile({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0",
  mobile: false,
  hardwareConcurrency: 16,
  deviceMemory: 8, // Browsers commonly cap the exposed deviceMemory value at 8 GB.
});
assert.equal(powerfulDesktop.device, "desktop");
assert.equal(powerfulDesktop.defaultVariant, "full");
assert.equal(powerfulDesktop.maxThreads, 10, "A high-core desktop must reserve CPU headroom for browser rendering.");
assert.equal(powerfulDesktop.hashMb, 512);
assert.equal(powerfulDesktop.timePerMoveMs, 1400);
assert.equal(powerfulDesktop.maxTimePerMoveMs, 4750);
assert.equal(powerfulDesktop.depthBonus, 5);
assert.equal(powerfulDesktop.mainMultiPv, 1, "Whole-game scan defaults to MultiPV 1.");
assert.equal(powerfulDesktop.reviewWorkers, 4, "A 16-thread desktop may request four workers, subject to runtime parallel-search probes.");
assert.equal(powerfulDesktop.reviewHashMb, 64);
assert.equal(powerfulDesktop.verifierMaxMoves, 6);
assert.equal(powerfulDesktop.verifierBudgetMs, 5000);
assert.equal(powerfulDesktop.verifierMoveTimeMs, 2400);

const ordinaryDesktop = getDeviceAnalysisProfile({
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0",
  hardwareConcurrency: 8,
  deviceMemory: 8,
});
assert.equal(ordinaryDesktop.device, "desktop");
assert.equal(ordinaryDesktop.defaultVariant, "full");
assert.equal(ordinaryDesktop.maxThreads, 6, "A typical desktop keeps two logical cores free for UI work.");
assert.equal(ordinaryDesktop.reviewWorkers, 3, "An 8-thread desktop requests three independently verified review workers.");
assert.equal(ordinaryDesktop.mainMultiPv, 1);
assert.equal(ordinaryDesktop.verifierMaxMoves, 4);
assert.equal(ordinaryDesktop.timePerMoveMs, 1000);
assert.equal(ordinaryDesktop.maxTimePerMoveMs, 4750);
assert.equal(ordinaryDesktop.depthBonus, 3);

const midRangeDesktop = getDeviceAnalysisProfile({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/157.0",
  hardwareConcurrency: 6,
  deviceMemory: 8,
});
assert.equal(midRangeDesktop.reviewWorkers, 2,
  "A six-thread desktop should request two review workers rather than overloading the browser.");

const memoryConstrainedDesktop = getDeviceAnalysisProfile({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/157.0",
  hardwareConcurrency: 16,
  deviceMemory: 4,
});
assert.equal(memoryConstrainedDesktop.reviewWorkers, 1,
  "A machine exposing only 4 GB must stay on its primary engine even with many logical cores.");

const lowEndPhone = getDeviceAnalysisProfile({
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  mobile: true,
  hardwareConcurrency: 4,
  deviceMemory: 4,
});
assert.equal(lowEndPhone.device, "mobile");
assert.equal(lowEndPhone.defaultVariant, "lite");
assert.equal(lowEndPhone.maxThreads, 1);
assert.equal(lowEndPhone.hashMb, 64);
assert.equal(lowEndPhone.timePerMoveMs, 400);
assert.equal(lowEndPhone.maxTimePerMoveMs, 1100);
assert.equal(lowEndPhone.depthBonus, 0);
assert.equal(lowEndPhone.mainMultiPv, 1);
assert.equal(lowEndPhone.reviewWorkers, 1);
assert.equal(lowEndPhone.verifierMaxMoves, 1);
assert.equal(lowEndPhone.verifierEnabled, false);

const powerfulPhone = getDeviceAnalysisProfile({
  userAgent: "Mozilla/5.0 (Linux; Android 16; Pixel)",
  mobile: true,
  hardwareConcurrency: 8,
  deviceMemory: 8,
});
assert.equal(powerfulPhone.device, "mobile");
assert.equal(powerfulPhone.reviewWorkers, 1);
assert.equal(powerfulPhone.verifierEnabled, true);
assert.equal(powerfulPhone.verifierMaxMoves, 1);
assert.equal(powerfulPhone.verifierMoveTimeMs, 800);
assert.ok(powerfulPhone.verifierBudgetMs < ordinaryDesktop.verifierBudgetMs,
  "A phone gets a smaller secondary-search budget than a PC");

const ranked = rankCriticalPositions([
  { index: 5, priority: 7, estimatedLoss: 2, secondLineGap: 1 },
  { index: 2, priority: 12, estimatedLoss: 5, secondLineGap: 3 },
  { index: 3, priority: 12, estimatedLoss: 4, secondLineGap: 4 },
], 2);
assert.deepEqual(ranked.map((item) => item.index), [2, 3],
  "Critical positions must be ranked by priority with stable index tie-breaking");
assert.deepEqual(rankCriticalPositions(ranked, 0), [],
  "A zero candidate limit disables secondary searches");
assert.deepEqual(rankCriticalPositions(ranked, 10), ranked,
  "A candidate limit larger than the shortlist must retain all candidates");

assert.equal(shouldRecheckCriticalPosition(2.5, 0, 20, false), true,
  "A meaningful evaluation loss must trigger a second search");
assert.equal(shouldRecheckCriticalPosition(0.5, 6, 18, false), true,
  "A position with a sharply superior alternative should be re-checked");
assert.equal(shouldRecheckCriticalPosition(1.5, 0, 10, true), true,
  "A tactical position with a measurable swing should be re-checked");
assert.equal(shouldRecheckCriticalPosition(1.4, 0, 10, false), false,
  "Quiet, stable positions should not use a second engine");

function fakeWorker({ fails = false } = {}) {
  return {
    probes: 0,
    terminated: false,
    search(options) {
      this.probes++;
      assert.equal(options.multipv, 1);
      assert.ok(options.nodes >= 10_000);
      assert.ok(options.hardTimeoutMs > 0);
      return {
        promise: fails
          ? Promise.reject(new Error("simulated first-search failure"))
          : Promise.resolve([{ multipv: 1, depth: 8, score: { cp: 12 }, pv: ["e2e4", "e7e5"] }]),
        stop() {},
      };
    },
    terminate() { this.terminated = true; },
  };
}

const fourHealthy = Array.from({ length: 4 }, () => fakeWorker());
const verifiedFour = await verifyReviewWorkerPool(fourHealthy);
assert.equal(verifiedFour.length, 4,
  "Four independent workers should be retained after two simultaneous successful probes.");
assert.ok(fourHealthy.every((worker) => worker.probes === 2),
  "Every worker must complete two concurrent smoke searches before being enabled.");

const threeHealthyOneBroken = [
  fakeWorker(), fakeWorker(), fakeWorker(), fakeWorker({ fails: true }),
];
const verifiedThree = await verifyReviewWorkerPool(threeHealthyOneBroken);
assert.equal(verifiedThree.length, 3,
  "A failed fourth worker must be removed while the three healthy workers are re-tested.");
assert.equal(threeHealthyOneBroken[3].terminated, true,
  "A worker that fails its first search must be terminated, not reused.");
assert.ok(verifiedThree.every((worker) => worker.probes === 3),
  "Surviving workers must pass two additional simultaneous probes after pool reduction.");

const oneHealthy = [fakeWorker(), fakeWorker({ fails: true })];
const verifiedFallback = await verifyReviewWorkerPool(oneHealthy);
assert.deepEqual(verifiedFallback, [],
  "Fewer than two verified independent workers must signal fallback to the primary engine.");
assert.ok(oneHealthy.every((worker) => worker.terminated),
  "All workers must be terminated when the independent pool is too small.");

const abortedController = new AbortController();
abortedController.abort();
await assert.rejects(
  verifyReviewWorkerPool([fakeWorker(), fakeWorker()], abortedController.signal),
  /cancelled/,
  "An aborted pool probe must stop rather than enabling unverified workers.",
);

console.log("Adaptive analysis validated: 2–4 desktop workers, mobile fallback, concurrent pool probes, and critical-position ranking.");
