/**
 * Конвейер обзора партии: разбор PGN → анализ Stockfish 19 (MultiPV 2, с кэшем и историей ходов)
 * → рейтинговый Expected Points (приближение) → классификация → собственная точность Chessmart → комментарии.
 *
 * Основной проход: каждая позиция получает отдельный UCI movetime (300 / 1000 / 3000 мс).
 * Поиск ограничен depth 22 и временем одновременно; выполняется то условие, которое наступит раньше.
 * При таймауте используется последняя завершённая строка info, затем очередь переходит дальше.
 */
import { Chess, type Square } from "chess.js";
import type { Cls, Color, EngineLine, GameReview, MoveReview, PositionEval, Score } from "../types";
import { emptyCounts } from "../types";
import type { PositionHistory, StockfishEngine } from "./engine";
import { getCachedPosition, putCachedPosition } from "./db";
import { analyzeBook, openingForCode } from "./openings";
import { detectSacrifice } from "./see";
import { findPersistentSacrificeContinuation } from "./persistentSacrifice";
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

import { estimateParallelBudgetMs, resolveAnalysisBudget, type AnalysisConfig } from "./analysisBudget";
import { isSacrificeVerificationCandidate, rankCriticalPositions, shouldRecheckCriticalPosition } from "./criticalPositionRanking";
import { classifyMove } from "./moveClassification";
import { hasOnlyLegalMove } from "./forcedMove";
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
function playerElo(headers: Record<string, string>, c: Color): number | undefined {
  const v = parseInt(headers[c === "w" ? "WhiteElo" : "BlackElo"] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

export interface ReviewComputeProfile {
  mainMultiPv: number;
  /** Maximum number of critical positions (including sacrifices and missed-mate candidates) to verify after the main pass. */
  verifierMaxMoves?: number;
  /** Extra search time for each selected critical position. */
  verifierMoveTimeMs?: number;
  /** Total extra verification budget supplied by the device profile. */
  tacticalExtraBudgetMs?: number;
  device?: "desktop" | "mobile";
  reviewWorkers?: number;
}

export interface AnalyzeProgress {
  done: number;
  total: number;
  depth: number; // текущая достигнутая глубина
  targetDepth: number;
  cached: number;
  fen: string;
  /** Approximate parallel budget; not a completion-time guarantee. */
  budgetMs?: number;
  elapsedMs?: number;
  activeWorkers?: number;
  queued?: number;
  stage?: "scan" | "verify" | "finalize";
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
  history?: PositionHistory,
  nodes?: number,
  depthLimit?: number,
): Promise<{ evalResult: PositionEval; fromCache: boolean }> {
  const term = terminalEval(fen);
  if (term) return { evalResult: term, fromCache: true };
  const historyKey = history ? `${history.startFen}|${history.moves.join(" ")}` : undefined;
  const cached = await getCachedPosition(fen, depth, multipv, historyKey);
  // Reuse only a result that completed the target depth. Partial cache entries
  // remain available as fallbacks if a fresh timed search reaches less depth.
  // A shallow timed-out cache entry must not skip a fresh timed search.
  const requiredCacheDepth = depth;
  if (cached && cached.depth >= requiredCacheDepth) return { evalResult: cached, fromCache: true };
  const handle = engine.search({ fen, depth: depthLimit, multipv, movetimeMs, nodes, onInfo, history });
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

export interface CriticalPositionCandidate {
  index: number;
  priority: number;
  estimatedLoss: number;
  secondLineGap: number;
  sacrifice: boolean;
}

/**
 * Pick positions where a shallow first pass is most likely to misjudge the played move:
 * meaningful evaluation loss, a forced/critical second-line gap, or tactical complications.
 * Opening-book moves are intentionally excluded.
 */
export function selectCriticalPositions(
  game: ParsedGame,
  positions: PositionEval[],
  maxCandidates = 3,
  sacrificesOnly = false,
): CriticalPositionCandidate[] {
  const book = analyzeBook(game.moves.map((move) => move.san));
  const candidates: CriticalPositionCandidate[] = [];

  for (let i = 0; i < game.moves.length; i++) {
    if (book.isBook[i]) continue;
    const move = game.moves[i];
    const before = positions[i];
    const after = positions[i + 1];
    const best = before?.lines[0];
    const playedAfter = after?.lines[0];
    if (!best || !playedAfter || after.depth === 0) continue;

    const elo = playerElo(game.headers, move.color);
    const bestWin = winForRated(best.score, move.color, elo);
    const playedWin = best.pv[0] === move.uci
      ? bestWin
      : winForRated(playedAfter.score, move.color, elo);
    const estimatedLoss = Math.max(0, bestWin - playedWin);
    const second = before.lines[1];
    const secondLineGap = second
      ? Math.max(0, bestWin - winForRated(second.score, move.color, elo))
      : 0;
    const legal = legalMoveCount(move.fenBefore);
    const sacrifice = move.piece !== "p" && move.piece !== "k"
      ? detectSacrifice(move.fenBefore, move.uci, elo).sacrifice
      : false;
    const tactical = !!move.captured || move.san.includes("+") || move.san.includes("#")
      || move.uci.length > 4 || sacrifice;
    // Mate scores are especially easy to miss with a short first pass because
    // expected-points curves saturate near 100%. Recheck a candidate when the
    // engine has found a forced mating route for the mover, even if EP loss is tiny.
    const mateOpportunity = best.score.mate !== undefined
      && cpFor(best.score, move.color) > 0;
    // A sound piece sacrifice may be the engine's first choice and therefore lose
    // zero expected points. It still needs a deeper verification pass.
    const sacrificeCandidate = isSacrificeVerificationCandidate(
      sacrifice,
      legal,
      best.pv[0] === move.uci,
      estimatedLoss,
      BRILLIANT_MAX_LOSS,
    );
    if (sacrificesOnly && !sacrificeCandidate) continue;

    if (!shouldRecheckCriticalPosition(estimatedLoss, secondLineGap, legal, tactical, mateOpportunity)
      && !sacrificeCandidate) continue;

    const priority = estimatedLoss * 2
      + Math.min(secondLineGap, 30) * 0.55
      + (tactical ? 4 : 0)
      + (sacrificeCandidate ? 24 : 0)
      + (mateOpportunity ? 36 : 0)
      + Math.min(legal, 40) * 0.04;
    candidates.push({ index: i, priority, estimatedLoss, secondLineGap, sacrifice: sacrificeCandidate });
  }

  return rankCriticalPositions(candidates, maxCandidates);
}


/**
 * Runs the timed main pass, then spends a small device-aware reserve on critical
 * positions so shallow MultiPV results cannot hide tactical errors, mate threats or sacrifices.
 */
/**
 * Two-pass whole-game review: concurrent MultiPV=1 scan, then targeted MultiPV=2 checks.
 * Independent positions are distributed across a small pool of local Stockfish workers.
 */
export async function reviewGame(
  pgn: string,
  analysisConfig: AnalysisConfig | number,
  engineOrPool: StockfishEngine | readonly StockfishEngine[],
  onProgress: (p: AnalyzeProgress) => void,
  signal?: AbortSignal,
  computeProfile?: ReviewComputeProfile
): Promise<GameReview> {
  const game = parseGame(pgn);
  const N = game.moves.length;
  const totalPositions = N + 1;
  const engines: StockfishEngine[] = Array.isArray(engineOrPool)
    ? [...engineOrPool]
    : [engineOrPool as StockfishEngine];
  if (!engines.length) throw new Error("Пул Stockfish пуст.");

  const budget = resolveAnalysisBudget(
    analysisConfig,
    { device: computeProfile?.device, reviewWorkers: computeProfile?.reviewWorkers },
    N,
  );
  const maxVerificationChecks = Math.max(0, Math.min(10,
    Math.floor(computeProfile?.verifierMaxMoves ?? 4)));
  const progressTotal = totalPositions + maxVerificationChecks;
  const startedAt = now();
  const positions: Array<PositionEval | undefined> = new Array(totalPositions);
  const forcedMoves = new Map<number, string>();
  const tasks: number[] = [];
  let cachedHits = 0;
  let completedTasks = 0;
  let activeWorkers = 0;
  let terminalPositions = 0;

  for (let i = 0; i < totalPositions; i++) {
    if (signal?.aborted) throw new Error("cancelled");
    const terminal = terminalEval(game.fens[i]);
    if (terminal) {
      positions[i] = terminal;
      terminalPositions++;
      continue;
    }

    // If there is exactly one legal move, reuse the successor's White-centric
    // evaluation. This saves one search without inventing a score or a new label.
    if (i < N) {
      const legal = new Chess(game.fens[i]).moves({ verbose: true });
      if (legal.length === 1) {
        const forcedUci = legal[0].from + legal[0].to + (legal[0].promotion ?? "");
        if (forcedUci === game.moves[i].uci) {
          forcedMoves.set(i, forcedUci);
          continue;
        }
      }
    }
    tasks.push(i);
  }

  // Current ECO data stores opening names/theory labels, not Polyglot positions
  // with precomputed scores. Keep these positions in the scan rather than fabricating evals.
  for (const worker of engines) worker.newGame();
  const scanBudgetMs = estimateParallelBudgetMs(tasks.length, budget.movetimeMs, engines.length);
  const doneCount = () => terminalPositions + completedTasks;

  onProgress({
    done: doneCount(),
    total: progressTotal,
    depth: 0,
    targetDepth: budget.targetDepth,
    cached: cachedHits,
    fen: game.fens[0],
    budgetMs: scanBudgetMs,
    elapsedMs: now() - startedAt,
    activeWorkers: 0,
    queued: tasks.length,
    stage: "scan",
  });

  let cursor = 0;
  let firstWorkerError: unknown = null;
  await Promise.all(engines.map(async (worker) => {
    while (!signal?.aborted && !firstWorkerError) {
      const taskPosition = cursor++;
      if (taskPosition >= tasks.length) return;
      const index = tasks[taskPosition];
      const fen = game.fens[index];
      const history = {
        startFen: game.startFen,
        moves: game.moves.slice(0, index).map((move) => move.uci),
      };
      activeWorkers++;
      onProgress({
        done: doneCount(),
        total: progressTotal,
        depth: 0,
        targetDepth: budget.targetDepth,
        cached: cachedHits,
        fen,
        budgetMs: scanBudgetMs,
        elapsedMs: now() - startedAt,
        activeWorkers,
        queued: Math.max(0, tasks.length - cursor),
        stage: "scan",
      });

      try {
        const { evalResult, fromCache } = await evaluatePosition(
          worker,
          fen,
          budget.targetDepth,
          1,
          signal,
          (lines) => {
            onProgress({
              done: doneCount(),
              total: progressTotal,
              depth: lines.length ? Math.min(...lines.map((line) => line.depth)) : 0,
              targetDepth: budget.targetDepth,
              cached: cachedHits,
              fen,
              budgetMs: scanBudgetMs,
              elapsedMs: now() - startedAt,
              activeWorkers,
              queued: Math.max(0, tasks.length - cursor),
              stage: "scan",
            });
          },
          budget.movetimeMs,
          history,
          budget.nodes,
          budget.depthLimit,
        );
        positions[index] = evalResult;
        if (fromCache) cachedHits++;
        completedTasks++;
      } catch (reason) {
        firstWorkerError ??= reason;
      } finally {
        activeWorkers = Math.max(0, activeWorkers - 1);
      }

      onProgress({
        done: doneCount(),
        total: progressTotal,
        depth: positions[index]?.depth ?? 0,
        targetDepth: budget.targetDepth,
        cached: cachedHits,
        fen,
        budgetMs: scanBudgetMs,
        elapsedMs: now() - startedAt,
        activeWorkers,
        queued: Math.max(0, tasks.length - cursor),
        stage: "scan",
      });
    }
  }));
  if (signal?.aborted) throw new Error("cancelled");
  if (firstWorkerError) throw firstWorkerError;

  // Resolve chains of forced positions backwards from a fully evaluated child.
  for (let i = N - 1; i >= 0; i--) {
    const forcedUci = forcedMoves.get(i);
    if (!forcedUci) continue;
    const child = positions[i + 1];
    if (!child) throw new Error("Не удалось восстановить оценку вынужденной позиции.");
    positions[i] = {
      fen: game.fens[i],
      depth: child.depth,
      lines: child.lines.map((line) => ({ ...line, pv: [forcedUci, ...line.pv] })),
    };
  }

  const completePositions = positions.map((position, index) => {
    if (position) return position;
    const fallback = terminalEval(game.fens[index]);
    if (fallback) return fallback;
    throw new Error("Stockfish не вернул оценку для одной из позиций.");
  });

  const scanDone = totalPositions;
  onProgress({
    done: scanDone,
    total: progressTotal,
    depth: completePositions.reduce(
      (min, position) => position.depth > 0 ? Math.min(min, position.depth) : min,
      budget.targetDepth,
    ),
    targetDepth: budget.targetDepth,
    cached: cachedHits,
    fen: game.fens[N],
    budgetMs: scanBudgetMs,
    elapsedMs: now() - startedAt,
    activeWorkers: 0,
    queued: 0,
    stage: "verify",
  });

  if (signal?.aborted) throw new Error("cancelled");
  const rankedCriticalCandidates = maxVerificationChecks > 0
    ? selectCriticalPositions(game, completePositions, game.moves.length, false)
    : [];
  // Reserve verification slots for sacrifices first so ordinary evaluation swings
  // cannot starve promising Brilliant candidates.
  const sacrificeCandidates = rankedCriticalCandidates.filter((candidate) => candidate.sacrifice);
  const otherCandidates = rankedCriticalCandidates.filter((candidate) => !candidate.sacrifice);
  const verificationCandidates = [...sacrificeCandidates, ...otherCandidates].slice(0, maxVerificationChecks);
  const verifierTasks = verificationCandidates.map((candidate) => ({
    candidate,
    move: game.moves[candidate.index],
    history: {
      startFen: game.startFen,
      moves: game.moves.slice(0, candidate.index).map((entry) => entry.uci),
    },
  }));
  const verifierEstimateMs = estimateParallelBudgetMs(
    verifierTasks.length,
    budget.verifierMovetimeMs,
    engines.length,
  );
  let verifyCursor = 0;
  let completedVerifications = 0;
  firstWorkerError = null;

  await Promise.all(engines.map(async (worker) => {
    while (!signal?.aborted && !firstWorkerError) {
      const taskIndex = verifyCursor++;
      if (taskIndex >= verifierTasks.length) return;
      const task = verifierTasks[taskIndex];
      const { candidate, move, history } = task;
      activeWorkers++;
      onProgress({
        done: scanDone + completedVerifications,
        total: progressTotal,
        depth: 0,
        targetDepth: budget.verifierDepth,
        cached: cachedHits,
        fen: move.fenBefore,
        budgetMs: scanBudgetMs + verifierEstimateMs,
        elapsedMs: now() - startedAt,
        activeWorkers,
        queued: Math.max(0, verifierTasks.length - verifyCursor),
        stage: "verify",
      });

      try {
        const { evalResult, fromCache } = await evaluatePosition(
          worker,
          move.fenBefore,
          budget.verifierDepth,
          2,
          signal,
          undefined,
          budget.verifierMovetimeMs,
          history,
          budget.verifierNodes,
          budget.depthLimit === undefined ? undefined : budget.verifierDepth,
        );
        const previous = completePositions[candidate.index];
        if (evalResult.depth > previous.depth
          || (evalResult.depth === previous.depth && evalResult.lines.length > previous.lines.length)) {
          completePositions[candidate.index] = evalResult;
        }
        if (fromCache) cachedHits++;
        completedVerifications++;
      } catch (reason) {
        firstWorkerError ??= reason;
      } finally {
        activeWorkers = Math.max(0, activeWorkers - 1);
      }

      onProgress({
        done: scanDone + completedVerifications,
        total: progressTotal,
        depth: completePositions[candidate.index]?.depth ?? 0,
        targetDepth: budget.verifierDepth,
        cached: cachedHits,
        fen: move.fenBefore,
        budgetMs: scanBudgetMs + verifierEstimateMs,
        elapsedMs: now() - startedAt,
        activeWorkers,
        queued: Math.max(0, verifierTasks.length - verifyCursor),
        stage: "verify",
      });
    }
  }));
  if (signal?.aborted) throw new Error("cancelled");
  if (firstWorkerError) throw firstWorkerError;

  onProgress({
    done: progressTotal,
    total: progressTotal,
    depth: completePositions.reduce(
      (min, position) => position.depth > 0 ? Math.min(min, position.depth) : min,
      budget.targetDepth,
    ),
    targetDepth: budget.verifierDepth,
    cached: cachedHits,
    fen: game.fens[N],
    budgetMs: scanBudgetMs + verifierEstimateMs,
    elapsedMs: now() - startedAt,
    activeWorkers: 0,
    queued: 0,
    stage: "finalize",
  });

  return buildReview(game, completePositions, budget.targetDepth);
}

export function buildReview(
  game: ParsedGame,
  positions: PositionEval[],
  depth: number,
  _legacyDeferredSacrifices?: Map<number, string>
): GameReview {
  const N = game.moves.length;
  const book = analyzeBook(game.moves.map((m) => m.san));
  const reviews: MoveReview[] = [];
  const eloOf = (c: Color): number | undefined => playerElo(game.headers, c);
  // Offers are seeded only by a real piece sacrifice that Stockfish evaluates as sound
  // after the opponent gets the move. Later moves can inherit this live offer.
  const verifiedSacrificeOffers: boolean[] = new Array(N).fill(false);

  for (let i = 0; i < N; i++) {
    const m = game.moves[i];
    const color = m.color;
    const before = positions[i];
    const after = positions[i + 1];
    const top = before.lines[0];
    const second = before.lines[1];
    const bestUci = top.pv[0];
    const playedIsBest = bestUci === m.uci;
    const isBook = book.isBook[i];
    const legal = legalMoveCount(m.fenBefore);
    const isForced = hasOnlyLegalMove(legal);

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
    // An exactly forced move has no legal alternative, so it cannot incur avoidable move-quality loss.
    const winLoss = isForced ? 0 : Math.max(0, winBefore - winAfter);
    // Точность хода считается по стандартной кривой (формула Lichess), без рейтинга.
    const stdBefore = winFor(scoreBefore, color);
    const stdAfter = playedIsBest ? stdBefore : winFor(scoreAfter, color);
    const accuracyLoss = isForced ? 0 : Math.max(0, stdBefore - stdAfter);

    const cpBefore = cpFor(scoreBefore, color);
    const cpAfter = cpFor(scoreAfter, color);
    // Measure the opponent's previous error from this player's own rating curve.
    // Using reviews[i - 1].winLoss mixed two different players' Elo mappings and
    // could miss a blunder whenever the players had different ratings.
    const previousMoveWasForced = i > 0 && hasOnlyLegalMove(legalMoveCount(game.moves[i - 1].fenBefore));
    const previousPositionWin = i > 0 && !previousMoveWasForced
      ? winForRated(positions[i - 1].lines[0].score, color, elo)
      : winBefore;
    const prevLoss = Math.max(0, winBefore - previousPositionWin);
    const prevSan = i > 0 ? reviews[i - 1].san : undefined;

    // --- жертва для Brilliant ---
    let sac = { sacrifice: false, amount: 0, pieceType: "" };
    if (!isBook && !isForced && (playedIsBest || winLoss <= BRILLIANT_MAX_LOSS) && m.piece !== "k" && m.piece !== "p") {
      sac = detectSacrifice(m.fenBefore, m.uci, elo);
    }

    // A later pawn/quiet move may continue a piece sacrifice the opponent declined.
    // The same offered piece must remain legally capturable after every reply.
    const persistentContinuation = !isBook && !isForced
      ? findPersistentSacrificeContinuation(game.moves, i, verifiedSacrificeOffers)
      : null;
    const sacrificeForBrilliant = sac.sacrifice || !!persistentContinuation;

    // Seed an offer only if Stockfish evaluates the position after the offer
    // as still good for the sacrificing side with the opponent to move.
    const offerResponse = positions[i + 1]?.lines[0]?.score;
    const offerResponseWin = offerResponse
      ? winForRated(offerResponse, color, elo)
      : 0;
    verifiedSacrificeOffers[i] = !isBook
      && !isForced
      && sac.sacrifice
      && (playedIsBest || winLoss <= BRILLIANT_MAX_LOSS)
      && offerResponseWin >= BRILLIANT_MIN_AFTER;

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

    // Keep the alternative-line safeguard for ordinary sacrifices.
    // A verified short mating sacrifice and a genuinely persistent declined offer
    // are narrow tactical cases that qualify without an unrelated quiet-line cutoff.
    const altWin = playedIsBest ? (second ? winForRated(second.score, color, elo) : null) : winBefore;
    const matingSacrifice = sac.sacrifice
      && !isForced
      && winLoss <= BRILLIANT_MAX_LOSS
      && cpAfter > 0
      && scoreAfter.mate !== undefined
      && Math.abs(scoreAfter.mate) <= 4;
    const isBrilliant = qualifiesAsBrilliant({
      sacrifice: sacrificeForBrilliant,
      legalMoves: legal,
      alternativeWin: altWin,
      lostMate,
      allowedMate,
      winLoss,
      winAfter,
      elo,
      continuation: !!persistentContinuation,
      matingSacrifice,
    });

    const isMateMove = after.lines[0].score.terminal === true
      && after.lines[0].score.mate !== undefined;
    const bestMateIn = scoreBefore.mate !== undefined && cpBefore > 0
      ? Math.abs(scoreBefore.mate)
      : null;
    const missedMateInOne = bestMateIn === 1 && !isMateMove;

    const cls: Cls = classifyMove({
      forced: isForced,
      book: isBook,
      brilliant: isBrilliant,
      playedIsBest,
      winLoss,
      winBefore,
      winAfter,
      secondLinePresent: !!second,
      secondLineGap: gapWin,
      legalMoves: legal,
      previousOpponentLoss: prevLoss,
      missedMateInOne,
      lostForcedMate: lostMate,
      allowedMate,
      elo,
    });

    const bestSan = uciToSan(m.fenBefore, bestUci);
    const secondSan = uciToSan(m.fenBefore, second?.pv[0]);
    const opening = book.opening[i];
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
      sacrifice: sacrificeForBrilliant,
      sacrificePiece: sac.pieceType || persistentContinuation?.pieceType || m.piece,
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
    const comment = generatedComment;

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
      sacrifice: sacrificeForBrilliant,
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
