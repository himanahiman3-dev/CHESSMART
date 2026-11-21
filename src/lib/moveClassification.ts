import type { Cls } from "../types";

/** Public Classification V2 ordinary thresholds, expressed as expected-points percentage points. */
export const MOVE_LOSS_LIMITS = {
  excellent: 2,
  good: 5,
  inaccuracy: 5,
  mistake: 10,
  blunder: 20,
} as const;

/** These boundaries are an explicit local approximation; Chess.com does not publish numeric band cutoffs. */
export const GREAT_BAND_LIMITS = { losing: 35, winning: 65 } as const;
export const MISS_BAND_LIMITS = { winningAtLeast: 65, equalOrWorseAtMost: 55 } as const;

export interface MoveClassificationInput {
  forced: boolean;
  book: boolean;
  brilliant: boolean;
  playedIsBest: boolean;
  winLoss: number;
  winBefore: number;
  winAfter: number;
  secondLinePresent: boolean;
  secondLineGap: number;
  legalMoves: number;
  previousOpponentLoss: number;
  missedMateInOne: boolean;
  lostForcedMate: boolean;
  allowedMate: boolean;
  elo?: number;
}

function greatGapFor(elo?: number): number {
  if (elo === undefined || !Number.isFinite(elo)) return 14;
  if (elo < 800) return 10;
  if (elo < 1400) return 12;
  return 14;
}

function bandOf(expectedPoints: number): number {
  if (expectedPoints >= GREAT_BAND_LIMITS.winning) return 2;
  if (expectedPoints >= GREAT_BAND_LIMITS.losing) return 1;
  return 0;
}

/** Convert the official 2/5/10/20 expected-points thresholds to an ordinary move label. */
export function classifyOrdinaryMove(winLoss: number): Cls {
  const loss = Number.isFinite(winLoss) ? Math.max(0, winLoss) : 100;
  if (loss < MOVE_LOSS_LIMITS.excellent) return "excellent";
  if (loss < MOVE_LOSS_LIMITS.good) return "good";
  if (loss < MOVE_LOSS_LIMITS.inaccuracy) return "inaccuracy";
  if (loss < MOVE_LOSS_LIMITS.mistake) return "mistake";
  return "blunder";
}

/**
 * Great is a local approximation of Chess.com's qualitative rule: a best move
 * that is decisive because the second line is materially worse, or crosses a
 * losing/equal/winning expected-points band. Lower-rated players receive a
 * more generous gap threshold, matching Chess.com's published direction.
 */
export function qualifiesAsGreat(input: Pick<
  MoveClassificationInput,
  "playedIsBest" | "winBefore" | "secondLinePresent" | "secondLineGap" | "legalMoves" | "elo"
>): boolean {
  if (!input.playedIsBest || !input.secondLinePresent || input.legalMoves <= 1) return false;
  if (input.winBefore < 8 || input.winBefore > 90) return false;
  const gap = Math.max(0, input.secondLineGap);
  const secondWin = input.winBefore - gap;
  const crossesOutcomeBand = bandOf(input.winBefore) > bandOf(secondWin) && gap >= 5;
  return gap >= greatGapFor(input.elo) || crossesOutcomeBand;
}

/**
 * A Miss is about an opportunity, not just the size of the numerical loss.
 * It covers missed mate, losing a forced mate, or immediately returning a
 * winning chance created by a significant opponent error. The EP bands are
 * our documented approximation of "winning" and "equal or worse".
 */
export function qualifiesAsMiss(input: Pick<
  MoveClassificationInput,
  "missedMateInOne" | "lostForcedMate" | "allowedMate" | "previousOpponentLoss" | "winBefore" | "winAfter"
>): boolean {
  if (input.allowedMate) return false;
  if (input.missedMateInOne || input.lostForcedMate) return true;
  return input.previousOpponentLoss >= MOVE_LOSS_LIMITS.mistake
    && input.winBefore >= MISS_BAND_LIMITS.winningAtLeast
    && input.winAfter <= MISS_BAND_LIMITS.equalOrWorseAtMost;
}

/** Single source of truth for label priority and all non-engine tactical overrides. */
export function classifyMove(input: MoveClassificationInput): Cls {
  if (input.forced) return "forced";
  if (input.book) return "book";
  if (input.brilliant) return "brilliant";
  if (qualifiesAsMiss(input)) return "miss";
  if (qualifiesAsGreat(input)) return "great";
  if (input.playedIsBest) return "best";
  if (input.allowedMate) return "blunder";
  return classifyOrdinaryMove(input.winLoss);
}
