import { Chess, type PieceSymbol } from "chess.js";
import type { UciGameMove } from "./gameNotation";

export type GamePhase = "opening" | "middlegame" | "endgame";
export type TerminalState = "playing" | "check" | "checkmate" | "stalemate" | "draw";
export interface PieceCounts { p: number; n: number; b: number; r: number; q: number; k: number; }
export interface PositionInsights {
  phase: GamePhase;
  whiteMaterial: number;
  blackMaterial: number;
  materialBalance: number;
  legalMoves: number;
  turn: "w" | "b";
  moveNumber: number;
  halfmoveClock: number;
  check: boolean;
  terminal: TerminalState;
  castling: string;
  whitePieces: PieceCounts;
  blackPieces: PieceCounts;
}
const VALUES: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const EMPTY_COUNTS = (): PieceCounts => ({ p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 });

export function replayUciHistory(moves: UciGameMove[]): Chess {
  const chess = new Chess();
  for (const entry of moves) {
    chess.move({
      from: entry.uci.slice(0, 2) as never,
      to: entry.uci.slice(2, 4) as never,
      ...(entry.uci[4] ? { promotion: entry.uci[4] as never } : {}),
    });
  }
  return chess;
}
export function replaySanHistory(sans: string[]): Chess {
  const chess = new Chess();
  for (const san of sans) chess.move(san);
  return chess;
}
export function getPieceCounts(fen: string, color: "w" | "b"): PieceCounts {
  const counts = EMPTY_COUNTS();
  try {
    const chess = new Chess(fen);
    for (const row of chess.board()) for (const piece of row) {
      if (piece?.color === color) counts[piece.type]++;
    }
  } catch { /* malformed FEN returns empty counts */ }
  return counts;
}
export function getMaterialTotal(counts: PieceCounts): number {
  return Object.entries(counts).reduce((total, [piece, count]) => total + VALUES[piece as PieceSymbol] * count, 0);
}
export function getMaterialBalance(fen: string): number {
  return getMaterialTotal(getPieceCounts(fen, "w")) - getMaterialTotal(getPieceCounts(fen, "b"));
}
export function formatMaterialBalance(balance: number): string {
  if (!Number.isFinite(balance) || balance === 0) return "Материал равен";
  return balance > 0 ? `Белые +${balance}` : `Чёрные +${Math.abs(balance)}`;
}
export function getGamePhase(fen: string): GamePhase {
  try {
    const chess = new Chess(fen);
    const fullMove = Number(fen.trim().split(/\s+/)[5] ?? 1);
    const board = chess.board().flat().filter((piece) => piece && piece.type !== "p" && piece.type !== "k");
    if (board.length <= 6) return "endgame";
    if (fullMove <= 12) return "opening";
    return "middlegame";
  } catch { return "opening"; }
}
export function gamePhaseLabel(phase: GamePhase): string {
  return phase === "opening" ? "Дебют" : phase === "middlegame" ? "Миттельшпиль" : "Эндшпиль";
}
export function getHalfmoveClock(fen: string): number {
  const value = Number(fen.trim().split(/\s+/)[4] ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
export function isNearFiftyMoveRule(fen: string): boolean { return getHalfmoveClock(fen) >= 80; }
export function getCastlingAvailability(fen: string): string {
  const rights = fen.trim().split(/\s+/)[2] ?? "-";
  return rights === "-" ? "Рокировка недоступна" : rights.split("").join(" ");
}
export function getSideToMove(fen: string): "w" | "b" {
  return fen.trim().split(/\s+/)[1] === "b" ? "b" : "w";
}
export function getMoveNumber(fen: string): number {
  const value = Number(fen.trim().split(/\s+/)[5] ?? 1);
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}
export function getLegalMoveCount(fen: string): number {
  try { return new Chess(fen).moves().length; } catch { return 0; }
}
export function getTerminalState(chess: Chess): TerminalState {
  if (chess.isCheckmate()) return "checkmate";
  if (chess.isStalemate()) return "stalemate";
  if (chess.isDraw()) return "draw";
  return chess.isCheck() ? "check" : "playing";
}
export function terminalStateLabel(state: TerminalState): string {
  const labels: Record<TerminalState, string> = {
    playing: "Партия продолжается", check: "Шах", checkmate: "Мат",
    stalemate: "Пат", draw: "Ничья",
  };
  return labels[state];
}
export function isKingInCheck(fen: string): boolean {
  try { return new Chess(fen).isCheck(); } catch { return false; }
}
export function getCapturedMaterial(fen: string, color: "w" | "b"): number {
  const now = getPieceCounts(fen, color);
  const start: PieceCounts = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
  return Math.max(0, getMaterialTotal(start) - getMaterialTotal(now));
}
export function formatPieceCounts(counts: PieceCounts): string {
  return `Ф${counts.q} Л${counts.r} С${counts.b} К${counts.n} П${counts.p}`;
}
export function getPositionInsights(fen: string, history?: Chess): PositionInsights {
  const chess = history && history.fen() === fen ? history : new Chess(fen);
  const whitePieces = getPieceCounts(fen, "w");
  const blackPieces = getPieceCounts(fen, "b");
  const whiteMaterial = getMaterialTotal(whitePieces);
  const blackMaterial = getMaterialTotal(blackPieces);
  return {
    phase: getGamePhase(fen),
    whiteMaterial,
    blackMaterial,
    materialBalance: whiteMaterial - blackMaterial,
    legalMoves: chess.moves().length,
    turn: chess.turn(),
    moveNumber: getMoveNumber(fen),
    halfmoveClock: getHalfmoveClock(fen),
    check: chess.isCheck(),
    terminal: getTerminalState(chess),
    castling: getCastlingAvailability(fen),
    whitePieces,
    blackPieces,
  };
}
