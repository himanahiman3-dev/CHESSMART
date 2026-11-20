/**
 * Deterministic time presets for the local Stockfish game-review queue.
 * Every non-terminal position gets its own full movetime allowance.
 */
export const REVIEW_TARGET_DEPTH = 22;
export const TIME_PER_MOVE_MS = 1000;
export const DEFAULT_ANALYSIS_TIME_MS = 1000;

export const ANALYSIS_TIME_MODES = [
  { id: "fast", timeMs: 300, title: "Быстрый", desc: "0,3 секунды на каждую позицию", note: "Быстрый обзор партии", level: "01" },
  { id: "optimal", timeMs: 1000, title: "Оптимальный", desc: "1 секунда на каждую позицию", note: "Рекомендуемый баланс", level: "02" },
  { id: "deep", timeMs: 3000, title: "Глубокий", desc: "3 секунды на каждую позицию", note: "Больше времени на сложные варианты", level: "03" },
] as const;

export type AnalysisTimeModeId = (typeof ANALYSIS_TIME_MODES)[number]["id"];

export function normalizeAnalysisTimeMs(value: number): number {
  return ANALYSIS_TIME_MODES.some((mode) => mode.timeMs === value)
    ? value
    : DEFAULT_ANALYSIS_TIME_MS;
}

/**
 * A PGN with N played half-moves has N+1 review positions:
 * the initial position, then the position after each half-move.
 */
export function gameBudgetMs(moveCount: number, timePerPositionMs = TIME_PER_MOVE_MS): number {
  const plies = Math.max(0, Math.floor(moveCount));
  const positions = plies + 1;
  const perPosition = Math.max(1, Math.floor(Number.isFinite(timePerPositionMs) ? timePerPositionMs : TIME_PER_MOVE_MS));
  return positions * perPosition;
}

/** Split a remaining budget evenly; retained for callers that need a shared wall-clock budget. */
export function slotForPosition(budgetMs: number, elapsedMs: number, positionsLeft: number): number {
  const remaining = Math.max(0, Math.floor(budgetMs - elapsedMs));
  if (remaining <= 0) return 1;
  const fairShare = Math.round(remaining / Math.max(1, positionsLeft));
  return Math.max(1, Math.min(remaining, fairShare));
}
