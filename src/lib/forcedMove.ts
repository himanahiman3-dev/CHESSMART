/**
 * Chess.com-style Forced classification: exactly one legal move exists.
 * "Only sensible move" or "only move that preserves the evaluation" is not enough.
 */
export function forcedMoveClass(legalMoveCount: number): "forced" | null {
  return legalMoveCount === 1 ? "forced" : null;
}
