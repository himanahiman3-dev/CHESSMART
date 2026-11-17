import assert from "node:assert/strict";
import {
  academyDayKey,
  analyzeTrainingWeaknesses,
  buildAcademyDashboard,
  buildDailyTasks,
  buildTrainingRecommendations,
  calculateStudyStreak,
  normalizeAcademySettings,
  parseAcademySettings,
  serializeAcademySettings,
} from "../src/lib/trainingAcademy.ts";

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);

function emptyProfile() {
  return {
    name: "Tester",
    rating: 1200,
    puzzleRating: 1200,
    puzzleRatingHistory: [],
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    qualifyingBotGames: 0,
    history: [],
    reviews: [],
    puzzles: [],
    trainingSessions: [],
  };
}

function makeReview(id, at, accuracy, phase = "middlegame", moves = 12) {
  const phases = {
    opening: { w: { accuracy: 0, moves: 0 }, b: { accuracy: 0, moves: 0 } },
    middlegame: { w: { accuracy: 0, moves: 0 }, b: { accuracy: 0, moves: 0 } },
    endgame: { w: { accuracy: 0, moves: 0 }, b: { accuracy: 0, moves: 0 } },
  };
  phases[phase] = {
    w: { accuracy, moves },
    b: { accuracy: accuracy + 2, moves },
  };
  return {
    id,
    at,
    white: "Tester",
    black: "Opponent",
    result: "*",
    date: "2026-11-17",
    plies: moves * 2,
    accuracy: { w: accuracy, b: accuracy + 2, average: accuracy + 1 },
    phases,
    brilliantMoves: [],
    missedWins: [],
  };
}

function makePuzzle(id, createdAt, comment, cls = "mistake", solvedAt) {
  return {
    id,
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    color: "w",
    bestUci: "e2e4",
    bestSan: "e4",
    playedSan: "d4",
    cls,
    comment,
    sourceGame: "Tester — Opponent",
    moveNumber: 8,
    createdAt,
    attempts: 1,
    solvedAt,
  };
}

function makeSession(id, startedAt, durationMs = 600000) {
  return {
    id,
    category: "mistakes",
    label: "Тестовая тренировка",
    startedAt,
    durationMs,
    total: 5,
    solved: 4,
    attempts: 5,
    correctMoves: 4,
    accuracy: 80,
  };
}

const empty = emptyProfile();
const emptyDashboard = buildAcademyDashboard(empty, NOW);
assert.equal(emptyDashboard.activity.length, 84);
assert.equal(emptyDashboard.averageAccuracy, null);
assert.equal(emptyDashboard.todayKey, academyDayKey(NOW));
assert.equal(emptyDashboard.tasks.length, 3);
assert.equal(emptyDashboard.tasks[0].destination, "review");
assert.equal(emptyDashboard.weekly.progressPercent, 0);
assert.ok(emptyDashboard.recommendations.some((item) => item.id === "first-review"));

const sevenDayProfile = emptyProfile();
for (let day = 0; day < 7; day += 1) {
  sevenDayProfile.reviews.push(makeReview("streak-" + day, NOW - day * 86400000, 75));
}
const streak = calculateStudyStreak(sevenDayProfile, NOW);
assert.equal(streak.current, 7);
assert.equal(streak.longest, 7);
assert.equal(streak.activeDays30, 7);
assert.equal(streak.totalActiveDays, 7);

const yesterdayProfile = emptyProfile();
yesterdayProfile.trainingSessions.push(makeSession("yesterday", NOW - 86400000));
assert.equal(calculateStudyStreak(yesterdayProfile, NOW).current, 1, "A session yesterday preserves the current streak.");

const rich = emptyProfile();
rich.reviews.push(makeReview("game-1", NOW - 6 * 3600000, 48, "endgame", 20));
rich.reviews.push(makeReview("game-2", NOW - 8 * 3600000, 62, "endgame", 10));
rich.puzzles.push(makePuzzle("fork-1", NOW - 5 * 86400000, "Зевает вилку: соперник одновременно атакует две фигуры.", "blunder"));
rich.puzzles.push(makePuzzle("fork-2", NOW - 4 * 86400000, "Не заметил двойной удар и теряет фигуру.", "mistake", NOW - 86400000));
rich.trainingSessions.push(makeSession("session-1", NOW - 86400000, 900000));
rich.history.push({ at: NOW - 86400000, result: "win", botElo: 1200, change: 8, ratingAfter: 1208 });

const weaknesses = analyzeTrainingWeaknesses(rich);
assert.ok(weaknesses.some((item) => item.title === "Эндшпиль"));
assert.ok(weaknesses.some((item) => item.title === "Вилки и двойные удары"));
assert.ok(weaknesses.every((item) => item.sourceCount > 0 && Number.isFinite(item.score)));

const recommendations = buildTrainingRecommendations(rich, NOW, weaknesses);
assert.ok(recommendations.some((item) => item.destination === "mistakes"));
assert.ok(recommendations.some((item) => item.destination === "endgame"));
assert.equal(new Set(recommendations.map((item) => item.destination)).size, recommendations.length);

const dailyTasks = buildDailyTasks(rich, 5, weaknesses);
assert.ok(dailyTasks.some((item) => item.destination === "mistakes"));
assert.ok(dailyTasks.some((item) => item.destination === "puzzles"));
assert.ok(dailyTasks.length <= 3);

