/**
 * Pure time-budget helpers for the local Stockfish game-review pipeline.
 * Kept in a dependency-free module so regression tests can import it directly
 * under Node without loading the browser/engine analysis graph.
 */

/** Base analysis budget per played half-move, in milliseconds. */
export const TIME_PER_MOVE_MS = 600;

/** Minimum search slot per evaluated position, in milliseconds. */
const MIN_POSITION_MS = 120;

/** Total main-pass search budget for a game with the given number of played plies. */
export function gameBudgetMs(moveCount: number): number {
  const moves = Math.max(0, Math.floor(moveCount));
  const positions = moves + 1;
  // Reserve at least MIN_POSITION_MS for every evaluated position.
  // A one-ply game still needs both its initial and final positions.
  return Math.max(moves * TIME_PER_MOVE_MS, positions * MIN_POSITION_MS);
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
