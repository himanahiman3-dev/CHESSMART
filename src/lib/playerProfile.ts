import { emptyCounts, type Cls, type GameReview, type Color } from "../types";
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

export type TrainingSessionCategory = "mistakes" | "endgame";

export interface TrainingSessionSummary {
  id: string;
  category?: TrainingSessionCategory;
  label?: string;
  startedAt: number;
  durationMs: number;
  total: number;
  solved: number;
  attempts: number;
  correctMoves: number;
  accuracy: number;
}

export interface PuzzleRatingEntry {
  at: number;
  puzzleId: string;
  mode: "rated" | "daily" | "themes";
  solved: boolean;
  change: number;
  ratingAfter: number;
}

export interface PersonalGameReviewSummary {
  id: string;
  at: number;
  color: Color;
  opponent: string;
  result: string;
  accuracy: number;
  moves: number;
  counts: Record<Cls, number>;
}

export interface PlayerProfile {
  name: string;
  rating: number;
  puzzleRating: number;
  puzzleRatingHistory: PuzzleRatingEntry[];
  games: number;
  wins: number;
  losses: number;
  draws: number;
  qualifyingBotGames: number;
  history: RatingEntry[];
  reviews: ReviewSummary[];
  puzzles: TrainingPuzzle[];
  trainingSessions: TrainingSessionSummary[];
  /** Анализ качества только собственных ходов в партиях, сыгранных этим игроком. */
  personalReviews?: PersonalGameReviewSummary[];
}

const STORAGE_KEY = "chess-review:player-profile:v1";
const DEFAULT_PROFILE: PlayerProfile = {
  name: "Игрок",
  rating: 1000,
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
  personalReviews: [],
};

function validPuzzleRatingEntry(value: unknown): value is PuzzleRatingEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<PuzzleRatingEntry>;
  return Number.isFinite(entry.at)
    && typeof entry.puzzleId === "string"
    && (entry.mode === "rated" || entry.mode === "daily" || entry.mode === "themes")
    && typeof entry.solved === "boolean"
    && Number.isFinite(entry.change)
    && Number.isFinite(entry.ratingAfter);
}

