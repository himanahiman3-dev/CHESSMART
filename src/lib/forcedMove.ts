/**
 * Internal search safeguard: with one legal move there is no alternative to
 * compare against, so the move must not receive an avoidable-loss penalty.
 * Chess.com does not expose "Forced" as a separate Game Review classification.
 */
export function hasOnlyLegalMove(legalMoveCount: number): boolean {
  return legalMoveCount === 1;
}
