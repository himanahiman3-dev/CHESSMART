import type { PlayerProfile, RatingEntry, TrainingPuzzle, TrainingSessionSummary } from "./playerProfile";
import type { BrilliantMoveSummary, ReviewSummary } from "./learningStats";

const FORMAT = "chess-review-profile";
const PUZZLE_CLASSES = new Set(["inaccuracy", "mistake", "miss", "blunder"]);
const RESULTS = new Set(["win", "loss", "draw"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validColor(value: unknown): value is "w" | "b" {
  return value === "w" || value === "b";
}

function validBrilliantMove(value: unknown): value is BrilliantMoveSummary {
  return isRecord(value)
    && validColor(value.color)
    && finite(value.moveNumber)
    && typeof value.san === "string"
    && typeof value.comment === "string";
}

function validPhaseSide(value: unknown): boolean {
  return isRecord(value) && finite(value.accuracy) && finite(value.moves);
}

function validReview(value: unknown): value is ReviewSummary {
  if (!isRecord(value) || !isRecord(value.accuracy) || !isRecord(value.phases)) return false;
  const accuracy = value.accuracy;
  const phases = value.phases;
  const validAccuracy = finite(accuracy.w) && finite(accuracy.b) && finite(accuracy.average);
  const validPhases = (["opening", "middlegame", "endgame"] as const).every((phase) => {
    const item = phases[phase];
    return isRecord(item) && validPhaseSide(item.w) && validPhaseSide(item.b);
  });
  const validOptionalOpening = value.opening === undefined
    || (isRecord(value.opening) && typeof value.opening.eco === "string" && typeof value.opening.name === "string");
  return typeof value.id === "string"
    && finite(value.at)
    && typeof value.white === "string"
    && typeof value.black === "string"
    && typeof value.result === "string"
    && typeof value.date === "string"
    && finite(value.plies)
    && validAccuracy
    && validPhases
    && validOptionalOpening
    && Array.isArray(value.brilliantMoves)
    && value.brilliantMoves.every(validBrilliantMove)
    && Array.isArray(value.missedWins)
    && value.missedWins.every(validBrilliantMove);
}

function validRatingEntry(value: unknown): value is RatingEntry {
  return isRecord(value)
    && finite(value.at)
    && typeof value.result === "string"
    && RESULTS.has(value.result)
    && finite(value.botElo)
    && finite(value.change)
    && finite(value.ratingAfter);
}

function validPuzzle(value: unknown): value is TrainingPuzzle {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.fen === "string"
    && validColor(value.color)
    && typeof value.bestUci === "string"
    && typeof value.playedSan === "string"
    && typeof value.cls === "string"
    && PUZZLE_CLASSES.has(value.cls)
    && typeof value.comment === "string"
    && typeof value.sourceGame === "string"
    && finite(value.moveNumber)
    && finite(value.createdAt)
    && finite(value.attempts)
    && (value.solvedAt === undefined || finite(value.solvedAt));
}

function validTrainingSession(value: unknown): value is TrainingSessionSummary {
  return isRecord(value)
    && typeof value.id === "string"
    && finite(value.startedAt)
    && finite(value.durationMs)
    && finite(value.total)
    && finite(value.solved)
    && finite(value.attempts)
    && finite(value.correctMoves)
    && finite(value.accuracy)
    && value.total >= 0
    && value.solved >= 0
    && value.solved <= value.total
    && value.attempts >= 0
    && value.correctMoves >= 0
    && value.correctMoves <= value.attempts
    && value.accuracy >= 0
    && value.accuracy <= 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Проверяет структуру файла и восстанавливает только корректные записи профиля. */
export function parseProfileBackup(source: string): PlayerProfile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("Файл резервной копии не является корректным JSON.");
  }
  if (!isRecord(parsed) || parsed.format !== FORMAT || parsed.version !== 1 || !isRecord(parsed.profile)) {
    throw new Error("Это не резервная копия Chess Review или её версия не поддерживается.");
  }

  const raw = parsed.profile;
  if (
    typeof raw.name !== "string"
    || !finite(raw.rating)
    || !finite(raw.games)
    || !finite(raw.wins)
    || !finite(raw.losses)
    || !finite(raw.draws)
    || !finite(raw.qualifyingBotGames)
    || !Array.isArray(raw.history)
    || !Array.isArray(raw.reviews)
    || !Array.isArray(raw.puzzles)
  ) {
    throw new Error("В резервной копии отсутствуют обязательные данные профиля.");
  }

  return {
    name: raw.name.trim().slice(0, 24) || "Игрок",
    rating: clamp(Math.round(raw.rating), 100, 3200),
    games: Math.max(0, Math.floor(raw.games)),
    wins: Math.max(0, Math.floor(raw.wins)),
    losses: Math.max(0, Math.floor(raw.losses)),
    draws: Math.max(0, Math.floor(raw.draws)),
    qualifyingBotGames: Math.max(0, Math.floor(raw.qualifyingBotGames)),
    history: raw.history.filter(validRatingEntry).slice(-100),
    reviews: raw.reviews.filter(validReview).slice(-100),
    puzzles: raw.puzzles.filter(validPuzzle).slice(-300),
    trainingSessions: Array.isArray(raw.trainingSessions) ? raw.trainingSessions.filter(validTrainingSession).slice(-100) : [],
  };
}

/** Скачивает локальную резервную копию всего профиля в формате JSON. */
export function downloadProfileBackup(profile: PlayerProfile): void {
  const backup = {
    format: FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    profile,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `chess-review-profile-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
