import { Chess, type Square } from "chess.js";

export interface Premove { from: string; to: string; promotion?: "q" | "r" | "b" | "n"; }
export interface ResolvedPremove extends Premove { san: string; uci: string; fenAfter: string; }
const SQUARE_PATTERN = /^[a-h][1-8]$/;

export function isChessSquare(value: unknown): value is Square {
  return typeof value === "string" && SQUARE_PATTERN.test(value);
}
export function isPremoveShape(value: unknown): value is Premove {
  if (typeof value !== "object" || value === null) return false;
  const move = value as Partial<Premove>;
  return isChessSquare(move.from) && isChessSquare(move.to) && move.from !== move.to
    && (move.promotion === undefined || ["q", "r", "b", "n"].includes(move.promotion));
}
export function sanitizePremove(value: unknown): Premove | null {
  if (!isPremoveShape(value)) return null;
  return { from: value.from, to: value.to, ...(value.promotion ? { promotion: value.promotion } : {}) };
}
export function samePremove(a: Premove | null | undefined, b: Premove | null | undefined): boolean {
  return !!a && !!b && a.from === b.from && a.to === b.to && (a.promotion ?? "q") === (b.promotion ?? "q");
}

/** Computes next-turn destinations on a copy; the live board and en-passant target stay untouched. */
export function getPremoveMoves(fen: string, color: "w" | "b", from: string): Premove[] {
  if (!isChessSquare(from)) return [];
  try {
    const fields = fen.trim().split(/\s+/);
    if (fields.length !== 6) return [];
    const live = new Chess(fen);
    if (live.turn() === color || live.isGameOver()) return [];
    const piece = live.get(from);
    if (!piece || piece.color !== color) return [];
    fields[1] = color;
    fields[3] = "-";
    const projected = new Chess(fields.join(" "));
    return projected.moves({ square: from, verbose: true }).map((move) => ({
      from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}),
    }));
  } catch { return []; }
}
export function canSetPremove(fen: string, color: "w" | "b", from: string, to: string): boolean {
  return getPremoveMoves(fen, color, from).some((move) => move.to === to);
}
export function createPremove(
  fen: string,
  color: "w" | "b",
  from: string,
  to: string,
  promotion: "q" | "r" | "b" | "n" = "q",
): Premove | null {
  if (!isChessSquare(from) || !isChessSquare(to) || from === to) return null;
  const candidate = getPremoveMoves(fen, color, from).find((move) => move.to === to);
  if (!candidate) return null;
  return { from, to, ...(candidate.promotion ? { promotion } : {}) };
}
/** Re-checks legality only after the opponent's real move has arrived. */
export function resolvePremove(fen: string, color: "w" | "b", premove: Premove): ResolvedPremove | null {
  if (!isPremoveShape(premove)) return null;
  try {
    const chess = new Chess(fen);
    if (chess.isGameOver() || chess.turn() !== color) return null;
    const piece = chess.get(premove.from as Square);
    if (!piece || piece.color !== color) return null;
    const result = chess.move({
      from: premove.from as Square, to: premove.to as Square,
      ...(premove.promotion ? { promotion: premove.promotion } : {}),
    });
    if (!result) return null;
    return { ...premove, san: result.san, uci: result.from + result.to + (result.promotion ?? ""), fenAfter: chess.fen() };
  } catch { return null; }
}
export function premoveToUci(premove: Premove): string {
  return premove.from + premove.to + (premove.promotion ?? "");
}
export function formatPremove(premove: Premove): string {
  return `${premove.from} → ${premove.to}${premove.promotion ? `=${premove.promotion.toUpperCase()}` : ""}`;
}
export function premoveClockPenaltyMs(enabled: boolean): number { return enabled ? 100 : 0; }
export function isPremoveForTurn(fen: string, color: "w" | "b"): boolean {
  try { const chess = new Chess(fen); return !chess.isGameOver() && chess.turn() !== color; }
  catch { return false; }
}
