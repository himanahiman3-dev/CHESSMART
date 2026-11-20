import assert from "node:assert/strict";
import {
  awardPuzzleJourneyPoints,
  getPuzzleJourneyProgress,
  PUZZLE_JOURNEY_TIERS,
} from "../src/lib/puzzleJourney.ts";

const emptyProgress = getPuzzleJourneyProgress(0);
assert.equal(emptyProgress.tierName, "Новичок");
assert.equal(emptyProgress.level, 1);
assert.equal(emptyProgress.pointsInLevel, 0);
assert.equal(emptyProgress.pointsForLevel, 80);

const award = awardPuzzleJourneyPoints({
  state: {
    journeyPoints: 0,
    dailyQuestDate: "2026-11-20",
    dailyQuestSolved: 2,
    hardestPuzzleRating: 1500,
    bestStreak: 3,
    journeyMilestones: [],
  },
  puzzleRating: 1900,
  playerRating: 1200,
  solveSeconds: 45,
  dateKey: "2026-11-20",
  uniqueSolvedCount: 10,
  streak: 5,
  firstSolve: true,
});
assert.equal(award.state.dailyQuestSolved, 3);
assert.equal(award.state.hardestPuzzleRating, 1900);
assert.equal(award.state.bestStreak, 5);
assert.deepEqual(award.state.journeyMilestones, [10]);
assert.equal(award.pointsAwarded, 156);
assert.equal(award.state.journeyPoints, 156);
assert.ok(award.bonuses.some((value) => value.includes("Ежедневная цель")));
assert.ok(award.bonuses.some((value) => value.includes("Новый рекорд")));
assert.ok(award.bonuses.some((value) => value.includes("Рубеж 10")));

const repeat = awardPuzzleJourneyPoints({
  state: award.state,
  puzzleRating: 1900,
  playerRating: 1200,
  solveSeconds: 30,
  dateKey: "2026-11-20",
  uniqueSolvedCount: 10,
  streak: 6,
  firstSolve: false,
});
assert.equal(repeat.pointsAwarded, 0);
assert.equal(repeat.state.journeyPoints, award.state.journeyPoints);
assert.equal(repeat.state.dailyQuestSolved, 3);
assert.equal(repeat.state.bestStreak, 6, "best streak still tracks repeated practice");

const nextDay = awardPuzzleJourneyPoints({
  state: award.state,
  puzzleRating: 1100,
  playerRating: 1200,
  solveSeconds: 300,
  dateKey: "2026-11-21",
  uniqueSolvedCount: 11,
  streak: 1,
  firstSolve: true,
});
assert.equal(nextDay.state.dailyQuestDate, "2026-11-21");
assert.equal(nextDay.state.dailyQuestSolved, 1);
assert.ok(!nextDay.bonuses.some((value) => value.includes("Ежедневная цель")));

const exactTier = getPuzzleJourneyProgress(80);
assert.equal(exactTier.level, 2);
assert.equal(exactTier.pointsInLevel, 0);
assert.equal(PUZZLE_JOURNEY_TIERS.length, 8);

console.log("Puzzle Journey: tier progression, first-solve XP, speed/streak/record bonuses, daily quest and milestones passed.");
