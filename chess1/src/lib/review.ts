import { Chess } from "chess.js";
import { classifyMove } from "./classify";
import type { StockfishEngine } from "./engine";
import type {
  Classification,
  EngineLine,
  GameMove,
  MoveReview,
  ParsedGame,
  PositionEval,
  ReviewSummary,
  Side,
} from "./types";
import { CLASS_ORDER, MATE_CP, cpToWinRate, gameAccuracy } from "./winrate";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function looksLikeFen(text: string): boolean {
  const t = text.trim();
  if (t.includes("\n") || t.includes("[")) return false;
  const parts = t.split(/\s+/);
  return parts.length >= 4 && parts[0].split("/").length === 8;
}

/** Parse PGN (with or without headers/comments/clock tags) or a single FEN. Throws on invalid input. */
export function parseInput(raw: string): ParsedGame {
  const text = raw.trim();
  if (!text) throw new Error("Paste a PGN or FEN first.");

  if (looksLikeFen(text)) {
    const parts = text.split(/\s+/);
    const fen = [parts[0], parts[1] ?? "w", parts[2] ?? "-", parts[3] ?? "-", parts[4] ?? "0", parts[5] ?? "1"].join(" ");
    let chess: Chess;
    try {
      chess = new Chess(fen);
    } catch {
      throw new Error("That FEN is not valid.");
    }
    return { headers: { Event: "Position analysis" }, startFen: chess.fen(), moves: [], isFenOnly: true };
  }

  const chess = new Chess();
  try {
    chess.loadPgn(text);
  } catch (e) {
    throw new Error(`Could not read the PGN: ${e instanceof Error ? e.message : "invalid notation"}`);
  }
  const verbose = chess.history({ verbose: true });
  if (verbose.length === 0) throw new Error("The PGN does not contain any moves.");
  const headers = chess.getHeaders() as Record<string, string>;
  const startFen = headers.SetUp === "1" && headers.FEN ? headers.FEN : new Chess().fen();
  const moves: GameMove[] = verbose.map((m, i) => ({
    ply: i + 1,
    san: m.san,
    uci: m.from + m.to + (m.promotion ?? ""),
    from: m.from,
    to: m.to,
    color: m.color as Side,
    piece: m.piece,
    captured: m.captured,
    promotion: m.promotion,
    flags: m.flags,
    fenBefore: m.before,
    fenAfter: m.after,
  }));
  return { headers, startFen, moves, isFenOnly: false };
}

export function terminalEval(fen: string): PositionEval | null {
  const chess = new Chess(fen);
  const legalMoves = chess.moves().length;
  if (chess.isCheckmate()) {
    const whiteLost = chess.turn() === "w";
    const cp = whiteLost ? -MATE_CP : MATE_CP;
    return {
      fen,
      depth: 0,
      legalMoves: 0,
      terminal: "checkmate",
      lines: [{ multipv: 1, depth: 0, cp, mate: 0, pv: [] }],
    };
  }
  if (chess.isStalemate() || chess.isDraw() || legalMoves === 0) {
    return {
      fen,
      depth: 0,
      legalMoves: 0,
      terminal: chess.isStalemate() ? "stalemate" : "draw",
      lines: [{ multipv: 1, depth: 0, cp: 0, mate: null, pv: [] }],
    };
  }
  return null;
}

export function emptySummary(): ReviewSummary {
  const zero = () => Object.fromEntries(CLASS_ORDER.map((c) => [c, 0])) as Record<Classification, number>;
  return { accuracy: { w: 100, b: 100 }, counts: { w: zero(), b: zero() } };
}

export function evalWhiteWr(ev: PositionEval | null | undefined): number | null {
  if (!ev || !ev.lines[0]) return null;
  return cpToWinRate(ev.lines[0].cp) * 100;
}

/** Aggregate classification counts and Chess.com-style accuracy for each side. */
export function summarize(evals: (PositionEval | null)[], moves: (MoveReview | null)[]): ReviewSummary {
  const summary = emptySummary();
  const accs: Record<Side, number[]> = { w: [], b: [] };
  const plies: Record<Side, number[]> = { w: [], b: [] };
  const series: number[] = evals.map((e) => evalWhiteWr(e) ?? 50);
  moves.forEach((m, i) => {
    if (!m) return;
    summary.counts[m.color][m.classification]++;
    accs[m.color].push(m.accuracy);
    plies[m.color].push(i);
  });
  summary.accuracy.w = gameAccuracy(accs.w, plies.w, series);
  summary.accuracy.b = gameAccuracy(accs.b, plies.b, series);
  return summary;
}

export interface ReviewProgress {
  done: number;
  total: number;
  evals: (PositionEval | null)[];
  moves: (MoveReview | null)[];
  liveFen: string;
  liveLines: EngineLine[];
  liveDepth: number;
}

export interface ReviewOptions {
  depth: number;
  cancelled: { value: boolean };
  onProgress: (p: ReviewProgress) => void;
}

/**
 * Full game review loop: analyse every position with Stockfish (MultiPV), then classify each move using
 * the evaluation of the position before it (all MultiPV lines) and after it.
 */
export async function runReview(engine: StockfishEngine, game: ParsedGame, opts: ReviewOptions) {
  const fens = [game.startFen, ...game.moves.map((m) => m.fenAfter)];
  const evals: (PositionEval | null)[] = fens.map(() => null);
  const moves: (MoveReview | null)[] = game.moves.map(() => null);
  const cache = new Map<string, PositionEval>();
  const key = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

  engine.newGame();

  const emit = (done: number, liveFen: string, liveLines: EngineLine[], liveDepth: number) =>
    opts.onProgress({
      done,
      total: fens.length,
      evals: [...evals],
      moves: [...moves],
      liveFen,
      liveLines,
      liveDepth,
    });

  for (let i = 0; i < fens.length; i++) {
    if (opts.cancelled.value) break;
    const fen = fens[i];
    let ev: PositionEval | null = terminalEval(fen);
    if (!ev) {
      const cached = cache.get(key(fen));
      if (cached) {
        ev = { ...cached, fen };
      } else {
        const legal = new Chess(fen).moves().length;
        const res = await engine.analyze(fen, opts.depth, (lines, d) => {
          emit(i, fen, lines, d);
        });
        if (opts.cancelled.value) break;
        ev = { fen, depth: res.depth, lines: res.lines, legalMoves: legal };
        cache.set(key(fen), ev);
      }
    }
    evals[i] = ev;
    if (i > 0 && evals[i - 1]) {
      moves[i - 1] = classifyMove(game.moves[i - 1], evals[i - 1]!, ev, i > 1 ? game.moves[i - 2] : null);
    }
    emit(i + 1, fen, ev.lines, ev.depth);
  }

  const complete = !opts.cancelled.value;
  return { evals, moves, summary: summarize(evals, moves), complete };
}
