/**
 * Конвейер обзора партии: разбор PGN → анализ каждой позиции Stockfish 19 (MultiPV 2, с кэшем
 * в IndexedDB) → Win% → точность (CAPS2) → классификация 10 типов ходов → комментарии тренера.
 */
import { Chess, type Square } from "chess.js";
import type { Cls, Color, EngineLine, GameReview, MoveReview, PositionEval, Score } from "../types";
import { emptyCounts } from "../types";
import type { StockfishEngine } from "./engine";
import { getCachedPosition, putCachedPosition } from "./db";
import { analyzeBook, openingForCode } from "./openings";
import { detectSacrifice } from "./see";
import { buildComment } from "./coach";
import { cpFor, estimateGameRating, gameAccuracy, moveAccuracy, winFor, winPercent } from "./winprob";

export interface ParsedMove {
  san: string;
  uci: string;
  from: string;
  to: string;
  piece: string;
  captured?: string;
  color: Color;
  fenBefore: string;
  fenAfter: string;
}

export interface ParsedGame {
  headers: Record<string, string>;
  startFen: string;
  moves: ParsedMove[];
  fens: string[];
}

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function parseGame(pgnText: string): ParsedGame {
  const text = pgnText.trim();
  if (!text) throw new Error("Пустой PGN");
  const chess = new Chess();
  try {
    chess.loadPgn(text);
  } catch (e) {
    throw new Error("Не удалось разобрать PGN: " + (e instanceof Error ? e.message : String(e)));
  }
  const rawHeaders = chess.header() as Record<string, string | null>;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawHeaders)) if (v) headers[k] = v;
  const startFen = headers.FEN || START_FEN;
  const hist = chess.history({ verbose: true });
  const moves: ParsedMove[] = hist.map((m) => ({
    san: m.san,
    uci: m.from + m.to + (m.promotion ?? ""),
    from: m.from,
    to: m.to,
    piece: m.piece,
    captured: m.captured,
    color: m.color,
    fenBefore: m.before,
    fenAfter: m.after,
  }));
  if (!moves.length) throw new Error("В партии нет ходов");
  const fens = [moves[0].fenBefore, ...moves.map((m) => m.fenAfter)];
  return { headers, startFen, moves, fens };
}

export interface AnalyzeProgress {
  done: number;
  total: number;
  depth: number; // текущая достигнутая глубина
  targetDepth: number;
  cached: number;
  fen: string;
}

function terminalEval(fen: string): PositionEval | null {
  const chess = new Chess(fen);
  if (!chess.isGameOver()) return null;
  let score: Score;
  if (chess.isCheckmate()) score = chess.turn() === "w" ? { mate: -1, terminal: true } : { mate: 1, terminal: true };
  else score = { cp: 0 };
  return { fen, depth: 0, lines: [{ multipv: 1, depth: 0, score, pv: [] }] };
}

export async function evaluatePosition(
  engine: StockfishEngine,
  fen: string,
  depth: number,
  multipv: number,
  signal?: AbortSignal,
  onInfo?: (lines: EngineLine[]) => void
): Promise<{ evalResult: PositionEval; fromCache: boolean }> {
  const term = terminalEval(fen);
  if (term) return { evalResult: term, fromCache: true };
  const cached = await getCachedPosition(fen, depth, multipv);
  if (cached) return { evalResult: cached, fromCache: true };
  const handle = engine.search({ fen, depth, multipv, onInfo });
  const onAbort = () => handle.stop();
  signal?.addEventListener("abort", onAbort);
  let lines: EngineLine[];
  try {
    lines = await handle.promise;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  if (signal?.aborted) throw new Error("cancelled");
  if (!lines.length) throw new Error("Движок не вернул результат");
  const reached = Math.min(...lines.map((l) => l.depth));
  await putCachedPosition(fen, depth, multipv, lines, reached);
  return { evalResult: { fen, depth: reached, lines }, fromCache: false };
}

function uciToSan(fen: string, uci: string | undefined): string | undefined {
  if (!uci) return undefined;
  try {
    const c = new Chess(fen);
    const m = c.move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci.length > 4 ? uci[4] : undefined });
    return m?.san;
  } catch {
    return undefined;
  }
}

function legalMoveCount(fen: string): number {
  try {
    return new Chess(fen).moves().length;
  } catch {
    return 0;
  }
}