const richDashboard = buildAcademyDashboard(rich, NOW, { weeklySessionsTarget: 4, dailyPuzzleTarget: 5, completedTaskKeys: [] });
assert.equal(richDashboard.averageAccuracy, 56);
assert.equal(richDashboard.weekly.sessions, 1);
assert.equal(richDashboard.weekly.solvedPuzzles, 1);
assert.equal(richDashboard.weekly.reviewedGames, 2);
assert.equal(richDashboard.weekly.minutes, 15);
assert.equal(richDashboard.weekly.progressPercent, 25);
assert.ok(richDashboard.achievements.find((item) => item.id === "first-review")?.unlocked);
assert.ok(richDashboard.achievements.find((item) => item.id === "first-session")?.unlocked);
assert.equal(richDashboard.activity.filter((day) => day.total > 0).length, 2);

const settings = normalizeAcademySettings({ weeklySessionsTarget: 99, dailyPuzzleTarget: -3, completedTaskKeys: ["2026-11-17:task", "2026-11-17:task", 7] });
assert.equal(settings.weeklySessionsTarget, 14);
assert.equal(settings.dailyPuzzleTarget, 1);
assert.deepEqual(settings.completedTaskKeys, ["2026-11-17:task"]);
assert.deepEqual(parseAcademySettings(serializeAcademySettings(settings)), settings);
assert.equal(parseAcademySettings("{broken").weeklySessionsTarget, 5);
assert.equal(normalizeAcademySettings(null).dailyPuzzleTarget, 3);

const puzzleBankOnly = emptyProfile();
puzzleBankOnly.puzzleRatingHistory.push({
  at: NOW,
  puzzleId: "lichess-001",
  mode: "daily",
  solved: true,
  change: 12,
  ratingAfter: 1212,
});
const bankDashboard = buildAcademyDashboard(puzzleBankOnly, NOW);
assert.equal(bankDashboard.solvedPuzzleCount, 1);
assert.equal(bankDashboard.unsolvedPuzzleCount, 0);
assert.equal(bankDashboard.weekly.solvedPuzzles, 1);
assert.equal(bankDashboard.streak.current, 1);

for (let index = 0; index < 15000; index += 1) {
  const profile = emptyProfile();
  const ageDays = index % 84;
  const stamp = NOW - ageDays * 86400000;
  const reviewCount = index % 4;
  const puzzleCount = index % 7;
  const sessionCount = index % 3;

  for (let i = 0; i < reviewCount; i += 1) {
    const phase = ["opening", "middlegame", "endgame"][(index + i) % 3];
    profile.reviews.push(makeReview("stress-r-" + index + "-" + i, stamp - i * 86400000, (index * 7 + i * 13) % 101, phase, 4 + (index + i) % 30));
  }
  for (let i = 0; i < puzzleCount; i += 1) {
    const solvedAt = (index + i) % 2 === 0 ? stamp - i * 3600000 : undefined;
    const comment = ["вилка", "связка", "зевнул фигуру", "упустил возможность", "эндшпиль"][i % 5];
    const cls = ["inaccuracy", "mistake", "miss", "blunder"][(index + i) % 4];
    profile.puzzles.push(makePuzzle("stress-p-" + index + "-" + i, stamp, comment, cls, solvedAt));
  }
  for (let i = 0; i < sessionCount; i += 1) profile.trainingSessions.push(makeSession("stress-s-" + index + "-" + i, stamp - i * 3600000, (i + 1) * 60000));
  if (index % 4 === 0) profile.puzzleRatingHistory.push({ at: stamp, puzzleId: "bank-" + index, mode: "daily", solved: true, change: 8, ratingAfter: 1208 });
  if (index % 5 === 0) profile.history.push({ at: stamp, result: "draw", botElo: 1000, change: 0, ratingAfter: 1000 });

  const variedSettings = normalizeAcademySettings({
    weeklySessionsTarget: index % 18,
    dailyPuzzleTarget: index % 25,
    completedTaskKeys: ["2026-11-17:one", index % 2 === 0 ? "2026-11-17:two" : "2026-11-17:one"],
  });
  const dashboard = buildAcademyDashboard(profile, NOW, variedSettings);

  assert.equal(dashboard.activity.length, 84, "The heatmap always contains twelve weeks.");
  assert.equal(dashboard.todayKey, academyDayKey(NOW));
  assert.ok(dashboard.streak.current >= 0 && dashboard.streak.longest >= dashboard.streak.current);
  assert.ok(dashboard.streak.activeDays30 >= 0 && dashboard.streak.activeDays30 <= dashboard.streak.totalActiveDays);
  assert.ok(dashboard.weekly.progressPercent >= 0 && dashboard.weekly.progressPercent <= 100);
  assert.ok(dashboard.weekly.targetSessions >= 1 && dashboard.weekly.targetSessions <= 14);
  assert.ok(dashboard.solvedPuzzleCount >= 0 && dashboard.unsolvedPuzzleCount >= 0);
  assert.ok(dashboard.tasks.length <= 3 && dashboard.recommendations.length <= 4);
  assert.ok(dashboard.activity.every((day) => day.total >= 0));
  assert.ok(dashboard.achievements.every((item) => item.progress >= 0 && item.progress <= item.target));
  assert.ok(dashboard.averageAccuracy === null || (Number.isFinite(dashboard.averageAccuracy) && dashboard.averageAccuracy >= 0 && dashboard.averageAccuracy <= 100));
}

console.log("Training Academy validated: core scenarios passed + 15,000 deterministic profile scenarios.");
