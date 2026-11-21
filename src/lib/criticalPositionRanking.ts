export interface RankedCriticalPosition {
  index: number;
  priority: number;
  estimatedLoss: number;
  secondLineGap: number;
}

/** Stable priority ordering shared by runtime selection and unit tests. */
export function rankCriticalPositions<T extends RankedCriticalPosition>(
  candidates: readonly T[],
  maxCandidates: number
): T[] {
  const limit = Math.max(0, Math.floor(maxCandidates));
  if (limit === 0) return [];
  return [...candidates]
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
    .slice(0, limit);
}

/** Heuristic gate for a second search; values are in expected-points percentage points. */
export function shouldRecheckCriticalPosition(
  estimatedLoss: number,
  secondLineGap: number,
  legalMoveCount: number,
  tactical: boolean
): boolean {
  return estimatedLoss >= 2.5
    || (legalMoveCount >= 18 && secondLineGap >= 6)
    || (tactical && estimatedLoss >= 1.5);
}


/**
 * A best-line piece sacrifice can be Brilliant even though its first-pass
 * expected-points loss is zero. Such candidates deserve a deeper search.
 */
export function isSacrificeVerificationCandidate(
  sacrifice: boolean,
  legalMoveCount: number,
  playedIsBest: boolean,
  estimatedLoss: number,
  maxNearBestLoss = 3,
): boolean {
  return sacrifice
    && legalMoveCount > 1
    && (playedIsBest || estimatedLoss <= maxNearBestLoss);
}