export async function reviewGame(
  pgn: string,
  depth: number,
  engine: StockfishEngine,
  onProgress: (p: AnalyzeProgress) => void,
  signal?: AbortSignal
): Promise<GameReview> {
  const game = parseGame(pgn);
  const N = game.moves.length;
  engine.newGame();
  const positions: PositionEval[] = [];
  let cachedHits = 0;
  for (let i = 0; i <= N; i++) {
    if (signal?.aborted) throw new Error("cancelled");
    const fen = game.fens[i];
    onProgress({ done: i, total: N + 1, depth: 0, targetDepth: depth, cached: cachedHits, fen });
    const { evalResult, fromCache } = await evaluatePosition(engine, fen, depth, 2, signal, (lines) => {
      onProgress({
        done: i,
        total: N + 1,
        depth: Math.min(...lines.map((l) => l.depth)),
        targetDepth: depth,
        cached: cachedHits,
        fen,
      });
    });
    if (fromCache) cachedHits++;
    positions.push(evalResult);
  }
  onProgress({ done: N + 1, total: N + 1, depth, targetDepth: depth, cached: cachedHits, fen: game.fens[N] });
  return buildReview(game, positions, depth);
}

/* ------------------------------------------------------------------ */
/*                         Классификация ходов                         */
/* ------------------------------------------------------------------ */

