import assert from "node:assert/strict";
import {
  buildQuestBoard,
  buildSuiteDashboard,
  calculateReviewConfidence,
  claimQuestReward,
  clampSuiteNumber,
  formatSuiteBytes,
  formatSuiteDuration,
  getConnectionQuality,
  getOnlinePollDelay,
  getPeakRating,
  getProfileMetrics,
  getQuestCompletionPercent,
  getQuestLevel,
  getRetryDelay,
  getReviewTrend,
  normalizeSuiteSettings,
  parseSuiteSettings,
  serializeSuiteSettings,
  suiteDayStart,
  suiteWeekStart,
} from "../src/lib/systemsSuite.ts";

const NOW = new Date(2026, 10, 17, 12, 0, 0, 0).getTime();
const DAY = suiteDayStart(NOW);
const WEEK = suiteWeekStart(NOW);

function makeProfile(seed) {
  const games = seed % 43;
  const wins = games ? seed % (games + 1) : 0;
  const losses = games ? (seed * 3) % (games - wins + 1) : 0;
  const draws = games - wins - losses;
  const rating = 100 + (seed * 37) % 3101;
  const historyCount = seed % 10;
  const reviewCount = seed % 9;
  const puzzleCount = seed % 12;
  const sessionCount = seed % 8;
  const history = Array.from({ length: historyCount }, (_, index) => {
    const change = ((seed + index * 7) % 41) - 15;
    return {
      at: WEEK + ((seed + index * 997) % (7 * 86_400_000)),
      result: ["win", "loss", "draw"][(seed + index) % 3],
      botElo: 500 + ((seed * 13 + index * 71) % 2600),
      change,
      ratingAfter: Math.max(100, Math.min(3200, rating + change * index)),
    };
  });
  const reviews = Array.from({ length: reviewCount }, (_, index) => {
    const acc = (seed * 11 + index * 19) % 101;
    const opening = (seed + index) % 101;
    const middle = (seed * 3 + index * 17) % 101;
    const ending = (seed * 5 + index * 23) % 101;
    const phase = (value) => ({
      w: { accuracy: value, moves: 4 + (seed + index) % 12 },
      b: { accuracy: Math.max(0, value - ((seed + index) % 9)), moves: 4 + (seed + index * 2) % 12 },
    });
    return {
      id: "review-" + seed + "-" + index,
      at: DAY + ((seed + index * 103) % 86_000_000),
      white: "Player",
      black: "Opponent",
      result: ["1-0", "0-1", "1/2-1/2", "*"][(seed + index) % 4],
      date: "2026-11-17",
      plies: 20 + index * 2,
      accuracy: { w: acc, b: Math.min(100, acc + 2), average: Math.min(100, acc + 1) },
      phases: { opening: phase(opening), middlegame: phase(middle), endgame: phase(ending) },
      brilliantMoves: Array.from({ length: (seed + index) % 3 }, () => ({ color: "w", moveNumber: 12, san: "Rxd5", comment: "Brilliant" })),
      missedWins: Array.from({ length: (seed + index * 3) % 2 }, () => ({ color: "b", moveNumber: 18, san: "Qh4", comment: "Missed win" })),
    };
  });
  const puzzles = Array.from({ length: puzzleCount }, (_, index) => ({
    id: "puzzle-" + seed + "-" + index,
    fen: "startpos",
    color: "w",
    bestUci: "e2e4",
    playedSan: "Nf3",
    cls: ["inaccuracy", "mistake", "miss", "blunder"][index % 4],
    comment: "Practice",
    sourceGame: "Fixture",
    moveNumber: index + 1,
    createdAt: WEEK + index,
    attempts: index % 5,
    ...(index % 3 === 0 ? { solvedAt: DAY + index * 11 } : {}),
  }));
  const puzzleRatingHistory = Array.from({ length: puzzleCount }, (_, index) => ({
    at: DAY + index * 17,
    puzzleId: "library-" + seed + "-" + index,
    mode: ["rated", "daily", "themes"][index % 3],
    solved: (seed + index) % 4 !== 0,
    change: (index % 2 ? 6 : -4),
    ratingAfter: 1200 + index * 3,
  }));
  const trainingSessions = Array.from({ length: sessionCount }, (_, index) => ({
    id: "session-" + seed + "-" + index,
    category: index % 2 ? "mistakes" : "endgame",
    startedAt: DAY + ((seed + index * 29) % 86_000_000),
    durationMs: ((seed + index) % 35 + 5) * 60_000,
    total: 5 + index,
    solved: index % 6,
    attempts: 6 + index,
    correctMoves: index % 6,
    accuracy: (index * 13 + seed) % 101,
  }));
  return {
    name: "Scenario " + seed,
    rating,
    puzzleRating: 400 + (seed * 23) % 2801,
    puzzleRatingHistory,
    games,
    wins,
    losses,
    draws,
    qualifyingBotGames: seed % 100,
    history,
    reviews,
    puzzles,
    trainingSessions,
  };
}

