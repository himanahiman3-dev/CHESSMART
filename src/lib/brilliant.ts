/**
 * Chess.com describes a Brilliant move as a best/nearly-best good piece sacrifice:
 * the resulting position must not be bad, and the player must not already be
 * completely winning without finding it. Exact numeric thresholds are not public.
 */
export const BRILLIANT_MAX_LOSS = 3;
export const BRILLIANT_MIN_AFTER = 40;

export interface BrilliantCriteria {
  sacrifice: boolean;
  legalMoves: number;
  alternativeWin: number | null;
  winLoss: number;
  winAfter: number;
  lostMate: boolean;
  allowedMate: boolean;
  elo?: number;
  /** A continuation of a previously established sacrifice that remains capturable. */
  continuation?: boolean;
  /** A sound piece sacrifice that Stockfish verifies leads to a short forced mate. */
  matingSacrifice?: boolean;
}

/**
 * Approximation of Chess.com's unpublished "already completely winning" cutoff.
 * Expected-points values are in percent. Lower-rated players receive the more
 * generous cutoff, as described by Chess.com; this is a project heuristic.
 */
export function brilliantAlternativeLimit(elo?: number): number {
  if (elo === undefined || !Number.isFinite(elo)) return 97;
  if (elo < 1000) return 98;
  if (elo < 1800) return 97;
  return 96;
}

export function qualifiesAsBrilliant(criteria: BrilliantCriteria): boolean {
  if (
    !criteria.sacrifice ||
    criteria.legalMoves <= 1 ||
    criteria.lostMate ||
    criteria.allowedMate ||
    criteria.winLoss > BRILLIANT_MAX_LOSS ||
    criteria.winAfter < BRILLIANT_MIN_AFTER
  ) return false;

  // The normal alternative-line safeguard stays in place. These two narrowly
  // verified tactical cases are different: the move continues a live declined
  // offer, or the sacrifice itself forces a short mate.
  if (criteria.continuation || criteria.matingSacrifice) return true;

  return criteria.alternativeWin !== null
    && criteria.alternativeWin <= brilliantAlternativeLimit(criteria.elo);
}
