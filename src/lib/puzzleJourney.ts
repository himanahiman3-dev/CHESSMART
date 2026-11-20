export interface PuzzleJourneyStats {
  journeyPoints: number;
  dailyQuestDate: string;
  dailyQuestSolved: number;
  hardestPuzzleRating: number;
  bestStreak: number;
  journeyMilestones: number[];
}

export interface PuzzleJourneyProgress {
  tierIndex: number;
  tierName: string;
  level: number;
  pointsInLevel: number;
  pointsForLevel: number;
  progressPercent: number;
  completed: boolean;
}

export interface PuzzleSolveJourneyInput {
  state: PuzzleJourneyStats;
  puzzleRating: number;
  playerRating: number;
  solveSeconds: number;
  dateKey: string;
  uniqueSolvedCount: number;
  streak: number;
  firstSolve: boolean;
}

export interface PuzzleSolveJourneyResult {
  state: PuzzleJourneyStats;
  pointsAwarded: number;
  bonuses: string[];
}

export const EMPTY_PUZZLE_JOURNEY: PuzzleJourneyStats = {
  journeyPoints: 0,
  dailyQuestDate: "",
  dailyQuestSolved: 0,
  hardestPuzzleRating: 0,
  bestStreak: 0,
  journeyMilestones: [],
};

export const PUZZLE_JOURNEY_TIERS = [
  "Новичок",
  "Искатель",
  "Тактик",
  "Комбинатор",
  "Стратег",
  "Мастер",
  "Гроссмейстер",
  "Легенда",
] as const;

const LEVELS_PER_TIER = 20;
const MILESTONES = [10, 25, 50, 100, 250, 500, 1000] as const;

function levelCost(tierIndex: number, levelIndex: number): number {
  return 80 + tierIndex * 20 + levelIndex * 6;
}

function safeNonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function getPuzzleJourneyProgress(points: number): PuzzleJourneyProgress {
  let remaining = safeNonNegativeInteger(points);
  for (let tierIndex = 0; tierIndex < PUZZLE_JOURNEY_TIERS.length; tierIndex++) {
    for (let levelIndex = 0; levelIndex < LEVELS_PER_TIER; levelIndex++) {
      const required = levelCost(tierIndex, levelIndex);
      if (remaining < required) {
        return {
          tierIndex,
          tierName: PUZZLE_JOURNEY_TIERS[tierIndex],
          level: levelIndex + 1,
          pointsInLevel: remaining,
          pointsForLevel: required,
          progressPercent: Math.round((remaining / required) * 100),
          completed: false,
        };
      }
      remaining -= required;
    }
  }

  return {
    tierIndex: PUZZLE_JOURNEY_TIERS.length - 1,
    tierName: PUZZLE_JOURNEY_TIERS[PUZZLE_JOURNEY_TIERS.length - 1],
    level: LEVELS_PER_TIER,
    pointsInLevel: levelCost(PUZZLE_JOURNEY_TIERS.length - 1, LEVELS_PER_TIER - 1),
    pointsForLevel: levelCost(PUZZLE_JOURNEY_TIERS.length - 1, LEVELS_PER_TIER - 1),
    progressPercent: 100,
    completed: true,
  };
}

export function awardPuzzleJourneyPoints(input: PuzzleSolveJourneyInput): PuzzleSolveJourneyResult {
  const previous = input.state;
  const dailyBase = previous.dailyQuestDate === input.dateKey
    ? Math.min(3, safeNonNegativeInteger(previous.dailyQuestSolved))
    : 0;

  const refreshedState: PuzzleJourneyStats = {
    ...previous,
    journeyPoints: safeNonNegativeInteger(previous.journeyPoints),
    dailyQuestDate: input.dateKey,
    dailyQuestSolved: dailyBase,
    hardestPuzzleRating: safeNonNegativeInteger(previous.hardestPuzzleRating),
    bestStreak: safeNonNegativeInteger(previous.bestStreak),
    journeyMilestones: Array.isArray(previous.journeyMilestones)
      ? previous.journeyMilestones.filter((value) => Number.isInteger(value) && value > 0)
      : [],
  };

  // Repeated tasks and revealed answers can still be practised, but cannot farm journey XP.
  if (!input.firstSolve) {
    return {
      state: {
        ...refreshedState,
        bestStreak: Math.max(refreshedState.bestStreak, safeNonNegativeInteger(input.streak)),
      },
      pointsAwarded: 0,
      bonuses: [],
    };
  }

  const puzzleRating = Math.max(0, safeNonNegativeInteger(input.puzzleRating));
  const playerRating = Math.max(0, safeNonNegativeInteger(input.playerRating));
  const ratingGap = puzzleRating - playerRating;
  const basePoints = ratingGap >= 350 ? 30 : ratingGap >= 100 ? 22 : ratingGap >= -100 ? 16 : 10;
  const targetSeconds = puzzleRating < 1200 ? 60 : puzzleRating < 1800 ? 90 : 120;
  const speedBonus = input.solveSeconds > 0 && input.solveSeconds <= targetSeconds ? 8 : 0;
  const streak = safeNonNegativeInteger(input.streak);
  const streakBonus = Math.min(20, Math.max(0, streak - 1) * 2);
  const newRecord = puzzleRating > refreshedState.hardestPuzzleRating;
  const recordBonus = newRecord ? 20 : 0;

  const dailyCount = Math.min(3, dailyBase + 1);
  const dailyBonus = dailyBase < 3 && dailyCount === 3 ? 40 : 0;

  const milestone = MILESTONES.find((value) =>
    value === input.uniqueSolvedCount && !refreshedState.journeyMilestones.includes(value)
  );
  const milestoneBonus = milestone ? 50 : 0;

  const bonuses: string[] = [];
  if (speedBonus) bonuses.push("Быстрое решение +8");
  if (streakBonus) bonuses.push("Серия +" + streakBonus);
  if (recordBonus) bonuses.push("Новый рекорд сложности +20");
  if (dailyBonus) bonuses.push("Ежедневная цель 3/3 +40");
  if (milestoneBonus) bonuses.push("Рубеж " + milestone + " задач +50");

  const pointsAwarded = basePoints + speedBonus + streakBonus + recordBonus + dailyBonus + milestoneBonus;
  return {
    state: {
      ...refreshedState,
      journeyPoints: refreshedState.journeyPoints + pointsAwarded,
      dailyQuestSolved: dailyCount,
      hardestPuzzleRating: Math.max(refreshedState.hardestPuzzleRating, puzzleRating),
      bestStreak: Math.max(refreshedState.bestStreak, streak),
      journeyMilestones: milestone
        ? [...refreshedState.journeyMilestones, milestone]
        : refreshedState.journeyMilestones,
    },
    pointsAwarded,
    bonuses: ["Базовые очки +" + basePoints, ...bonuses],
  };
}
