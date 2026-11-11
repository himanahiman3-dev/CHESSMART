export type Side = "w" | "b";

export type Classification =
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

/** One MultiPV line. `cp` is ALWAYS from White's point of view (mates are mapped to large cp values). */
export interface EngineLine {
  multipv: number;
  depth: number;
  cp: number;
  /** Mate distance from White's point of view (+ = White mates, - = Black mates). 0 = game is over (checkmate). null = no mate. */
  mate: number | null;
  /** Principal variation in UCI notation. */
  pv: string[];
}

export interface PositionEval {
  fen: string;
  depth: number;
  lines: EngineLine[];
  terminal?: "checkmate" | "stalemate" | "draw";
  legalMoves: number;
}

export interface GameMove {
  ply: number; // 1-based
  san: string;
  uci: string;
  from: string;
  to: string;
  color: Side;
  piece: string;
  captured?: string;
  promotion?: string;
  flags: string;
  fenBefore: string;
  fenAfter: string;
}

export interface ParsedGame {
  headers: Record<string, string>;
  startFen: string;
  moves: GameMove[];
  isFenOnly: boolean;
}

export interface MoveReview {
  ply: number;
  san: string;
  uci: string;
  from: string;
  to: string;
  color: Side;
  classification: Classification;
  /** Win-rate (0..1) for the mover before the move (best line) and after the played move. */
  wrBefore: number;
  wrAfter: number;
  deltaWR: number; // 0..1 drop
  cpLoss: number; // centipawns lost, mover POV (capped)
  accuracy: number; // 0..100 for this move
  bestUci: string | null;
  bestSan: string | null;
  /** index of the played move among the engine's top lines (0 = top line) or -1 */
  rank: number;
  isSacrifice: boolean;
  mitigated: boolean;
  explanation: string; // contains {S} {P} {O} placeholders
}

export interface ReviewSummary {
  accuracy: { w: number; b: number };
  counts: { w: Record<Classification, number>; b: Record<Classification, number> };
}

export interface EngineSettings {
  variant: "full" | "lite";
  depth: number;
  multiPv: number;
  threads: number;
  hashMb: number;
}

export interface EngineInfo {
  name: string;
  file: string;
  threads: number;
  hashMb: number;
  isolated: boolean;
  variant: "full" | "lite";
}

export interface SavedReviewData {
  game: ParsedGame;
  evals: (PositionEval | null)[];
  moves: MoveReview[];
  summary: ReviewSummary;
  settings: { depth: number; multiPv: number };
}
