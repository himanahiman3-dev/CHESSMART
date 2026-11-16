import type { GameReview, Color } from "../types";
import { summarizeReview, type ReviewSummary } from "./learningStats";

export interface RatingEntry {
  at: number;
  result: "win" | "loss" | "draw";
  botElo: number;
  change: number;
  ratingAfter: number;
}

export interface TrainingPuzzle {
  id: string;
  fen: string;
  color: Color;
  bestUci: string;
  bestSan?: string;
  playedSan: string;
  cls: "inaccuracy" | "mistake" | "miss" | "blunder";
  comment: string;
  sourceGame: string;
  moveNumber: number;
  createdAt: number;
  attempts: number;
  solvedAt?: number;
}

export interface PlayerProfile {
  name: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  qualifyingBotGames: number;
  history: RatingEntry[];
  reviews: ReviewSummary[];
  puzzles: TrainingPuzzle[];
}

const STORAGE_KEY = "chess-review:player-profile:v1";
const DEFAULT_PROFILE: PlayerProfile = {
  name: "Игрок",
  rating: 1000,
  games: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  qualifyingBotGames: 0,
  history: [],
  reviews: [],
  puzzles: [],
};

export function loadPlayerProfile(): PlayerProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PROFILE, history: [], reviews: [], puzzles: [] };
    const value = JSON.parse(raw) as Partial<PlayerProfile>;
    return {
      ...DEFAULT_PROFILE,
      ...value,
      rating: clamp(Math.round(Number(value.rating) || 1000), 100, 3200),
      history: Array.isArray(value.history) ? value.history.slice(-100) : [],
      reviews: Array.isArray(value.reviews) ? value.reviews.slice(-100) : [],
      puzzles: Array.isArray(value.puzzles) ? value.puzzles.slice(-300) : [],
    };
  } catch {
    return { ...DEFAULT_PROFILE, history: [], reviews: [], puzzles: [] };
  }
}

export function savePlayerProfile(profile: PlayerProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Private mode / storage quota must not break game play.
  }
}

