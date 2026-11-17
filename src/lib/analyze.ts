/**
 * Конвейер обзора партии: разбор PGN → анализ Stockfish 19 (MultiPV 2, с кэшем и историей ходов)
 * → рейтинговый Expected Points (приближение) → классификация → собственная точность Chessmart → комментарии.
 *
 * Бюджет времени: на основную часть партии отводится 0.4 с на каждый полуход (10 ходов → 6 с, 20 → 12 с, 30 → 18 с…).
 * Бюджет делится динамически: если позиция посчитана быстрее (достигнута целевая глубина, ход единственный,
 * позиция взята из кэша), сэкономленное время достаётся следующим позициям, а общий анализ
 * завершается раньше. Время зря не тратится — Stockfish останавливается, как только достиг глубины.
 */
import { Chess, type Square } from "chess.js";
import type { Cls, Color, EngineLine, GameReview, MoveReview, PositionEval, Score } from "../types";
import { emptyCounts } from "../types";
import type { PositionHistory, StockfishEngine } from "./engine";
import { getCachedPosition, putCachedPosition } from "./db";
import { analyzeBook, openingForCode } from "./openings";
import { detectSacrifice } from "./see";
import { BRILLIANT_MAX_LOSS, BRILLIANT_MIN_AFTER, qualifiesAsBrilliant } from "./brilliant";
import { buildComment } from "./coach";
import { cpFor, estimateGameRating, gameAccuracy, moveAccuracy, winFor, winForRated, winPercent } from "./winprob";

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

/* ------------------------------------------------------------------ */
/*                        Бюджет времени анализа                       */
/* ------------------------------------------------------------------ */

import { gameBudgetMs, slotForPosition } from "./analysisBudget";
export { TIME_PER_MOVE_MS, gameBudgetMs, slotForPosition } from "./analysisBudget";

/** @deprecated Время теперь считается от длины партии (см. gameBudgetMs), оставлено для совместимости. */
export const FAST_MAX_DEPTH = 14;
/** @deprecated Оставлено для совместимости. */
export const FAST_MOVETIME_MS = 4000;
/** @deprecated Используйте gameBudgetMs / slotForPosition. */
export function moveTimeForDepth(depth: number): number | undefined {
  return depth <= FAST_MAX_DEPTH ? FAST_MOVETIME_MS : undefined;
}

/** Результаты, недосчитанные глубже этого порога, не кэшируем (иначе слабая оценка закрепится в кэше навсегда). */
const MIN_CACHEABLE_DEPTH = 8;
/** Кэшированная оценка не глубже этого значения считается «слишком слабой» и пересчитывается. */
const CACHE_ACCEPT_DEPTH = 16;

/* ------------------------------------------------------------------ */
/*        Параметры классификации (по Chess.com Classification V2)     */
/* ------------------------------------------------------------------ */
/*
 * Что известно из официальной справки Chess.com (support.chess.com, статья «How are moves classified?»):
 *  - ходы классифицируются по потере «ожидаемых очков» (0..1), которые зависят от рейтинга игрока и оценки движка:
 *    Best 0, Excellent ≤0.02, Good ≤0.05, Inaccuracy ≤0.10, Mistake ≤0.20, Blunder >0.20;
 *  - Brilliant: всегда лучший или почти лучший ход + хорошая жертва ФИГУРЫ; после него позиция не плохая;
 *    без него вы не были бы полностью выигрывающим; для новичков определение жертвы щедрее;
 *  - Great: ход, критичный для исхода (проигрыш → равенство, равенство → выигрыш, единственный хороший ход);
 *    для новичков щедрее;
 *  - Miss: не использовали ошибку соперника; пороги «выигрыш/равенство/проигрыш» зависят от рейтинга.
 * Конкретные числа ниже, помеченные «приближение», Chess.com не публикует.
 */

/** Числовые приближения критериев Brilliant вынесены в ./brilliant. */

/** Best: лучший ход движка либо ход, теряющий пренебрежимо мало (п.п. ожидаемых очков). */
/** Great: на сколько п.п. ожидаемых очков вторая линия хуже лучшей (для новичков щедрее; приближение). */
function greatGapFor(elo?: number): number {
  if (elo === undefined) return 14;
  if (elo < 800) return 10;
  if (elo < 1400) return 12;
  return 14;
}
/** Границы «проигрыш / равенство / выигрыш» в ожидаемых очках, % (приближение). */
const BAND_LOSING = 35;
const BAND_WINNING = 65;
const bandOf = (w: number) => (w >= BAND_WINNING ? 2 : w >= BAND_LOSING ? 1 : 0);