export function loadPlayerProfile(): PlayerProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PROFILE, history: [], reviews: [], puzzles: [], puzzleRatingHistory: [] };
    const value = JSON.parse(raw) as Partial<PlayerProfile>;
    return {
      ...DEFAULT_PROFILE,
      ...value,
      rating: clamp(Math.round(Number(value.rating) || 1000), 100, 3200),
      puzzleRating: clamp(Math.round(Number(value.puzzleRating) || 1200), 400, 3200),
      puzzleRatingHistory: Array.isArray(value.puzzleRatingHistory)
        ? value.puzzleRatingHistory.filter(validPuzzleRatingEntry).slice(-180)
        : [],
      history: Array.isArray(value.history) ? value.history.slice(-100) : [],
      reviews: Array.isArray(value.reviews) ? value.reviews.slice(-100) : [],
      puzzles: Array.isArray(value.puzzles) ? value.puzzles.slice(-300) : [],
      trainingSessions: Array.isArray(value.trainingSessions) ? value.trainingSessions.slice(-100) : [],
      personalReviews: Array.isArray(value.personalReviews)
        ? value.personalReviews.filter((entry): entry is PersonalGameReviewSummary => {
            if (!entry || typeof entry !== "object") return false;
            const item = entry as Partial<PersonalGameReviewSummary>;
            return typeof item.id === "string"
              && Number.isFinite(item.at)
              && (item.color === "w" || item.color === "b")
              && typeof item.opponent === "string"
              && typeof item.result === "string"
              && Number.isFinite(item.accuracy)
              && Number.isFinite(item.moves)
              && !!item.counts
              && typeof item.counts === "object";
          }).slice(-100)
        : [],
    };
  } catch {
    return { ...DEFAULT_PROFILE, history: [], reviews: [], puzzles: [], puzzleRatingHistory: [] };
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

/**
 * Записывает только ходы стороны пользователя. Импортированные PGN и ходы соперника
 * намеренно не попадают в личные показатели профиля.
 */
export function recordPersonalGameReview(
  profile: PlayerProfile,
  review: GameReview,
  playerColor: Color
): PlayerProfile {
  const summary = summarizeReview(review);
  const playerMoves = review.moves.filter((move) => move.color === playerColor);
  const counts = emptyCounts();
  for (const move of playerMoves) counts[move.cls] += 1;
  const id = `${summary.id}:${playerColor}`;
  const entry: PersonalGameReviewSummary = {
    id,
    at: Date.now(),
    color: playerColor,
    opponent: playerColor === "w" ? summary.black : summary.white,
    result: summary.result,
    accuracy: playerColor === "w" ? review.accuracy.w : review.accuracy.b,
    moves: playerMoves.length,
    counts,
  };
  const personalReviews = [...(profile.personalReviews ?? []).filter((item) => item.id !== id), entry].slice(-100);
  return { ...profile, personalReviews };
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
  { id: "random", label: "100 Elo · Почти случайно", elo: 100 },
  { id: "beginner", label: "200 Elo · Начинающий", elo: 200 },
  { id: "easy", label: "300 Elo · Новичок", elo: 300 },
  { id: "novice", label: "500 Elo · Любитель", elo: 500 },
  { id: "casual", label: "700 Elo · Клубный новичок", elo: 700 },
  { id: "club", label: "900 Elo · Клубный игрок", elo: 900 },
  { id: "intermediate", label: "1100 Elo · Уверенный любитель", elo: 1100 },
  { id: "advanced", label: "1400 Elo · Продвинутый", elo: 1400 },
  { id: "tournament", label: "1800 Elo · Турнирный игрок", elo: 1800 },
  { id: "master", label: "2200 Elo · Мастер", elo: 2200 },
  { id: "maximum", label: "2800 Elo · Сильнейший Stockfish", elo: 2800 },
] as const;

export interface BotStrength {
  skillLevel: number;
  limitStrength: boolean;
  elo?: number;
  depth: number;
  movetimeMs: number;
  multipv: number;
}

/** Нижние уровни ослабляются не только Skill Level, но и отдельным выбором слабых ходов. */
export function botStrengthForElo(elo: number): BotStrength {
  if (elo <= 150) return { skillLevel: 0, limitStrength: false, depth: 4, movetimeMs: 380, multipv: 5 };
  if (elo <= 250) return { skillLevel: 0, limitStrength: false, depth: 5, movetimeMs: 480, multipv: 5 };
  if (elo <= 350) return { skillLevel: 0, limitStrength: false, depth: 5, movetimeMs: 520, multipv: 5 };
  if (elo <= 550) return { skillLevel: 1, limitStrength: false, depth: 6, movetimeMs: 600, multipv: 5 };
  if (elo <= 750) return { skillLevel: 2, limitStrength: false, depth: 7, movetimeMs: 700, multipv: 5 };
  if (elo <= 950) return { skillLevel: 3, limitStrength: false, depth: 8, movetimeMs: 800, multipv: 4 };
  if (elo <= 1150) return { skillLevel: 5, limitStrength: false, depth: 9, movetimeMs: 900, multipv: 4 };
  if (elo <= 1500) return { skillLevel: 8, limitStrength: false, depth: 10, movetimeMs: 1000, multipv: 3 };
  if (elo <= 1800) return { skillLevel: 20, limitStrength: true, elo: 1800, depth: 11, movetimeMs: 1200, multipv: 2 };
  if (elo <= 2300) return { skillLevel: 20, limitStrength: true, elo: 2300, depth: 13, movetimeMs: 1500, multipv: 1 };
  return { skillLevel: 20, limitStrength: true, elo: 2800, depth: 15, movetimeMs: 1900, multipv: 1 };
}
