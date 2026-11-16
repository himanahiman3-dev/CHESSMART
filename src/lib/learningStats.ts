import type { Color, GameReview, MoveReview } from "../types";

export type GamePhase = "opening" | "middlegame" | "endgame";
export interface AccuracySlice {
  accuracy: number;
  moves: number;
}
export interface PhaseAccuracy {
  w: AccuracySlice;
  b: AccuracySlice;
}
export type PhaseAccuracyMap = Record<GamePhase, PhaseAccuracy>;

export const PHASE_LABELS: Record<GamePhase, string> = {
  opening: "Дебют",
  middlegame: "Миттельшпиль",
  endgame: "Эндшпиль",
};

/**
 * Приближённое разбиение на стадии:
 * дебют — первые 10 полных ходов; эндшпиль — мало фигур/нет ферзей;
 * оставшаяся часть — миттельшпиль. Классифицируем каждую позицию по FEN до хода.
 */
export function classifyGamePhase(fen: string): GamePhase {
  const fields = fen.split(" ");
  const placement = fields[0] ?? "";
  const pieces = placement.replace(/[1-8/]/g, "");
  const queens = (pieces.match(/q/gi) ?? []).length;
  const rooks = (pieces.match(/r/gi) ?? []).length;
  const minors = (pieces.match(/[bn]/gi) ?? []).length;
  const materialPhase = queens * 4 + rooks * 2 + minors;
  if (materialPhase <= 6 || (queens === 0 && materialPhase <= 9)) return "endgame";
  const fullMove = Math.max(1, Number.parseInt(fields[5] ?? "1", 10) || 1);
  if (fullMove <= 10) return "opening";
  return "middlegame";
}

function emptySide(): { sum: number; moves: number } {
  return { sum: 0, moves: 0 };
}

export function calculatePhaseAccuracy(moves: MoveReview[]): PhaseAccuracyMap {
  const raw: Record<GamePhase, Record<Color, { sum: number; moves: number }>> = {
    opening: { w: emptySide(), b: emptySide() },
    middlegame: { w: emptySide(), b: emptySide() },
    endgame: { w: emptySide(), b: emptySide() },
  };
  for (const move of moves) {
    const phase = classifyGamePhase(move.fenBefore);
    raw[phase][move.color].sum += move.accuracy;
    raw[phase][move.color].moves += 1;
  }
  const result = {} as PhaseAccuracyMap;
  for (const phase of ["opening", "middlegame", "endgame"] as const) {
    result[phase] = {
      w: {
        accuracy: raw[phase].w.moves ? raw[phase].w.sum / raw[phase].w.moves : 0,
        moves: raw[phase].w.moves,
      },
      b: {
        accuracy: raw[phase].b.moves ? raw[phase].b.sum / raw[phase].b.moves : 0,
        moves: raw[phase].b.moves,
      },
    };
  }
  return result;
}

export interface BrilliantMoveSummary {
  color: Color;
  moveNumber: number;
  san: string;
  comment: string;
}

export interface ReviewSummary {
  id: string;
  at: number;
  white: string;
  black: string;
  result: string;
  date: string;
  plies: number;
  opening?: { eco: string; name: string };
  accuracy: { w: number; b: number; average: number };
  phases: PhaseAccuracyMap;
  brilliantMoves: BrilliantMoveSummary[];
  missedWins: Array<{ color: Color; moveNumber: number; san: string; comment: string }>;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function summarizeReview(review: GameReview): ReviewSummary {
  const headers = review.headers;
  const first = review.moves[0]?.uci ?? "";
  const last = review.moves[review.moves.length - 1]?.uci ?? "";
  const identity = [
    headers.Site ?? "",
    headers.Date ?? "",
    headers.White ?? "",
    headers.Black ?? "",
    String(review.moves.length),
    first,
    last,
  ].join("|");
  const phases = calculatePhaseAccuracy(review.moves);
  const opening = review.opening ?? review.moves.find((move) => move.opening)?.opening;
  const brilliantMoves = review.moves
    .filter((move) => move.cls === "brilliant")
    .map((move) => ({
      color: move.color,
      moveNumber: Math.floor(move.index / 2) + 1,
      san: move.san,
      comment: move.comment,
    }));
  const missedWins = review.moves
    .filter((move) => move.cls === "miss")
    .map((move) => ({
      color: move.color,
      moveNumber: Math.floor(move.index / 2) + 1,
      san: move.san,
      comment: move.comment,
    }));
  return {
    id: hashString(identity),
    at: Date.now(),
    white: headers.White ?? "Белые",
    black: headers.Black ?? "Чёрные",
    result: headers.Result ?? "*",
    date: (headers.Date ?? new Date().toISOString().slice(0, 10)).replace(/\./g, "-"),
    plies: review.moves.length,
    opening: opening ? { eco: opening.eco, name: opening.ru } : undefined,
    accuracy: {
      w: review.accuracy.w,
      b: review.accuracy.b,
      average: (review.accuracy.w + review.accuracy.b) / 2,
    },
    phases,
    brilliantMoves,
    missedWins,
  };
}
