import assert from "node:assert/strict";
import { getDeviceAnalysisProfile } from "../src/lib/computeProfile.ts";
import { rankCriticalPositions, shouldRecheckCriticalPosition } from "../src/lib/criticalPositionRanking.ts";

const powerfulDesktop = getDeviceAnalysisProfile({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0",
  mobile: false,
  hardwareConcurrency: 16,
  deviceMemory: 32,
});
assert.equal(powerfulDesktop.device, "desktop");
assert.equal(powerfulDesktop.defaultVariant, "full");
assert.equal(powerfulDesktop.maxThreads, 15);
assert.equal(powerfulDesktop.hashMb, 512);
assert.equal(powerfulDesktop.timePerMoveMs, 1400);
assert.equal(powerfulDesktop.depthBonus, 5);
assert.equal(powerfulDesktop.mainMultiPv, 4);
assert.equal(powerfulDesktop.verifierMaxMoves, 2);
assert.equal(powerfulDesktop.verifierBudgetMs, 5000);
assert.equal(powerfulDesktop.verifierMoveTimeMs, 2400);

const ordinaryDesktop = getDeviceAnalysisProfile({
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0",
  hardwareConcurrency: 8,
  deviceMemory: 8,
});
assert.equal(ordinaryDesktop.device, "desktop");
assert.equal(ordinaryDesktop.defaultVariant, "full");
assert.equal(ordinaryDesktop.timePerMoveMs, 1000);
assert.equal(ordinaryDesktop.depthBonus, 3);

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
assert.equal(lowEndPhone.depthBonus, 0);
assert.equal(lowEndPhone.mainMultiPv, 2);
assert.equal(lowEndPhone.verifierEnabled, false);

const powerfulPhone = getDeviceAnalysisProfile({
  userAgent: "Mozilla/5.0 (Linux; Android 16; Pixel)",
  mobile: true,
  hardwareConcurrency: 8,
  deviceMemory: 8,
});
assert.equal(powerfulPhone.device, "mobile");
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

console.log("Adaptive analysis validated: desktop-max, mobile-balanced, strong-phone verification, and critical-position ranking.");