assert.equal(clampSuiteNumber(-20, 0, 100), 0);
assert.equal(clampSuiteNumber(500, 0, 100), 100);
assert.equal(clampSuiteNumber("bad", 0, 100, 17), 17);
assert.equal(formatSuiteBytes(512), "512 Б");
assert.equal(formatSuiteBytes(2048), "2 КБ");
assert.equal(formatSuiteDuration(135), "2 ч 15 мин.");
assert.equal(getConnectionQuality(null, false), "offline");
assert.equal(getConnectionQuality(80, true), "good");
assert.equal(getConnectionQuality(400, true), "fair");
assert.equal(getConnectionQuality(900, true), "poor");
assert.equal(getRetryDelay(0), 500);
assert.ok(getRetryDelay(4) >= getRetryDelay(3));
assert.equal(getOnlinePollDelay({ online: false, visible: true, consecutiveFailures: 0 }), 5000);
assert.equal(getOnlinePollDelay({ online: true, visible: false, consecutiveFailures: 0 }), 5000);
assert.equal(getOnlinePollDelay({ online: true, visible: true, consecutiveFailures: 0 }), 1000);
assert.equal(getOnlinePollDelay({ online: true, visible: true, consecutiveFailures: 0, urgent: true }), 250);
assert.ok(getOnlinePollDelay({ online: true, visible: true, consecutiveFailures: 4 }) >
  getOnlinePollDelay({ online: true, visible: true, consecutiveFailures: 3 }));
assert.equal(calculateReviewConfidence([], 3), 0);
assert.ok(calculateReviewConfidence([8, 12, 18], 2) >= 0);
assert.ok(calculateReviewConfidence([8, 12, 18], 2) <= 100);

let previousLevelXp = 0;
for (let xp = 0; xp <= 100_000; xp += 137) {
  const level = getQuestLevel(xp);
  assert.ok(level.level >= 1);
  assert.ok(level.progressPercent >= 0 && level.progressPercent <= 100);
  assert.ok(level.nextLevelXp > 0);
  if (xp > 0) assert.ok(level.level >= previousLevelXp);
  previousLevelXp = level.level;
}

const normalized = normalizeSuiteSettings({
  compactMode: true, reducedMotion: true, largeText: true,
  totalXp: -100, claimedQuestKeys: ["ok", "ok", 4, "x".repeat(150)],
});
assert.equal(normalized.compactMode, true);
assert.equal(normalized.largeText, true);
assert.equal(normalized.totalXp, 0);
assert.deepEqual(normalized.claimedQuestKeys, ["ok"]);
assert.deepEqual(parseSuiteSettings(serializeSuiteSettings(normalized)), normalized);
assert.deepEqual(parseSuiteSettings("{broken"), normalizeSuiteSettings(null));

for (let seed = 0; seed < 15_000; seed++) {
  const profile = makeProfile(seed);
  const metrics = getProfileMetrics(profile);
  const total = profile.wins + profile.losses + profile.draws;

  assert.equal(metrics.games, total, "Games counter must be consistent");
  assert.ok(metrics.winRate >= 0 && metrics.winRate <= 100);
  assert.ok(metrics.drawRate >= 0 && metrics.drawRate <= 100);
  assert.ok(metrics.lossRate >= 0 && metrics.lossRate <= 100);
  if (total > 0) assert.ok(Math.abs(metrics.winRate + metrics.drawRate + metrics.lossRate - 100) < 0.0001);
  assert.ok(metrics.peakRating >= profile.rating);
  assert.ok(metrics.solvedPuzzleCount >= 0);
  assert.ok(metrics.puzzleBacklog >= 0);
  assert.ok(metrics.trainingMinutes >= 0);
  assert.ok(metrics.currentForm.length <= 5);
  if (metrics.averageAccuracy !== null) assert.ok(metrics.averageAccuracy >= 0 && metrics.averageAccuracy <= 100);
  if (metrics.recentAccuracy !== null) assert.ok(metrics.recentAccuracy >= 0 && metrics.recentAccuracy <= 100);
  if (metrics.weakestPhase) assert.ok(metrics.weakestPhase.accuracy >= 0 && metrics.weakestPhase.accuracy <= 100);

  const board = buildQuestBoard(profile, NOW, normalized);
  assert.equal(board.total, 7);
  assert.ok(board.completed >= 0 && board.completed <= board.total);
  assert.ok(board.claimableXp >= 0);
  for (const quest of [...board.daily, ...board.weekly]) {
    assert.ok(quest.progress >= 0 && quest.progress <= quest.target);
    assert.equal(quest.completed, quest.progress >= quest.target);
    const claimed = claimQuestReward(normalized, quest);
    if (!quest.completed || quest.claimed) {
      assert.equal(claimed.granted, false);
      assert.equal(claimed.settings.totalXp, normalized.totalXp);
    } else {
      assert.equal(claimed.granted, true);
      assert.equal(claimed.settings.totalXp, normalized.totalXp + quest.xp);
      const duplicate = claimQuestReward(claimed.settings, quest);
      assert.equal(duplicate.granted, false);
      assert.equal(duplicate.settings.totalXp, claimed.settings.totalXp);
    }
  }

  const dashboard = buildSuiteDashboard(profile, NOW, normalized);
  assert.equal(dashboard.quests.dayKey.length, 10);
  assert.equal(dashboard.quests.weekKey.length, 10);
  assert.ok(getQuestCompletionPercent(dashboard.quests) >= 0 && getQuestCompletionPercent(dashboard.quests) <= 100);
  const trend = getReviewTrend(profile);
  assert.ok(trend.length <= 10);
  for (let index = 1; index < trend.length; index++) {
    assert.ok(trend[index].at >= trend[index - 1].at, "Review trend must be chronological");
  }
  assert.ok(getPeakRating(profile) >= profile.rating);
}

console.log("Systems Hub validation passed: 15,000 deterministic profile, quest, rating, XP, and review-trend scenarios.");
