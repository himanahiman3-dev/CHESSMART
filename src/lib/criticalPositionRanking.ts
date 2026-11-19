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
