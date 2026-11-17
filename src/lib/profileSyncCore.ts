import type { PlayerProfile } from "./playerProfile";

export interface ProfileBackupEnvelope {
  format: "chess-review-profile";
  version: 1;
  exportedAt: string;
  profile: PlayerProfile;
}

export interface ProfileSyncSummary {
  games: number;
  analyzedGames: number;
  trainingPositions: number;
  solvedPositions: number;
  trainingSessions: number;
  puzzleRating: number;
  rating: number;
  serializedBytes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Проверяет внешний формат облачной копии и ограничивает размер её коллекций. */
export function isProfileBackupEnvelope(value: unknown): value is ProfileBackupEnvelope {
  if (!isRecord(value) || value.format !== "chess-review-profile" || value.version !== 1) return false;
  if (typeof value.exportedAt !== "string" || !Number.isFinite(Date.parse(value.exportedAt))) return false;
  if (!isRecord(value.profile)) return false;

  const profile = value.profile;
  if (
    typeof profile.name !== "string" || profile.name.length > 24
    || !finite(profile.rating) || profile.rating < 100 || profile.rating > 3200
    || !finite(profile.games) || profile.games < 0
    || !finite(profile.wins) || profile.wins < 0
    || !finite(profile.losses) || profile.losses < 0
    || !finite(profile.draws) || profile.draws < 0
    || !finite(profile.qualifyingBotGames) || profile.qualifyingBotGames < 0
    || !Array.isArray(profile.history) || profile.history.length > 100
    || !Array.isArray(profile.reviews) || profile.reviews.length > 100
    || !Array.isArray(profile.puzzles) || profile.puzzles.length > 300
    || (profile.trainingSessions !== undefined && (!Array.isArray(profile.trainingSessions) || profile.trainingSessions.length > 100))
    || (profile.puzzleRatingHistory !== undefined && (!Array.isArray(profile.puzzleRatingHistory) || profile.puzzleRatingHistory.length > 180))
    || (profile.puzzleRating !== undefined && (!finite(profile.puzzleRating) || profile.puzzleRating < 400 || profile.puzzleRating > 3200))
  ) return false;

  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 1_400_000;
  } catch {
    return false;
  }
}

/** Возвращает счётчики профиля, не изменяя исходные данные. */
export function summarizeProfile(profile: PlayerProfile): ProfileSyncSummary {
  const puzzles = Array.isArray(profile.puzzles) ? profile.puzzles : [];
  return {
    games: Number.isFinite(profile.games) ? profile.games : 0,
    analyzedGames: Array.isArray(profile.reviews) ? profile.reviews.length : 0,
    trainingPositions: puzzles.length,
    solvedPositions: puzzles.filter((item) => Number.isFinite(item.solvedAt)).length,
    trainingSessions: Array.isArray(profile.trainingSessions) ? profile.trainingSessions.length : 0,
    puzzleRating: Number.isFinite(profile.puzzleRating) ? profile.puzzleRating : 1200,
    rating: Number.isFinite(profile.rating) ? profile.rating : 1000,
    serializedBytes: new TextEncoder().encode(JSON.stringify(profile)).byteLength,
  };
}

export function formatProfileBytes(bytes: number): string {
  const safe = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  if (safe < 1024) return `${Math.round(safe)} Б`;
  if (safe < 1024 * 1024) return `${(safe / 1024).toFixed(1)} КБ`;
  return `${(safe / (1024 * 1024)).toFixed(2)} МБ`;
}

export function formatCloudTimestamp(value: string | null | undefined): string {
  if (!value) return "ещё не сохранялась";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "дата неизвестна";
  return date.toLocaleString("ru-RU", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