export function updatePlayerName(profile: PlayerProfile, name: string): PlayerProfile {
  return { ...profile, name: name.trim().slice(0, 24) || "Игрок" };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function recordReviewedGame(profile: PlayerProfile, review: GameReview): PlayerProfile {
  const summary = summarizeReview(review);
  const reviews = [...profile.reviews.filter((item) => item.id !== summary.id), summary].slice(-100);
  const oldPuzzleById = new Map(profile.puzzles.map((puzzle) => [puzzle.id, puzzle]));
  const generated: TrainingPuzzle[] = review.moves
    .filter((move) => ["inaccuracy", "mistake", "miss", "blunder"].includes(move.cls) && !!move.bestUci && move.bestUci !== move.uci)
    .map((move) => {
      const id = `${summary.id}:${move.index}`;
      const old = oldPuzzleById.get(id);
      return {
        id,
        fen: move.fenBefore,
        color: move.color,
        bestUci: move.bestUci!,
        bestSan: move.bestSan,
        playedSan: move.san,
        cls: move.cls as TrainingPuzzle["cls"],
        comment: move.comment,
        sourceGame: `${summary.white} — ${summary.black}`,
        moveNumber: Math.floor(move.index / 2) + 1,
        createdAt: old?.createdAt ?? Date.now(),
        attempts: old?.attempts ?? 0,
        solvedAt: old?.solvedAt,
      };
    });
  const puzzles = [...profile.puzzles.filter((puzzle) => !puzzle.id.startsWith(`${summary.id}:`)), ...generated].slice(-300);
  return { ...profile, reviews, puzzles };
}

export function markPuzzleSolved(profile: PlayerProfile, puzzleId: string): PlayerProfile {
  return {
    ...profile,
    puzzles: profile.puzzles.map((puzzle) =>
      puzzle.id === puzzleId ? { ...puzzle, solvedAt: puzzle.solvedAt ?? Date.now() } : puzzle
    ),
  };
}

export function recordPuzzleAttempt(profile: PlayerProfile, puzzleId: string): PlayerProfile {
  return {
    ...profile,
    puzzles: profile.puzzles.map((puzzle) => puzzle.id === puzzleId ? { ...puzzle, attempts: puzzle.attempts + 1 } : puzzle),
  };
}

/**
 * Кастомная система рейтинга против встроенных ботов.
 * За поражения и ничьи рейтинг не снимается.
 */
export function recordBotGame(
  profile: PlayerProfile,
  botElo: number,
  result: "win" | "loss" | "draw"
): { profile: PlayerProfile; ratingChange: number; message: string } {
  const next: PlayerProfile = {
    ...profile,
    games: profile.games + 1,
    wins: profile.wins + (result === "win" ? 1 : 0),
    losses: profile.losses + (result === "loss" ? 1 : 0),
    draws: profile.draws + (result === "draw" ? 1 : 0),
  };

  let gain = 0;
  let message = result === "win" ? "Победа!" : result === "draw" ? "Ничья." : "Поражение.";
  if (result === "win" && botElo >= 700) {
    const gap = botElo - profile.rating;
    const specialHigherBot = gap >= 200;
    const protected1300Band = botElo >= 1300 && profile.rating < 1500;
    if (specialHigherBot) gain = 10 + clamp(Math.floor((gap - 200) / 150), 0, 10);
    else if (protected1300Band) gain = 10;
    else {
      const stage = Math.floor(profile.qualifyingBotGames / 3);
      gain = stage === 0 ? 10 : stage === 1 ? 7 : stage === 2 ? 5 : 1;
    }
    next.rating = clamp(profile.rating + gain, 100, 3200);
    message = `Победа! +${gain} Elo`;
  }
  if (botElo >= 700 && !(botElo >= 1300 && profile.rating < 1500)) {
    next.qualifyingBotGames = profile.qualifyingBotGames + 1;
  }
  next.history = [
    ...profile.history,
    { at: Date.now(), result, botElo, change: gain, ratingAfter: next.rating },
  ].slice(-100);
  return { profile: next, ratingChange: gain, message };
}

export const BOT_DIFFICULTIES = [
  { id: "beginner", label: "100–300 · Начинающий", elo: 200 },
  { id: "novice", label: "400–600 · Новичок", elo: 500 },
  { id: "casual", label: "700–1000 · Любитель", elo: 850 },
  { id: "club", label: "1100–1300 · Средний любитель", elo: 1200 },
  { id: "advanced", label: "1400–1700 · Продвинутый", elo: 1550 },
  { id: "tournament", label: "1800–2000 · Турнирный игрок", elo: 1900 },
  { id: "maximum", label: "2100–3000 · Максимальный", elo: 2500 },
] as const;

export interface BotStrength {
  skillLevel: number;
  limitStrength: boolean;
  elo?: number;
  depth: number;
  movetimeMs: number;
}

/** Для значений ниже 1320 используется Skill Level; UCI_Elo ограничиваем поддерживаемым диапазоном. */
export function botStrengthForElo(elo: number): BotStrength {
  if (elo <= 300) return { skillLevel: 0, limitStrength: false, depth: 2, movetimeMs: 250 };
  if (elo <= 600) return { skillLevel: 1, limitStrength: false, depth: 3, movetimeMs: 350 };
  if (elo <= 1000) return { skillLevel: 3, limitStrength: false, depth: 5, movetimeMs: 550 };
  if (elo <= 1300) return { skillLevel: 5, limitStrength: false, depth: 7, movetimeMs: 750 };
  if (elo <= 1700) return { skillLevel: 20, limitStrength: true, elo: clamp(elo, 1320, 3190), depth: 9, movetimeMs: 1000 };
  if (elo <= 2000) return { skillLevel: 20, limitStrength: true, elo: clamp(elo, 1320, 3190), depth: 11, movetimeMs: 1300 };
  return { skillLevel: 20, limitStrength: true, elo: clamp(elo, 1320, 3190), depth: 13, movetimeMs: 1600 };
}
