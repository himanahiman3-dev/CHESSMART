import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Chess, type Square } from "chess.js";
import type { Cls, EngineLine, GameReview } from "../types";
import { CLS_META } from "../types";
import { useEngine } from "../hooks/useEngine";
import { getCachedPosition, putCachedPosition } from "../lib/db";
import { loadSoundEnabled, playSound, preloadSounds, setSoundEnabled, soundForSan } from "../lib/sound";
import { createAnnotatedPgn, downloadAnnotatedPgn } from "../lib/pgnExport";
import { copyText } from "../lib/clipboard";
import { winFor } from "../lib/winprob";
import type { PositionHistory } from "../lib/engine";
import { GameBoard, type BoardArrow, type BoardMove, type BoardTheme } from "./GameBoard";
import { EvalBar } from "./EvalBar";
import { CoachCard, type RetryState } from "./CoachCard";
import { ReportTab } from "./ReportTab";
import { MovesTab } from "./MovesTab";
import { AnalysisTab } from "./AnalysisTab";
import { Logo } from "./EngineLoader";

const LIVE_DEPTH = 24;
const BAD: Cls[] = ["inaccuracy", "mistake", "miss", "blunder"];

interface Explore {
  base: string;
  moves: BoardMove[];
  idx: number;
}

function PlayerBar({ name, elo, acc, white }: { name: string; elo?: string; acc: number; white: boolean }) {
  return (
    <div className="flex items-center justify-between px-0.5 py-1.5 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span className={`h-5 w-5 shrink-0 rounded-sm border ${white ? "border-[#8b8987] bg-white" : "border-black bg-[#403d39]"}`} />
        <span className="truncate font-bold">{name}</span>
        {elo && <span className="text-xs text-[#a7a6a2]">({elo})</span>}
      </div>
      <span className="rounded bg-[#262421] px-2 py-0.5 text-xs font-bold tabular-nums text-[#dcdbd7]" title="Точность">
        {acc.toFixed(1)}%
      </span>
    </div>
  );
}

export function ReviewScreen({ review, onNew, isRefining = false }: { review: GameReview; onNew: () => void; isRefining?: boolean }) {
  const { engine, info } = useEngine();
  const N = review.moves.length;
  const [ply, setPly] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [tab, setTab] = useState<"report" | "moves" | "analysis">("report");
  const [analysisOn, setAnalysisOn] = useState(false);
  const [explore, setExplore] = useState<Explore | null>(null);
  const [retry, setRetry] = useState<RetryState | null>(null);
  const [retryFen, setRetryFen] = useState<string | null>(null);
  const [showBest, setShowBest] = useState(true);
  const [sound, setSound] = useState(loadSoundEnabled);
  const [live, setLive] = useState<EngineLine[]>([]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [autoPlayDelay, setAutoPlayDelay] = useState(1200);
  const [boardTheme, setBoardTheme] = useState<BoardTheme>(() => {
    try {
      const saved = localStorage.getItem("chess-review:board-theme");
      return saved === "blue" || saved === "walnut" || saved === "violet" ? saved : "classic";
    } catch {
      return "classic";
    }
  });

  useEffect(() => setSoundEnabled(sound), [sound]);
  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);

  // заранее загружаем звуки мата и шаха (mp3), чтобы они играли без задержки
  useEffect(() => {
    preloadSounds();
  }, []);

  const move = ply > 0 ? review.moves[ply - 1] : null;
  const exploreFen = explore ? (explore.idx > 0 ? explore.moves[explore.idx - 1].fenAfter : explore.base) : null;
  const displayFen = retry ? (retryFen ?? review.moves[retry.idx].fenBefore) : (exploreFen ?? review.fens[ply]);

  // Free analysis must use the exact game path, not only the current FEN:
  // repetition and draw rules depend on positions played before this point.
  const liveHistory = useMemo<PositionHistory>(() => ({
    startFen: review.startFen,
    moves: [
      ...review.moves.slice(0, ply).map((played) => played.uci),
      ...(explore ? explore.moves.slice(0, explore.idx).map((played) => played.uci) : []),
    ],
  }), [review.startFen, review.moves, ply, explore]);
  const liveHistoryKey = useMemo(
    () => `${liveHistory.startFen}|${liveHistory.moves.join(" ")}`,
    [liveHistory],
  );

  useEffect(() => {
    try {
      localStorage.setItem("chess-review:board-theme", boardTheme);
    } catch {
      // Настройка темы необязательна и не должна мешать обзору.
    }
  }, [boardTheme]);

  // Автопроигрывание использует один timeout на ход: ручная навигация и пауза
  // немедленно очищают таймер, а конец партии останавливает воспроизведение.
  useEffect(() => {
    if (!autoPlay || retry || explore) return;
    if (ply >= N) {
      setAutoPlay(false);
      return;
    }
    const timer = window.setTimeout(() => {
      const next = review.moves[ply];
      if (next) playSound(soundForSan(next.san, ply + 1 === N && next.san.includes("#"), next.cls));
      setPly((current) => Math.min(N, current + 1));
    }, autoPlayDelay);
    return () => window.clearTimeout(timer);
  }, [autoPlay, autoPlayDelay, ply, N, retry, explore, review.moves]);

  const announceCopy = useCallback((message: string) => {
    setCopyNotice(message);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setCopyNotice(null), 1800);
  }, []);

  const copyCurrentFen = useCallback(async () => {
    const copied = await copyText(displayFen);
    announceCopy(copied ? "FEN скопирован" : "Не удалось скопировать FEN");
  }, [displayFen, announceCopy]);

  const copyAnnotatedPgn = useCallback(async () => {
    const copied = await copyText(createAnnotatedPgn(review));
    announceCopy(copied ? "PGN скопирован" : "Не удалось скопировать PGN");
  }, [review, announceCopy]);

  /* ---------------------------- навигация ---------------------------- */
  const plyRef = useRef(0);
  plyRef.current = ply;
  const seek = useCallback(
    (p: number, silent = false) => {
      const target = Math.max(0, Math.min(N, p));
      setAutoPlay(false);
      setRetry(null);
      setRetryFen(null);
      setExplore(null);
      if (!silent && target !== plyRef.current && target > 0) {
        const m = review.moves[target - 1];
        playSound(soundForSan(m.san, target === N && m.san.includes("#"), m.cls));
      }
      setPly(target);
    },
    [N, review.moves]
  );

  const goPrev = useCallback(() => {
    if (retry) return;
    if (explore) {
      if (explore.idx > 0) setExplore({ ...explore, idx: explore.idx - 1 });
      else setExplore(null);
      return;
    }
    seek(ply - 1);
  }, [retry, explore, ply, seek]);

  const goNext = useCallback(() => {
    if (retry) return;
    if (explore) {
      if (explore.idx < explore.moves.length) {
        const m = explore.moves[explore.idx];
        playSound(soundForSan(m.san));
        setExplore({ ...explore, idx: explore.idx + 1 });
      }
      return;
    }
    seek(ply + 1);
  }, [retry, explore, ply, seek]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      if (showShortcuts) {
        if (e.key === "Escape") {
          e.preventDefault();
          setShowShortcuts(false);
        }
        return;
      }

      if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts(true);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowUp" || e.key === "Home") {
        e.preventDefault();
        seek(0);
      } else if (e.key === "ArrowDown" || e.key === "End") {
        e.preventDefault();
        seek(N);
      } else if (e.key === "f" || e.key === "F") {
        setFlipped((f) => !f);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext, seek, N, showShortcuts]);

  /* ------------------------ ходы на доске ------------------------ */
  const handleBoardMove = useCallback(
    (m: BoardMove): boolean => {
      if (retry) {
        if (retry.status === "solved" || retry.status === "shown") return false;
        const r = review.moves[retry.idx];
        const l2 = r.lines[1];
        const equivalent =
          m.uci === r.bestUci ||
          (!!l2 && m.uci === l2.pv[0] && winFor(l2.score, r.color) >= winFor(r.lines[0].score, r.color) - 2);
        if (equivalent) {
          setRetryFen(m.fenAfter);
          setRetry({ ...retry, status: "solved" });
          playSound("correct");
          return true;
        }
        setRetry({ ...retry, status: "wrong", attempts: retry.attempts + 1 });
        playSound("wrong");
        return false;
      }
      if (!analysisOn) return false;
      const base = explore ? explore.base : review.fens[ply];
      const moves = explore ? explore.moves.slice(0, explore.idx) : [];
      setExplore({ base, moves: [...moves, m], idx: moves.length + 1 });
      playSound(soundForSan(m.san));
      return true;
    },
    [retry, review.moves, review.fens, analysisOn, explore, ply]
  );

  const playUci = useCallback(
    (uci: string) => {
      try {
        const c = new Chess(displayFen);
        const mv = c.move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci.length > 4 ? uci[4] : undefined });
        handleBoardMove({ from: mv.from, to: mv.to, san: mv.san, uci, fenAfter: c.fen() });
      } catch {
        /* ignore */
      }
    },
    [displayFen, handleBoardMove]
  );

  /* --------------------------- Retry --------------------------- */
  const startRetry = () => {
    if (!move) return;
    setExplore(null);
    setRetryFen(null);
    setRetry({ idx: ply - 1, status: "waiting", hint: false, attempts: 0 });
  };

  /* ------------------ свободный анализ (MultiPV 3) ------------------ */
  useEffect(() => {
    if (!analysisOn || !engine || retry) {
      setLive([]);
      return;
    }
    let stale = false;
    let stopFn: (() => void) | null = null;
    const fen = displayFen;
    setLive(!explore && review.positions[ply] ? review.positions[ply].lines : []);
    void (async () => {
      try {
        const cached = await getCachedPosition(fen, LIVE_DEPTH, 3, liveHistoryKey);
        if (stale) return;
        if (cached) {
          setLive(cached.lines);
          return;
        }
        let over = false;
        try {
          over = new Chess(fen).isGameOver();
        } catch {
          over = true;
        }
        if (over) {
          setLive([]);
          return;
        }
        const handle = engine.search({
          fen,
          history: liveHistory,
          depth: LIVE_DEPTH,
          multipv: 3,
          onInfo: (lines) => {
            if (!stale) setLive(lines);
          },
        });
        stopFn = handle.stop;
        const lines = await handle.promise;
        if (!stale && lines.length && Math.min(...lines.map((l) => l.depth)) >= LIVE_DEPTH) {
          await putCachedPosition(fen, LIVE_DEPTH, 3, lines, Math.min(...lines.map((l) => l.depth)), liveHistoryKey);
        }
      } catch (reason) {
        // A worker failure is surfaced as an error, never cached as a successful evaluation.
        if (!stale) {
          setLive([]);
          console.error("Ошибка свободного анализа Stockfish:", reason);
        }
      }
    })();
    return () => {
      stale = true;
      stopFn?.();
    };
  }, [analysisOn, displayFen, engine, !!retry, liveHistory, liveHistoryKey, explore, ply, review.positions]);

  /* --------------------------- отображение --------------------------- */
  const score = retry
    ? review.scores[retry.idx]
    : (explore || analysisOn) && live[0]
      ? live[0].score
      : review.scores[ply];

  const lastMove = retry
    ? null
    : explore
      ? explore.idx > 0
        ? { from: explore.moves[explore.idx - 1].from, to: explore.moves[explore.idx - 1].to }
        : null
      : move
        ? { from: move.from, to: move.to }
        : null;

  const badge = !retry && !explore && move ? { square: move.to, cls: move.cls } : null;

  const arrows = useMemo<BoardArrow[]>(() => {
    const out: BoardArrow[] = [];
    const uciArrow = (uci: string, color: string) => out.push({ from: uci.slice(0, 2), to: uci.slice(2, 4), color });
    if (retry) {
      const r = review.moves[retry.idx];
      if ((retry.status === "shown" || retry.status === "solved") && r.bestUci && retry.status === "shown") uciArrow(r.bestUci, "rgba(150,188,75,0.95)");
      return out;
    }
    if (analysisOn && live.length) {
      live.forEach((l, i) => {
        if (l.pv[0]) uciArrow(l.pv[0], i === 0 ? "rgba(150,188,75,0.9)" : "rgba(92,139,176,0.65)");
      });
      return out;
    }
    if (move && showBest && !explore && BAD.includes(move.cls)) {
      if (move.bestUci) uciArrow(move.bestUci, "rgba(150,188,75,0.92)");
      uciArrow(move.uci, CLS_META[move.cls].color + "d9");
    }
    return out;
  }, [retry, review.moves, analysisOn, live, move, showBest, explore]);

  const extraStyles = useMemo<Record<string, CSSProperties> | undefined>(() => {
    if (retry?.hint && retry.status !== "solved") {
      const r = review.moves[retry.idx];
      if (r.bestUci) return { [r.bestUci.slice(0, 2)]: { background: "rgba(92,139,176,0.65)" } };
    }
    return undefined;
  }, [retry, review.moves]);

  const boardInteractive = retry ? retry.status === "waiting" || retry.status === "wrong" : analysisOn;
  const allowedColor = retry ? review.moves[retry.idx].color : null;

  const h = review.headers;
  const whiteName = h.White ?? "Белые";
  const blackName = h.Black ?? "Чёрные";
  const top = flipped
    ? { name: whiteName, elo: h.WhiteElo, acc: review.accuracy.w, white: true }
    : { name: blackName, elo: h.BlackElo, acc: review.accuracy.b, white: false };
  const bottom = flipped
    ? { name: blackName, elo: h.BlackElo, acc: review.accuracy.b, white: false }
    : { name: whiteName, elo: h.WhiteElo, acc: review.accuracy.w, white: true };

  const ctrl = "flex h-10 min-w-12 items-center justify-center rounded-lg bg-[#3d3a37] px-3 text-lg font-bold hover:bg-[#4b4844] active:translate-y-px disabled:opacity-30";

  return (
    <div className="review-screen min-h-screen text-white">
      <header className="review-header sticky top-0 z-40 flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-[#46433c] bg-[#211f1d]/95 px-3 py-2 shadow-xl shadow-black/20 backdrop-blur-xl sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Logo size={32} />
          <div className="min-w-0">
            <div className="text-sm font-black uppercase tracking-[0.13em]">Chess Review</div>
            <div className="truncate text-[10px] font-semibold text-[#85827b]">{whiteName} vs {blackName}</div>
          </div>
        </div>
        {review.opening && (
          <div className="hidden min-w-0 items-center gap-2 rounded-full border border-[#514a3c] bg-[#302b22] px-3 py-1.5 md:flex">
            <span className="font-mono text-[10px] font-black text-[#d7b887]">{review.opening.eco}</span>
            <span className="max-w-[250px] truncate text-[11px] font-bold text-[#ded4c0]">{review.opening.ru}</span>
          </div>
        )}
        {isRefining && (
          <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-full border border-[#789c54]/40 bg-[#34432b]/60 px-3 py-1.5 text-[10px] font-semibold text-[#cfe5b8]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#a3d160]" />
            Подробная повторная проверка ключевых позиций…
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs sm:gap-2">
          {info && (
            <span className="hidden rounded-full bg-[#1f1d1b] px-3 py-1 text-[#a7a6a2] sm:inline">
              <span className="mr-1 text-[#81b64c]">●</span>SF 19 · {info.variant === "full" ? "Полная" : "Lite"} ·{" "}
              {info.threaded ? `${info.threads} потоков` : "1 поток"}
            </span>
          )}
          <button onClick={() => setFocusMode((value) => !value)} className="rounded-lg bg-[#3d3a37] px-2.5 py-1.5 font-bold hover:bg-[#4b4844]" title="Режим фокуса" aria-label={focusMode ? "Показать панель анализа" : "Скрыть панель анализа"}>
            {focusMode ? "⤢" : "⛶"}
          </button>
          <button onClick={() => setSound((s) => !s)} className="rounded-lg bg-[#3d3a37] px-2.5 py-1.5 hover:bg-[#4b4844]" title="Звук" aria-label={sound ? "Выключить звук" : "Включить звук"}>
            {sound ? "🔊" : "🔇"}
          </button>
          <button
            onClick={() => downloadAnnotatedPgn(review)}
            className="rounded-lg bg-[#3d3a37] px-2.5 py-1.5 font-bold hover:bg-[#4b4844]"
            title="Скачать PGN с комментариями тренера"
            aria-label="Скачать разобранную партию в PGN"
          >
            PGN ↓
          </button>
          <button onClick={onNew} className="rounded-lg bg-[#81b64c] px-3 py-1.5 font-bold hover:bg-[#95c75f]">
            + Новая партия
          </button>
        </div>
      </header>

      <div className={`review-workspace mx-auto flex ${focusMode ? "max-w-[1500px]" : "max-w-[1240px]"} flex-col gap-4 p-2 sm:p-4 lg:flex-row lg:items-start lg:justify-center`}>
        {/* ------------------------- доска ------------------------- */}
        <div className={`w-full lg:shrink-0 ${focusMode ? "lg:w-[min(calc(100vh-170px),calc(100vw-40px),900px)]" : "lg:w-[min(calc(100vh-190px),calc(100vw-500px),760px)]"}`}>
          <section className="review-board-card rounded-2xl border border-[#47443d] bg-[#302e2b] p-2 shadow-2xl shadow-black/25 sm:p-3">
          <PlayerBar {...top} />
          <div className="flex items-stretch gap-2">
            <EvalBar score={score} flipped={flipped} />
            <div className="min-w-0 flex-1">
              <GameBoard
                fen={displayFen}
                orientation={flipped ? "black" : "white"}
                lastMove={lastMove}
                badge={badge}
                animKey={ply}
                theme={boardTheme}
                arrows={arrows}
                interactive={boardInteractive}
                allowedColor={allowedColor}
                onMove={handleBoardMove}
                extraSquareStyles={extraStyles}
              />
            </div>
          </div>
          <PlayerBar {...bottom} />
          </section>
          <div className="review-board-controls mt-2 flex items-center justify-center gap-2">
            <button className={ctrl} onClick={() => seek(0)} disabled={!!retry} title="В начало (↑)">
              ⏮
            </button>
            <button className={ctrl} onClick={goPrev} disabled={!!retry} title="Назад (←)">
              ◀
            </button>
            <button className={ctrl} onClick={goNext} disabled={!!retry} title="Вперёд (→)">
              ▶
            </button>
            <button className={ctrl} onClick={() => seek(N)} disabled={!!retry} title="В конец (↓)">
              ⏭
            </button>
            <button className={ctrl} onClick={() => setFlipped((f) => !f)} title="Перевернуть доску (F)">
              ⇅
            </button>
          </div>
          <div className="mt-1.5 text-center text-xs text-[#8b8987]">
            {retry ? "Режим «Попробовать снова»" : explore ? "Свой вариант" : ply === 0 ? "Начальная позиция" : `Ход ${ply} из ${N}`}
          </div>
          <div className="review-extra-controls mt-3 flex flex-wrap items-center justify-center gap-2 rounded-xl border border-[#4b4844]/70 bg-[#262421] p-2.5">
            <button
              onClick={() => {
                if (autoPlay) {
                  setAutoPlay(false);
                } else {
                  if (ply >= N) setPly(0);
                  setRetry(null);
                  setRetryFen(null);
                  setExplore(null);
                  setAutoPlay(true);
                }
              }}
              disabled={!!retry || !!explore || N === 0}
              className={`rounded-lg px-3 py-2 text-xs font-extrabold transition disabled:opacity-40 ${autoPlay ? "bg-[#d7a94b] text-[#241c0e]" : "bg-[#81b64c] text-[#17210f] hover:bg-[#95c75f]"}`}
              title="Автоматически проиграть партию"
            >
              {autoPlay ? "Ⅱ Пауза" : "▶ Автопроигрывание"}
            </button>
            <label className="flex items-center gap-1.5 text-[11px] text-[#a7a6a2]">
              Скорость
              <select
                value={autoPlayDelay}
                onChange={(event) => setAutoPlayDelay(Number(event.target.value))}
                className="rounded-lg border border-[#4b4844] bg-[#1f1d1b] px-2 py-2 text-xs text-white outline-none focus:border-[#81b64c]"
                aria-label="Скорость автопроигрывания"
              >
                <option value={2200}>Медленно</option>
                <option value={1200}>Нормально</option>
                <option value={600}>Быстро</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-[#a7a6a2]">
              Доска
              <select
                value={boardTheme}
                onChange={(event) => setBoardTheme(event.target.value as BoardTheme)}
                className="rounded-lg border border-[#4b4844] bg-[#1f1d1b] px-2 py-2 text-xs text-white outline-none focus:border-[#81b64c]"
                aria-label="Цветовая тема доски"
              >
                <option value="classic">Классика</option>
                <option value="blue">Синяя</option>
                <option value="walnut">Орех</option>
                <option value="violet">Фиолетовая</option>
              </select>
            </label>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void copyCurrentFen()}
                className="rounded-lg bg-[#262421] px-3 py-2 text-xs font-bold text-[#dcdbd7] hover:bg-[#3d3a37]"
                title="Скопировать FEN текущей позиции"
              >
                FEN ⧉
              </button>
              <button
                onClick={() => void copyAnnotatedPgn()}
                className="rounded-lg bg-[#262421] px-3 py-2 text-xs font-bold text-[#dcdbd7] hover:bg-[#3d3a37]"
                title="Скопировать PGN с комментариями тренера"
              >
                Копировать PGN
              </button>
            </div>
            <div className="flex items-center gap-2">
              {copyNotice && <span role="status" aria-live="polite" className="text-[11px] text-[#a3d160]">{copyNotice}</span>}
              <button
                onClick={() => setShowShortcuts(true)}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#262421] text-sm font-black text-[#dcdbd7] hover:bg-[#3d3a37]"
                title="Горячие клавиши (?)"
                aria-label="Показать горячие клавиши"
              >
                ?
              </button>
            </div>
          </div>
        </div>

        {/* ------------------------- панель ------------------------- */}
        {!focusMode && <aside className="flex w-full flex-col gap-3 lg:w-[420px] lg:shrink-0">
          <CoachCard
            review={review}
            ply={ply}
            move={move}
            retry={retry}
            showBest={showBest}
            onToggleBest={() => setShowBest((s) => !s)}
            onStartRetry={startRetry}
            onHint={() => retry && setRetry({ ...retry, hint: true })}
            onShowSolution={() => retry && setRetry({ ...retry, status: "shown" })}
            onExitRetry={() => {
              setRetry(null);
              setRetryFen(null);
            }}
            onContinue={() => retry && seek(retry.idx + 1, true)}
            exploring={!!explore}
          />

          <div className="review-panel-card rounded-2xl border border-[#47443d] bg-[#302e2b] p-3 shadow-xl shadow-black/20">
            <div className="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-[#1f1d1b] p-1 text-sm font-bold">
              {(
                [
                  ["report", "Обзор"],
                  ["moves", "Ходы"],
                  ["analysis", "Анализ"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`rounded-md py-1.5 transition ${tab === id ? "bg-[#3d3a37] text-white" : "text-[#a7a6a2] hover:text-white"}`}
                >
                  {label}
                  {id === "analysis" && analysisOn ? " ●" : ""}
                </button>
              ))}
            </div>
            {tab === "report" && <ReportTab review={review} ply={ply} onSeek={(p) => seek(p)} />}
            {tab === "moves" && <MovesTab review={review} ply={ply} onSeek={(p) => seek(p)} />}
            {tab === "analysis" && (
              <AnalysisTab
                enabled={analysisOn}
                onToggle={(v) => {
                  setAnalysisOn(v);
                  if (!v) setExplore(null);
                }}
                lines={live}
                fen={displayFen}
                targetDepth={LIVE_DEPTH}
                threads={info?.threads ?? 1}
                variantLabel={info?.variant === "full" ? "Полная" : "Lite"}
                onPlayUci={playUci}
                onReset={() => setExplore(null)}
                exploring={!!explore}
                disabled={!!retry}
              />
            )}
          </div>
        </aside>}
      </div>
      {showShortcuts && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default bg-black/70"
            aria-label="Закрыть подсказку горячих клавиш"
            onClick={() => setShowShortcuts(false)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-title"
            className="relative z-10 w-full max-w-sm rounded-2xl border border-[#4b4844] bg-[#262421] p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id="shortcuts-title" className="text-lg font-extrabold">Горячие клавиши</h2>
              <button
                onClick={() => setShowShortcuts(false)}
                className="rounded-lg bg-[#3d3a37] px-3 py-1.5 text-sm font-bold hover:bg-[#4b4844]"
                aria-label="Закрыть"
              >
                Esc
              </button>
            </div>
            <div className="space-y-2 text-sm">
              {[
                ["← / →", "Предыдущий / следующий ход"],
                ["↑ / Home", "Перейти к началу партии"],
                ["↓ / End", "Перейти к последней позиции"],
                ["F", "Перевернуть доску"],
                ["?", "Открыть эту подсказку"],
              ].map(([key, description]) => (
                <div key={key} className="flex items-center justify-between gap-3 rounded-lg bg-[#1f1d1b] px-3 py-2">
                  <kbd className="min-w-20 rounded bg-[#3d3a37] px-2 py-1 text-center font-mono text-xs font-bold text-[#a3d160]">{key}</kbd>
                  <span className="text-right text-[#c7c6c2]">{description}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-[#8b8987]">Горячие клавиши не перехватывают ввод в полях и выпадающих списках.</p>
          </section>
        </div>
      )}
    </div>
  );
}
