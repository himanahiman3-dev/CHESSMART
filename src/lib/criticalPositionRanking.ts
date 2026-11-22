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
  tactical: boolean,
  mateOpportunity = false,
): boolean {
  return mateOpportunity
    || estimatedLoss >= 2.5
    || (legalMoveCount >= 18 && secondLineGap >= 6)
    || (tactical && estimatedLoss >= 1.5);
}


/**
 * Every detected piece sacrifice must be verified, even when the shallow scan
 * thinks it is a poor move. Otherwise a shallow evaluation error can prevent the
 * deeper pass from ever correcting the very move whose classification is in doubt.
 */
export function isSacrificeVerificationCandidate(
  sacrifice: boolean,
  legalMoveCount: number,
  _playedIsBest: boolean,
  _estimatedLoss: number,
  _maxNearBestLoss = 3,
): boolean {
  return sacrifice && legalMoveCount > 1;
}

/**
 * Preserve all sacrifice checks, then spend the optional verifier allowance on
 * the highest-priority non-sacrifice critical positions.
 */
export function selectVerificationCandidates<T extends RankedCriticalPosition & { sacrifice: boolean }>(
  candidates: readonly T[],
  maxOrdinaryCandidates: number,
): T[] {
  const ordered = [...candidates].sort((a, b) => b.priority - a.priority || a.index - b.index);
  const sacrifices = ordered.filter((candidate) => candidate.sacrifice);
  const ordinary = ordered.filter((candidate) => !candidate.sacrifice)
    .slice(0, Math.max(0, Math.floor(maxOrdinaryCandidates)));
  return [...sacrifices, ...ordinary];
}