export function buildReview(game: ParsedGame, positions: PositionEval[], depth: number): GameReview {
  const N = game.moves.length;
  const book = analyzeBook(game.moves.map((m) => m.san));
  const reviews: MoveReview[] = [];

  for (let i = 0; i < N; i++) {
    const m = game.moves[i];
    const color = m.color;
    const before = positions[i];
    const after = positions[i + 1];
    const top = before.lines[0];
    const second = before.lines[1];
    const bestUci = top.pv[0];
    const playedIsBest = bestUci === m.uci;

    const scoreBefore = top.score;
    const scoreAfter: Score = playedIsBest ? top.score : after.lines[0].score;
    const winBefore = winFor(scoreBefore, color);
    const winAfter = playedIsBest ? winBefore : winFor(scoreAfter, color);
    const winLoss = Math.max(0, winBefore - winAfter);

    const cpBefore = cpFor(scoreBefore, color);
    const cpAfter = cpFor(scoreAfter, color);
    const cpLoss = Math.max(0, cpBefore - cpAfter);
    const prevLoss = i > 0 ? reviews[i - 1].winLoss : 0;
    const prevSan = i > 0 ? reviews[i - 1].san : undefined;

    const isBook = book.isBook[i];
    const legal = legalMoveCount(m.fenBefore);

    // --- жертва для Brilliant ---
    let sac = { sacrifice: false, amount: 0, pieceType: "" };
    if (!isBook && (playedIsBest || winLoss < 1) && m.piece !== "k") {
      sac = detectSacrifice(m.fenBefore, m.uci);
    }

    const mateForMoverBefore = scoreBefore.mate !== undefined && cpBefore > 0;
    const mateForMoverAfter = scoreAfter.mate !== undefined && cpAfter > 0;
    const lostMate = mateForMoverBefore && !mateForMoverAfter;
    const allowedMate = scoreAfter.mate !== undefined && cpAfter < 0 && !(scoreBefore.mate !== undefined && cpBefore < 0);

    // разрыв между 1-й и 2-й линиями (с точки зрения ходящего)
    let gapCp = 0;
    let gapWin = 0;
    if (second) {
      gapCp = cpBefore - cpFor(second.score, color);
      gapWin = winBefore - winFor(second.score, color);
    }

    let cls: Cls;
    let exceptionPawn = false;

    if (isBook) {
      cls = "book";
    } else if (playedIsBest || winLoss < 1) {
      cls = "best";
      // «опорная» оценка до хода: если жертва — единственный путь к выигрышу, смотрим на 2-ю линию
      const refCp = second ? Math.min(cpBefore, cpFor(second.score, color)) : cpBefore;
      const prevMove = i > 0 ? game.moves[i - 1] : null;
      const isRecapture = !!m.captured && !!prevMove?.captured && prevMove.to === m.to;
      if (sac.sacrifice && refCp <= 450 && winAfter >= 40 && m.piece !== "k") {
        cls = "brilliant";
      } else if (
        playedIsBest &&
        second &&
        legal > 1 &&
        (gapCp > 150 || gapWin > 10) &&
        winBefore <= 90 &&
        winBefore >= 8 &&
        !isRecapture
      ) {
        cls = "great";
      }
    } else {
      if (winLoss < 2) cls = "excellent";
      else if (winLoss < 5) cls = "good";
      else if (winLoss < 10) cls = "inaccuracy";
      else if (winLoss < 20) cls = "mistake";
      else cls = "blunder";

      if (lostMate && winLoss >= 5) cls = "blunder";
      if (allowedMate) cls = "blunder";

      // Исключение: потеря пешки при огромном перевесе — только неточность
      if ((cls === "mistake" || cls === "blunder") && !allowedMate && !lostMate && cpAfter >= 300 && cpLoss <= 300) {
        cls = "inaccuracy";
        exceptionPawn = true;
      }

      // Упущенное: соперник ошибся, а ход не нашёл опровержения → преимущество растаяло
      if (
        (cls === "inaccuracy" || cls === "mistake" || cls === "blunder") &&
        !exceptionPawn &&
        !allowedMate &&
        prevLoss >= 10 &&
        winLoss >= 10 &&
        winBefore >= 62 &&
        winAfter >= 30 &&
        winAfter <= 68
      ) {
        cls = "miss";
      }
    }

    const bestSan = uciToSan(m.fenBefore, bestUci);
    const secondSan = uciToSan(m.fenBefore, second?.pv[0]);
    const opening = book.opening[i];
    const isMateMove = positions[i + 1].lines[0].score.terminal === true && positions[i + 1].lines[0].score.mate !== undefined;
    const isCheck = m.san.includes("+") || m.san.includes("#");

    const accuracy = moveAccuracy(winLoss);

    const comment = buildComment({
      cls,
      color,
      san: m.san,
      uci: m.uci,
      piece: m.piece,
      captured: m.captured,
      fenBefore: m.fenBefore,
      fenAfter: m.fenAfter,
      bestUci,
      bestSan,
      playedIsBest,
      scoreBefore,
      scoreAfter,
      winBefore,
      winAfter,
      winLoss,
      sacrifice: sac.sacrifice,
      sacrificePiece: sac.pieceType || m.piece,
      opening,
      linesBefore: before.lines,
      linesAfter: after.lines,
      prevOpponentLoss: prevLoss,
      prevOpponentSan: prevSan,
      legalMoves: legal,
      isCheck,
      isMate: isMateMove,
      exceptionPawn,
      bestSecondGapCp: gapCp,
      bestSecondSan: secondSan,
    });

    reviews.push({
      index: i,
      color,
      san: m.san,
      uci: m.uci,
      from: m.from,
      to: m.to,
      piece: m.piece,
      captured: m.captured,
      fenBefore: m.fenBefore,
      fenAfter: m.fenAfter,
      cls,
      scoreBefore,
      scoreAfter,
      winBefore,
      winAfter,
      winLoss,
      accuracy,
      bestUci,
      bestSan,
      secondUci: second?.pv[0],
      playedIsBest,
      sacrifice: sac.sacrifice,
      opening,
      comment,
      lines: before.lines,
    });
  }

  const scores = positions.map((p) => p.lines[0].score);
  const winSeries = scores.map(winPercent);
  const acc = gameAccuracy(
    winSeries,
    reviews.map((r) => r.accuracy),
    reviews.map((r) => r.color)
  );
  const counts = { w: emptyCounts(), b: emptyCounts() };
  for (const r of reviews) counts[r.color][r.cls]++;

  const whiteElo = parseInt(game.headers.WhiteElo ?? "", 10);
  const blackElo = parseInt(game.headers.BlackElo ?? "", 10);
  const rating = {
    w: estimateGameRating(acc.w, Number.isFinite(whiteElo) ? whiteElo : undefined),
    b: estimateGameRating(acc.b, Number.isFinite(blackElo) ? blackElo : undefined),
  };

  let opening = book.last;
  if (!opening && game.headers.ECO) opening = openingForCode(game.headers.ECO);

  return {
    headers: game.headers,
    startFen: game.startFen,
    moves: reviews,
    fens: game.fens,
    scores,
    positions,
    winSeries,
    accuracy: acc,
    counts,
    rating,
    opening,
    depth,
  };
}