/** Углублённая перепроверка ходов-жертв (см. refineSacrifices). */
const REFINE_DEPTH_BONUS = 6;
const REFINE_MOVETIME_MS = 900;
const REFINE_MAX_MOVES = 8;
/** Общий потолок времени на перепроверку, мс. */
const REFINE_TOTAL_BUDGET_MS = 1400;
/** Shared hard deadline for all optional tactical passes after the main review. */
const TACTICAL_EXTRA_BUDGET_MS = 2400;

function playerElo(headers: Record<string, string>, c: Color): number | undefined {
  const v = parseInt(headers[c === "w" ? "WhiteElo" : "BlackElo"] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

export interface AnalyzeProgress {
  done: number;
  total: number;
  depth: number; // текущая достигнутая глубина
  targetDepth: number;
  cached: number;
  fen: string;
  /** Общий бюджет времени на партию, мс. */
  budgetMs?: number;
  /** Сколько времени уже прошло с начала анализа, мс. */
  elapsedMs?: number;
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
  onInfo?: (lines: EngineLine[]) => void,
  movetimeMs?: number,
  history?: PositionHistory
): Promise<{ evalResult: PositionEval; fromCache: boolean }> {
  const term = terminalEval(fen);
  if (term) return { evalResult: term, fromCache: true };
  const historyKey = history ? `${history.startFen}|${history.moves.join(" ")}` : undefined;
  const cached = await getCachedPosition(fen, depth, multipv, historyKey);
  // Раньше любой кэш (даже глубины 8, посчитанный за 120 мс) навсегда подменял анализ на заданную глубину.
  // Теперь кэш принимается, только если он достаточно глубок; иначе позиция пересчитывается.
  if (cached && cached.depth >= Math.min(depth, CACHE_ACCEPT_DEPTH)) return { evalResult: cached, fromCache: true };
  const handle = engine.search({ fen, depth, multipv, movetimeMs, onInfo, history });
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
  // новый результат не глубже старого кэша — оставляем старый
  if (cached && cached.depth >= reached) return { evalResult: cached, fromCache: true };
  // Недосчитанный по глубине (из-за лимита времени) результат кэшируем, только если он не слишком слабый.
  // В кэше хранится реально достигнутая глубина (reached), а ключ — запрошенная.
  if (reached >= Math.min(depth, MIN_CACHEABLE_DEPTH)) {
    await putCachedPosition(fen, depth, multipv, lines, reached, historyKey);
  }
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

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * @param moveTimeMs  необязательный ФИКСИРОВАННЫЙ лимит на позицию (мс). Если не задан —
 *                    используется адаптивный бюджет: 0.6 с × число ходов на всю партию.
 */
export async function reviewGame(
  pgn: string,
  depth: number,
  engine: StockfishEngine,
  onProgress: (p: AnalyzeProgress) => void,
  signal?: AbortSignal,
  moveTimeMs?: number,
  onPartialReview?: (review: GameReview) => void
): Promise<GameReview> {
  const game = parseGame(pgn);
  const N = game.moves.length;
  const total = N + 1;
  const budgetMs = gameBudgetMs(N);
  const startedAt = now();
  engine.newGame();
  const positions: PositionEval[] = [];
  let cachedHits = 0;
  for (let i = 0; i <= N; i++) {
    if (signal?.aborted) throw new Error("cancelled");
    const fen = game.fens[i];
    // Время на эту позицию: остаток бюджета / число оставшихся позиций (экономия переходит дальше).
    const slot = moveTimeMs ?? slotForPosition(budgetMs, now() - startedAt, total - i);
    onProgress({
      done: i,
      total,
      depth: 0,
      targetDepth: depth,
      cached: cachedHits,
      fen,
      budgetMs,
      elapsedMs: now() - startedAt,
    });
    const { evalResult, fromCache } = await evaluatePosition(
      engine,
      fen,
      depth,
      2,
      signal,
      (lines) => {
        onProgress({
          done: i,
          total,
          depth: Math.min(...lines.map((l) => l.depth)),
          targetDepth: depth,
          cached: cachedHits,
          fen,
          budgetMs,
          elapsedMs: now() - startedAt,
        });
      },
      slot,
      { startFen: game.startFen, moves: game.moves.slice(0, i).map((move) => move.uci) }
    );
    if (fromCache) cachedHits++;
    positions.push(evalResult);
  }
  onProgress({
    done: total,
    total,
    depth,
    targetDepth: depth,
    cached: cachedHits,
    fen: game.fens[N],
    budgetMs,
    elapsedMs: now() - startedAt,
  });

  if (signal?.aborted) throw new Error("cancelled");
  // Publish a complete, immediately usable review before the optional deep
  // tactical passes. The same positions are refined below and the caller gets
  // the final, higher-confidence result from the returned Promise.
  onPartialReview?.(buildReview(game, positions, depth));

  const tacticalDeadline = now() + TACTICAL_EXTRA_BUDGET_MS;
  const refineDeadline = Math.min(tacticalDeadline, now() + REFINE_TOTAL_BUDGET_MS);
  await refineSacrifices(game, positions, depth, engine, onProgress, signal, refineDeadline);
  const deferredSacrifices = await findDeferredBrilliantContinuations(game, positions, depth, engine, signal, tacticalDeadline);
  return buildReview(game, positions, depth, deferredSacrifices);
}

/**
 * Быстрый анализ (ограниченный бюджет на полуход) на малой глубине часто «не видит» компенсации за жертву, и жертвенный ход
 * выглядит как потеря нескольких процентов. Поэтому ходы-жертвы перепроверяем глубже:
 * перезаписываем оценки позиций «до» и «после» хода, если новый результат глубже прежнего.
 * Перепроверка ограничена общей тактической квотой и не может бесконечно продлевать обзор.
 */
async function refineSacrifices(
  game: ParsedGame,
  positions: PositionEval[],
  depth: number,
  engine: StockfishEngine,
  onProgress: (p: AnalyzeProgress) => void,
  signal?: AbortSignal,
  deadlineAt = now() + REFINE_TOTAL_BUDGET_MS
): Promise<void> {
  const N = game.moves.length;
  const book = analyzeBook(game.moves.map((m) => m.san));
  const candidates: { i: number; amount: number }[] = [];
  for (let i = 0; i < N; i++) {
    const m = game.moves[i];
    if (book.isBook[i] || m.piece === "k" || m.piece === "p") continue;
    const top = positions[i].lines[0];
    const after = positions[i + 1].lines[0];
    if (!top || !after || positions[i + 1].depth === 0) continue; // терминальные позиции не трогаем
    const elo = playerElo(game.headers, m.color);
    // Не отбрасываем кандидата из-за большой потери в быстром поиске: именно сложные жертвы
    // чаще всего выглядят плохо до углублённого расчёта компенсации.
    const sac = detectSacrifice(m.fenBefore, m.uci, elo);
    if (sac.sacrifice) candidates.push({ i, amount: sac.amount });
  }
  candidates.sort((a, b) => b.amount - a.amount);
  const targetDepth = depth + REFINE_DEPTH_BONUS;
  for (const { i } of candidates.slice(0, REFINE_MAX_MOVES)) {
    for (const idx of [i, i + 1]) {
      if (signal?.aborted) throw new Error("cancelled");
      const remainingMs = Math.floor(deadlineAt - now());
      if (remainingMs <= 0) return;
      onProgress({
        done: game.moves.length,
        total: game.moves.length + 1,
        depth: 0,
        targetDepth,
        cached: 0,
        fen: game.fens[idx],
      });
      try {
        const { evalResult } = await evaluatePosition(
          engine, game.fens[idx], targetDepth, 2, signal, undefined, Math.min(REFINE_MOVETIME_MS, remainingMs),
          { startFen: game.startFen, moves: game.moves.slice(0, idx).map((move) => move.uci) }
        );
        if (evalResult.depth > positions[idx].depth) positions[idx] = evalResult;
      } catch (e) {
        if (e instanceof Error && e.message === "cancelled") throw e;
        /* перепроверка — это бонус: при любой другой ошибке остаёмся с быстрой оценкой */
      }
    }
  }
}



/**
 * Проверяет продолжение уже совершённой жертвы.
 * Если соперник отказался брать фигуру, а она всё ещё может быть взята,
 * проверяем движком каждое такое взятие из позиции после следующего хода жертвовавшей стороны.
 * Продолжение становится Brilliant только пока любое принятие жертвы остаётся плохим для соперника.
 */
async function findDeferredBrilliantContinuations(
  game: ParsedGame,
  positions: PositionEval[],
  depth: number,
  engine: StockfishEngine,
  signal?: AbortSignal,
  deadlineAt = now() + 1000
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const book = analyzeBook(game.moves.map((move) => move.san));
  const remainingBudget = () => Math.max(0, Math.floor(deadlineAt - now()));
  const maxContinuations = 16;
  const captureEvaluations = new Map<string, number>();

  const captureStillLoses = async (
    fen: string, square: string, piece: string, sacrificeColor: Color, elo: number | undefined,
    historyMoves: string[]
  ): Promise<boolean> => {
    let chess: Chess;
    try {
      chess = new Chess(fen);
    } catch {
      return false;
    }
    const captures = chess.moves({ verbose: true }).filter((move) => move.to === square && move.captured === piece);
    if (!captures.length) return false;

    let worstForSacrificer = 100;
    for (const capture of captures) {
      if (signal?.aborted) throw new Error("cancelled");
      if (remainingBudget() <= 0) return false;
      const afterCapture = new Chess(fen);
      const played = afterCapture.move({ from: capture.from, to: capture.to, promotion: capture.promotion });
      if (!played) return false;
      const captureUci = capture.from + capture.to + (capture.promotion ?? "");
      const cacheKey = `${afterCapture.fen()}|${sacrificeColor}|${historyMoves.join(" ")}`;
      let chance = captureEvaluations.get(cacheKey);
      if (chance === undefined) {
        // evaluatePosition использует общий кэш FEN; локальный кэш убирает повторные проверки той же позиции.
        const evaluated = await evaluatePosition(
          engine,
          afterCapture.fen(),
          Math.min(24, Math.max(16, depth + 4)),
          1,
          signal,
          undefined,
          Math.min(700, remainingBudget()),
          { startFen: game.startFen, moves: [...historyMoves, captureUci] }
        );
        chance = winForRated(evaluated.evalResult.lines[0].score, sacrificeColor, elo);
        captureEvaluations.set(cacheKey, chance);
      }
      worstForSacrificer = Math.min(worstForSacrificer, chance);
      // Соперник выберет наиболее выгодное для себя из доступных взятий.
      if (worstForSacrificer < BRILLIANT_MIN_AFTER) return false;
    }
    return worstForSacrificer >= BRILLIANT_MIN_AFTER;
  };

  for (let i = 0; i < game.moves.length; i++) {
    if (signal?.aborted) throw new Error("cancelled");
    if (remainingBudget() <= 0) break;
    const sacrificeMove = game.moves[i];
    if (book.isBook[i] || sacrificeMove.piece === "p" || sacrificeMove.piece === "k" || i + 2 >= game.moves.length) continue;

    const before = positions[i];
    const after = positions[i + 1];
    const best = before.lines[0];
    const second = before.lines[1];
    if (!best || !after.lines[0]) continue;
    const elo = playerElo(game.headers, sacrificeMove.color);
    const sacrifice = detectSacrifice(sacrificeMove.fenBefore, sacrificeMove.uci, elo);
    if (!sacrifice.sacrifice) continue;

    const playedIsBest = best.pv[0] === sacrificeMove.uci;
    const winBefore = winForRated(best.score, sacrificeMove.color, elo);
    const scoreAfter = playedIsBest ? best.score : after.lines[0].score;
    const winAfter = playedIsBest ? winBefore : winForRated(scoreAfter, sacrificeMove.color, elo);
    const winLoss = Math.max(0, winBefore - winAfter);
    const altWin = playedIsBest ? (second ? winForRated(second.score, sacrificeMove.color, elo) : null) : winBefore;
    const legal = legalMoveCount(sacrificeMove.fenBefore);
    const cpBefore = cpFor(best.score, sacrificeMove.color);
    const cpAfter = cpFor(scoreAfter, sacrificeMove.color);
    const lostMate = best.score.mate !== undefined && cpBefore > 0 && !(scoreAfter.mate !== undefined && cpAfter > 0);
    const allowedMate = scoreAfter.mate !== undefined && cpAfter < 0 && !(best.score.mate !== undefined && cpBefore < 0);
    const initialIsBrilliant = qualifiesAsBrilliant({
      sacrifice: sacrifice.sacrifice,
      legalMoves: legal,
      alternativeWin: altWin,
      lostMate,
      allowedMate,
      winLoss,
      winAfter,
      elo,
    });
    if (!initialIsBrilliant) continue;

    const targetSquare = sacrificeMove.to;
    const targetPiece = sacrificeMove.piece;
    // Сначала проверяем, что принять саму жертву уже было бы плохим решением.
    const canTakeAndPunish = await captureStillLoses(
      sacrificeMove.fenAfter, targetSquare, targetPiece, sacrificeMove.color, elo,
      game.moves.slice(0, i + 1).map((move) => move.uci)
    );
    if (!canTakeAndPunish) continue;

    // Первый ответ соперника должен отказаться от взятия. После него очередь снова за нами.
    let opponentIndex = i + 1;
    let continuationIndex = i + 2;
    let steps = 0;
    while (continuationIndex < game.moves.length && steps < maxContinuations && remainingBudget() > 0) {
      const opponentMove = game.moves[opponentIndex];
      const continuation = game.moves[continuationIndex];
      if (!opponentMove || !continuation) break;
      if (opponentMove.to === targetSquare && opponentMove.captured === targetPiece) break;

      let beforeContinuation: Chess;
      try {
        beforeContinuation = new Chess(continuation.fenBefore);
      } catch {
        break;
      }
      const hangingPiece = beforeContinuation.get(targetSquare as Square);
      if (!hangingPiece || hangingPiece.color !== sacrificeMove.color || hangingPiece.type !== targetPiece) break;

      // Если наш ход уводит фигуру или позволяет сопернику успешно принять жертву — цепочка заканчивается.
      const stillPunishesTake = await captureStillLoses(
        continuation.fenAfter, targetSquare, targetPiece, sacrificeMove.color, elo,
        game.moves.slice(0, continuationIndex + 1).map((move) => move.uci)
      );
      if (!stillPunishesTake) break;

      const continuationBefore = positions[continuationIndex]?.lines[0];
      const continuationAfter = positions[continuationIndex + 1]?.lines[0];
      if (continuationBefore && continuationAfter) {
        const continuationWinBefore = winForRated(continuationBefore.score, sacrificeMove.color, elo);
        const continuationWinAfter = winForRated(continuationAfter.score, sacrificeMove.color, elo);
        const continuationLoss = Math.max(0, continuationWinBefore - continuationWinAfter);
        if (qualifiesAsBrilliant({
          sacrifice: true,
          legalMoves: legalMoveCount(continuation.fenBefore),
          alternativeWin: null,
          lostMate: false,
          allowedMate: false,
          winLoss: continuationLoss,
          winAfter: continuationWinAfter,
          elo,
          continuation: true,
        })) {
          result.set(continuationIndex, targetPiece);
        }
      }

      // Следующий ход соперника снова может принять жертву или изменить тактическую ситуацию.
      opponentIndex = continuationIndex + 1;
      continuationIndex = opponentIndex + 1;
      steps++;
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*                         Классификация ходов                         */
/* ------------------------------------------------------------------ */

export function buildReview(
  game: ParsedGame,
  positions: PositionEval[],
  depth: number,
  deferredSacrifices: Map<number, string> = new Map()
): GameReview {
  const N = game.moves.length;
  const book = analyzeBook(game.moves.map((m) => m.san));
  const reviews: MoveReview[] = [];
  const eloOf = (c: Color): number | undefined => playerElo(game.headers, c);

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
    // При лимите времени позиции считаются до разной глубины. Если сыгран ход со 2-й линии,
    // его оценка уже есть в поиске «до хода»; берём ту из двух оценок, что посчитана глубже
    // (терминальные позиции с depth 0 не трогаем), чтобы разница глубин не давала ложный winLoss.
    const playedSecond = !playedIsBest && !!second && second.pv[0] === m.uci;
    const preferSecond = playedSecond && after.depth > 0 && after.depth < second!.depth;
    const scoreAfter: Score = playedIsBest ? top.score : preferSecond ? second!.score : after.lines[0].score;
    const elo = eloOf(color);
    // Приближение рейтинговых Expected Points для порогов Classification V2; модель Chess.com закрыта.
    const winBefore = winForRated(scoreBefore, color, elo);
    const winAfter = playedIsBest ? winBefore : winForRated(scoreAfter, color, elo);
    const winLoss = Math.max(0, winBefore - winAfter);
    // Точность хода считается по стандартной кривой (формула Lichess), без рейтинга.
    const stdBefore = winFor(scoreBefore, color);
    const stdAfter = playedIsBest ? stdBefore : winFor(scoreAfter, color);
    const accuracyLoss = Math.max(0, stdBefore - stdAfter);

    const cpBefore = cpFor(scoreBefore, color);
    const cpAfter = cpFor(scoreAfter, color);
    const prevLoss = i > 0 ? reviews[i - 1].winLoss : 0;
    const prevSan = i > 0 ? reviews[i - 1].san : undefined;

    const isBook = book.isBook[i];
    const legal = legalMoveCount(m.fenBefore);

    // --- жертва для Brilliant ---
    let sac = { sacrifice: false, amount: 0, pieceType: "" };
    if (!isBook && (playedIsBest || winLoss <= BRILLIANT_MAX_LOSS) && m.piece !== "k" && m.piece !== "p") {
      sac = detectSacrifice(m.fenBefore, m.uci, elo);
    }
    const deferredPiece = deferredSacrifices.get(i);
    const isDeferredBrilliant = !!deferredPiece;

    const mateForMoverBefore = scoreBefore.mate !== undefined && cpBefore > 0;
    const mateForMoverAfter = scoreAfter.mate !== undefined && cpAfter > 0;
    const lostMate = mateForMoverBefore && !mateForMoverAfter;
    const allowedMate = scoreAfter.mate !== undefined && cpAfter < 0 && !(scoreBefore.mate !== undefined && cpBefore < 0);

    // разрыв между 1-й и 2-й линиями (с точки зрения ходящего)
    let gapCp = 0;
    let gapWin = 0;
    if (second) {
      gapCp = cpBefore - cpFor(second.score, color);
      gapWin = winBefore - winForRated(second.score, color, elo);
    }

    let cls: Cls;

    // Brilliant (Chess.com): хорошая жертва фигуры, ход лучший или почти лучший,
    // после него позиция не плохая, и без него вы не были бы полностью выигрывающим.
    // «Лучшая альтернатива»: если сыгран лучший ход — вторая линия; если почти лучший — лучшая линия.
    const altWin = playedIsBest ? (second ? winForRated(second.score, color, elo) : null) : winBefore;
    const isBrilliant = qualifiesAsBrilliant({
      sacrifice: sac.sacrifice || isDeferredBrilliant,
      legalMoves: legal,
      alternativeWin: altWin,
      lostMate,
      allowedMate,
      winLoss,
      winAfter,
      elo,
      continuation: isDeferredBrilliant,
    });

    if (isBook) {
      cls = "book";
    } else if (isBrilliant) {
      cls = "brilliant";
    } else if (playedIsBest) {
      cls = "best";
      // Great (Chess.com): критичный ход — единственный хороший ход (вторая линия заметно хуже)
      // либо ход, сохраняющий/переводящий позицию в более высокую категорию, чем любая альтернатива.
      const secondWin = winBefore - gapWin;
      const crossesBand = bandOf(winBefore) > bandOf(secondWin) && gapWin >= 5;
      if (
        playedIsBest &&
        second &&
        legal > 1 &&
        (gapWin >= greatGapFor(elo) || crossesBand) &&
        winBefore <= 90 &&
        winBefore >= 8
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

      // Miss (Chess.com): соперник ошибся, а ход не использовал это и вернул большую часть (от половины до
      // двойного размера ошибки) выигрышных шансов → позиция стала равной или хуже. Пороги — приближение.
      if (
        (cls === "inaccuracy" || cls === "mistake" || cls === "blunder") &&
        !allowedMate &&
        prevLoss >= 10 &&
        winLoss >= Math.max(8, prevLoss * 0.5) &&
        winLoss <= prevLoss * 2 &&
        winBefore >= 58 &&
        winAfter >= 25 &&
        winAfter <= 62
      ) {
        cls = "miss";
      }
    }

    const bestSan = uciToSan(m.fenBefore, bestUci);
    const secondSan = uciToSan(m.fenBefore, second?.pv[0]);
    const opening = book.opening[i];
    const isMateMove = positions[i + 1].lines[0].score.terminal === true && positions[i + 1].lines[0].score.mate !== undefined;
    const isCheck = m.san.includes("+") || m.san.includes("#");

    const accuracy = moveAccuracy(accuracyLoss);

    const generatedComment = buildComment({
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
      bestSecondGapCp: gapCp,
      bestSecondSan: secondSan,
    });
    const comment = isDeferredBrilliant
      ? `Блестящее продолжение жертвы: вы оставили фигуру под боем, но соперник всё ещё не может безопасно её забрать. ${generatedComment}`
      : generatedComment;

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
      sacrifice: sac.sacrifice || isDeferredBrilliant,
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
