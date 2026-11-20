/**
 * Pure time-budget helpers for the local Stockfish game-review pipeline.
 * Kept in a dependency-free module so regression tests can import it directly
 * under Node without loading the browser/engine analysis graph.
 */

/** Base analysis budget per played half-move, in milliseconds. */
export const TIME_PER_MOVE_MS = 400;

/** Minimum search slot per evaluated position, in milliseconds. */
const MIN_POSITION_MS = 120;

/** Every non-terminal game position must reach this depth before the review advances. */
export const MINIMUM_ANALYSIS_DEPTH = 41;

/** Maximum user-selectable Stockfish search depth supported by the bundled UCI engine. */
export const MAX_ANALYSIS_DEPTH = 245;

/**
 * Convert the selected target depth into a per-ply time budget.
 * Presets up to depth 22 keep today's snappy timing; higher depths progressively
 * spend more time, reaching the desktop 6.5-minute target for an 80-ply game.
 */
export function timePerMoveForDepth(depth: number, baseMs: number, maxMs: number): number {
  const safeBase = Math.max(MIN_POSITION_MS, Math.floor(Number.isFinite(baseMs) ? baseMs : TIME_PER_MOVE_MS));
  const safeMax = Math.max(safeBase, Math.floor(Number.isFinite(maxMs) ? maxMs : safeBase));
  const targetDepth = Math.max(1, Math.min(MAX_ANALYSIS_DEPTH, Math.floor(depth)));
  if (targetDepth <= 22 || safeMax === safeBase) return safeBase;
  const progress = (targetDepth - 22) / (MAX_ANALYSIS_DEPTH - 22);
  const ramp = Math.pow(progress, 1.08);
  return Math.round(safeBase + (safeMax - safeBase) * ramp);
}

/** Total main-pass search budget for a game with the given number of played plies. */
export function gameBudgetMs(moveCount: number, timePerMoveMs = TIME_PER_MOVE_MS): number {
  const moves = Math.max(0, Math.floor(moveCount));
  const positions = moves + 1;
  const perMove = Math.max(MIN_POSITION_MS, Math.floor(timePerMoveMs));
  // Reserve at least MIN_POSITION_MS for every evaluated position.
  // A one-ply game still needs both its initial and final positions.
  return Math.max(moves * perMove, positions * MIN_POSITION_MS);
}

/**
 * Split the remaining game budget across positions still to be evaluated.
 * Never return more time than remains, even after scheduling overhead.
 */
export function slotForPosition(budgetMs: number, elapsedMs: number, positionsLeft: number): number {
  const remaining = Math.max(0, Math.floor(budgetMs - elapsedMs));
  if (remaining <= 0) return 1;
  const fairShare = Math.round(remaining / Math.max(1, positionsLeft));
  return Math.max(1, Math.min(remaining, Math.max(MIN_POSITION_MS, fairShare)));
}
