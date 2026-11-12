import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Chess, type Square } from "chess.js";
import type { Cls, EngineLine, GameReview } from "../types";
import { CLS_META } from "../types";
import { useEngine } from "../hooks/useEngine";
import { getCachedPosition, putCachedPosition } from "../lib/db";
import { playSound, setSoundEnabled, soundForSan } from "../lib/sound";
import { winFor } from "../lib/winprob";
import { GameBoard, type BoardArrow, type BoardMove } from "./GameBoard";
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

export function ReviewScreen({ review, onNew }: { review: GameReview; onNew: () => void }) {
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
  const [sound, setSound] = useState(true);
  const [live, setLive] = useState<EngineLine[]>([]);

  useEffect(() => setSoundEnabled(sound), [sound]);

  const move = ply > 0 ? review.moves[ply - 1] : null;
  const exploreFen = explore ? (explore.idx > 0 ? explore.moves[explore.idx - 1].fenAfter : explore.base) : null;
  const displayFen = retry ? (retryFen ?? review.moves[retry.idx].fenBefore) : (exploreFen ?? review.fens[ply]);

  /* ---------------------------- навигация ---------------------------- */
  const plyRef = useRef(0);
  plyRef.current = ply;
  const seek = useCallback(
    (p: number, silent = false) => {
      const target = Math.max(0, Math.min(N, p));
      setRetry(null);
      setRetryFen(null);
      setExplore(null);
      if (!silent && target !== plyRef.current && target > 0) {
        const m = review.moves[target - 1];
        playSound(soundForSan(m.san, target === N && m.san.includes("#")));
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
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        seek(0);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        seek(N);
      } else if (e.key === "f" || e.key === "F") {
        setFlipped((f) => !f);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext, seek, N]);

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
    (async () => {
      const cached = await getCachedPosition(fen, LIVE_DEPTH, 3);
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
        depth: LIVE_DEPTH,
        multipv: 3,
        onInfo: (lines) => {
          if (!stale) setLive(lines);
        },
      });
      stopFn = handle.stop;
      const lines = await handle.promise;
      if (!stale && lines.length && Math.min(...lines.map((l) => l.depth)) >= LIVE_DEPTH)
        await putCachedPosition(fen, LIVE_DEPTH, 3, lines, Math.min(...lines.map((l) => l.depth)));
    })();
    return () => {
      stale = true;
      stopFn?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisOn, displayFen, engine, !!retry]);

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
    <div className="min-h-screen bg-[#312e2b] text-white">
      <header className="flex h-12 items-center justify-between bg-[#262421] px-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <Logo size={30} />
          <span className="text-lg font-extrabold">Chess Review</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {info && (
            <span className="hidden rounded-full bg-[#1f1d1b] px-3 py-1 text-[#a7a6a2] sm:inline">
              <span className="mr-1 text-[#81b64c]">●</span>SF 19 · {info.variant === "full" ? "Полная" : "Lite"} ·{" "}
              {info.threaded ? `${info.threads} потоков` : "1 поток"}
            </span>
          )}
          <button onClick={() => setSound((s) => !s)} className="rounded-lg bg-[#3d3a37] px-2.5 py-1.5 hover:bg-[#4b4844]" title="Звук">
            {sound ? "🔊" : "🔇"}
          </button>
          <button onClick={onNew} className="rounded-lg bg-[#81b64c] px-3 py-1.5 font-bold hover:bg-[#95c75f]">
            + Новая партия
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1240px] flex-col gap-4 p-2 sm:p-4 lg:flex-row lg:items-start lg:justify-center">
        {/* ------------------------- доска ------------------------- */}
        <div className="w-full lg:w-[min(calc(100vh-190px),calc(100vw-500px),760px)] lg:shrink-0">
          <PlayerBar {...top} />
          <div className="flex items-stretch gap-2">
            <EvalBar score={score} flipped={flipped} />
            <div className="min-w-0 flex-1">
              <GameBoard
                fen={displayFen}
                orientation={flipped ? "black" : "white"}
                lastMove={lastMove}
                badge={badge}
                arrows={arrows}
                interactive={boardInteractive}
                allowedColor={allowedColor}
                onMove={handleBoardMove}
                extraSquareStyles={extraStyles}
              />
            </div>
          </div>
          <PlayerBar {...bottom} />
          <div className="mt-1 flex items-center justify-center gap-2">
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
        </div>

        {/* ------------------------- панель ------------------------- */}
        <aside className="flex w-full flex-col gap-3 lg:w-[400px] lg:shrink-0">
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

          <div className="rounded-xl bg-[#262421] p-3">
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
        </aside>
      </div>
    </div>
  );
}
