"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StockfishEngine } from "@/lib/engine";
import { pvToSan } from "@/lib/chessutil";
import { parseInput, runReview, summarize } from "@/lib/review";
import type {
  EngineInfo,
  EngineLine,
  EngineSettings,
  GameMove,
  MoveReview,
  ParsedGame,
  PositionEval,
  SavedReviewData,
  Side,
} from "@/lib/types";
import { CLASS_META, CLASS_ORDER, formatEval } from "@/lib/winrate";
import { BoardView } from "./BoardView";
import { ClassBadge } from "./ClassBadge";
import { EvalBar } from "./EvalBar";
import { EvalGraph } from "./EvalGraph";
import { InputPanel, type HistoryItem } from "./InputPanel";
import { MoveList } from "./MoveList";

type Status = "idle" | "loading" | "analyzing" | "done" | "cancelled" | "error";
type Tab = "report" | "moves" | "lines";

interface Live {
  fen: string;
  lines: EngineLine[];
  depth: number;
}

export function ReviewApp() {
  const [game, setGame] = useState<ParsedGame | null>(null);
  const [evals, setEvals] = useState<(PositionEval | null)[]>([]);
  const [moves, setMoves] = useState<(MoveReview | null)[]>([]);
  const [done, setDone] = useState(0);
  const [live, setLive] = useState<Live | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [statusText, setStatusText] = useState("");
  const [loadPct, setLoadPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null>(null);
  const [usedSettings, setUsedSettings] = useState<{ depth: number; multiPv: number }>({ depth: 20, multiPv: 4 });
  const [ply, setPly] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [tab, setTab] = useState<Tab>("report");
  const [perspective, setPerspective] = useState<Side>("w");
  const [showBest, setShowBest] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [savedId, setSavedId] = useState<number | null>(null);

  const engineRef = useRef<StockfishEngine | null>(null);
  const engineKeyRef = useRef("");
  const cancelRef = useRef({ value: false });
  const runIdRef = useRef(0);

  const refreshHistory = useCallback(async () => {
    try {
      const r = await fetch("/api/reviews");
      if (r.ok) setHistory(((await r.json()) as { reviews: HistoryItem[] }).reviews);
    } catch {
      /* offline history is optional */
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
    return () => {
      cancelRef.current.value = true;
      engineRef.current?.dispose();
    };
  }, [refreshHistory]);

  const fens = useMemo(() => (game ? [game.startFen, ...game.moves.map((m) => m.fenAfter)] : []), [game]);
  const total = fens.length;
  const summary = useMemo(() => summarize(evals, moves), [evals, moves]);
  const analyzing = status === "loading" || status === "analyzing";

  // ---------------- start / cancel ----------------
  const start = useCallback(
    async (text: string, settings: EngineSettings) => {
      setError(null);
      let parsed: ParsedGame;
      try {
        parsed = parseInput(text);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Invalid input");
        return;
      }
      const runId = ++runIdRef.current;
      cancelRef.current.value = true;
      const cancelled = { value: false };
      cancelRef.current = cancelled;

      setGame(parsed);
      setEvals(Array(parsed.moves.length + 1).fill(null));
      setMoves(Array(parsed.moves.length).fill(null));
      setDone(0);
      setLive(null);
      setPly(0);
      setSavedId(null);
      setFlipped(false);
      setPlaying(false);
      setTab("report");
      setPerspective(parsed.startFen.split(" ")[1] === "b" ? "b" : "w");
      setUsedSettings({ depth: settings.depth, multiPv: settings.multiPv });
      setStatus("loading");
      setStatusText("Starting Stockfish 19…");

      try {
        const key = `${settings.variant}|${settings.threads}|${settings.hashMb}|${settings.multiPv}`;
        let engine = engineRef.current;
        if (!engine || engineKeyRef.current !== key) {
          engine?.dispose();
          engine = new StockfishEngine();
          engineRef.current = engine;
          engineKeyRef.current = "";
          const info = await engine.init(settings, (msg, pct) => {
            setStatusText(msg);
            setLoadPct(pct ?? null);
          });
          engineKeyRef.current = key;
          setEngineInfo(info);
        }
        setLoadPct(null);
        if (runId !== runIdRef.current) return;
        setStatus("analyzing");
        setStatusText("Analyzing positions…");

        const result = await runReview(engine, parsed, {
          depth: settings.depth,
          cancelled,
          onProgress: (p) => {
            if (runId !== runIdRef.current) return;
            setEvals(p.evals);
            setMoves(p.moves);
            setDone(p.done);
            setLive({ fen: p.liveFen, lines: p.liveLines, depth: p.liveDepth });
          },
        });
        if (runId !== runIdRef.current) return;
        setEvals(result.evals);
        setMoves(result.moves);
        if (!result.complete) {
          setStatus("cancelled");
          setStatusText("Analysis stopped");
          return;
        }
        setStatus("done");
        setStatusText("Analysis complete");
        setDone(result.evals.length);
        void save(parsed, result.evals, result.moves as MoveReview[], settings);
      } catch (e) {
        if (runId !== runIdRef.current) return;
        setStatus("error");
        setError(e instanceof Error ? e.message : "Engine failure");
        engineRef.current?.dispose();
        engineRef.current = null;
        engineKeyRef.current = "";
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  async function save(parsed: ParsedGame, ev: (PositionEval | null)[], mv: MoveReview[], settings: EngineSettings) {
    const trimmed = ev.map((e) => (e ? { ...e, lines: e.lines.map((l) => ({ ...l, pv: l.pv.slice(0, 10) })) } : null));
    const data: SavedReviewData = {
      game: parsed,
      evals: trimmed,
      moves: mv,
      summary: summarize(ev, mv),
      settings: { depth: settings.depth, multiPv: settings.multiPv },
    };
    try {
      const r = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) });
      if (r.ok) setSavedId(((await r.json()) as { id: number }).id);
      void refreshHistory();
    } catch {
      /* ignore */
    }
  }

  const cancel = () => {
    cancelRef.current.value = true;
    engineRef.current?.stop();
  };

  const loadSaved = async (id: number) => {
    setError(null);
    try {
      const r = await fetch(`/api/reviews/${id}`);
      if (!r.ok) throw new Error("Could not load that review");
      const { review } = (await r.json()) as { review: { data: SavedReviewData } };
      const d = review.data;
      runIdRef.current++;
      cancelRef.current.value = true;
      setGame(d.game);
      setEvals(d.evals);
      setMoves(d.moves);
      setDone(d.evals.length);
      setLive(null);
      setPly(0);
      setFlipped(false);
      setPlaying(false);
      setTab("report");
      setPerspective(d.game.startFen.split(" ")[1] === "b" ? "b" : "w");
      setUsedSettings(d.settings);
      setSavedId(id);
      setStatus("done");
      setStatusText("Loaded saved review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  };

  const deleteSaved = async (id: number) => {
    await fetch(`/api/reviews/${id}`, { method: "DELETE" });
    void refreshHistory();
  };

  const newReview = () => {
    runIdRef.current++;
    cancelRef.current.value = true;
    engineRef.current?.stop();
    setGame(null);
    setStatus("idle");
    setPlaying(false);
    void refreshHistory();
  };

  // ---------------- navigation ----------------
  const maxPly = game ? game.moves.length : 0;
  const go = useCallback((p: number) => setPly(Math.max(0, Math.min(maxPly, p))), [maxPly]);

  useEffect(() => {
    if (!game) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA" || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowLeft") setPly((p) => Math.max(0, p - 1));
      else if (e.key === "ArrowRight") setPly((p) => Math.min(maxPly, p + 1));
      else if (e.key === "Home") setPly(0);
      else if (e.key === "End") setPly(maxPly);
      else if (e.key.toLowerCase() === "f") setFlipped((f) => !f);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [game, maxPly]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setPly((p) => {
        if (p >= maxPly) {
          setPlaying(false);
          return p;
        }
        return p + 1;
      });
    }, 1100);
    return () => clearInterval(t);
  }, [playing, maxPly]);

  // ---------------- derived view data ----------------
  if (!game) {
    return <InputPanel onStart={start} history={history} onLoad={loadSaved} onDelete={deleteSaved} error={error} busy={false} />;
  }

  const currentFen = fens[ply] ?? game.startFen;
  const curEval = evals[ply] ?? null;
  const liveForPly = live && live.fen === currentFen ? live : null;
  const barLine: EngineLine | undefined = curEval?.lines[0] ?? liveForPly?.lines[0];
  const reviewed: MoveReview | null = ply > 0 ? moves[ply - 1] : null;
  const gm: GameMove | null = ply > 0 ? game.moves[ply - 1] : null;
  const lines: EngineLine[] = curEval?.lines ?? liveForPly?.lines ?? [];
  const lineDepth = curEval && !curEval.terminal ? curEval.depth : liveForPly?.depth ?? 0;

  const startsBlack = game.startFen.split(" ")[1] === "b";
  const startNumber = parseInt(game.startFen.split(" ")[5] || "1", 10) || 1;
  const wName = game.headers.White && game.headers.White !== "?" ? game.headers.White : "White";
  const bName = game.headers.Black && game.headers.Black !== "?" ? game.headers.Black : "Black";
  const names: Record<Side, string> = { w: wName, b: bName };
  const elo: Record<Side, string | undefined> = { w: game.headers.WhiteElo, b: game.headers.BlackElo };

  const bottomSide: Side = flipped ? "b" : "w";
  const topSide: Side = flipped ? "w" : "b";
  const turnToMove = (currentFen.split(" ")[1] === "b" ? "b" : "w") as Side;

  const resolve = (text: string, mover: Side) => {
    const mine = mover === perspective;
    const sideName = mover === "w" ? "White" : "Black";
    return text
      .replaceAll("{S}", mine ? "You" : sideName)
      .replaceAll("{P}", mine ? "your" : `${sideName}'s`)
      .replaceAll("{Op}", mine ? "your opponent's" : "your");
  };

  const playerBar = (side: Side) => {
    const acc = summary.accuracy[side];
    const showAcc = status === "done" && !game.isFenOnly;
    return (
      <div className="flex items-center gap-2 py-1.5 text-sm">
        <span className={`h-4 w-4 rounded-sm border border-black/40 ${side === "w" ? "bg-[#f1f1ee]" : "bg-[#262421] ring-1 ring-[#5f5d5a]"}`} />
        <span className="font-bold text-white">{names[side]}</span>
        {elo[side] && elo[side] !== "?" && <span className="text-[#a7a6a2]">({elo[side]})</span>}
        {turnToMove === side && <span className="ml-1 rounded bg-[#3c3a37] px-1.5 text-[10px] font-bold uppercase text-[#a7a6a2]">to move</span>}
        {showAcc && <span className="ml-auto rounded bg-[#3c3a37] px-2 py-0.5 text-xs font-bold text-[#81b64c]">{acc.toFixed(1)}% accuracy</span>}
      </div>
    );
  };

  const bestArrow =
    showBest && reviewed && reviewed.bestUci && reviewed.rank !== 0 && ["inaccuracy", "mistake", "blunder", "good"].includes(reviewed.classification)
      ? { from: reviewed.bestUci.slice(0, 2), to: reviewed.bestUci.slice(2, 4) }
      : null;
  // when no review yet (or at a best move) show the engine's top suggestion for the current position as a faint arrow
  const topArrow = !reviewed && curEval?.lines[0]?.pv[0] ? [{ from: curEval.lines[0].pv[0].slice(0, 2), to: curEval.lines[0].pv[0].slice(2, 4), color: "rgba(129,182,76,0.55)" }] : [];

  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-5">
      {/* top status strip */}
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-[#262421] px-4 py-2.5 text-sm shadow-lg shadow-black/20">
        <button onClick={newReview} className="rounded-md bg-[#3c3a37] px-3 py-1.5 font-semibold text-white hover:bg-[#4b4947]">
          ← New review
        </button>
        <div className="min-w-0 flex-1">
          {analyzing || status === "cancelled" ? (
            <div>
              <div className="flex items-center justify-between gap-2 text-xs text-[#a7a6a2]">
                <span className="truncate">
                  {status === "loading" ? statusText : `${statusText} · position ${Math.min(done + (analyzing ? 1 : 0), total)}/${total}${live ? ` · depth ${live.depth}/${usedSettings.depth}` : ""}`}
                </span>
                <span>{status === "loading" && loadPct !== null ? `${Math.round(loadPct * 100)}%` : `${progressPct}%`}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#3c3a37]">
                <div
                  className="h-full rounded-full bg-[#81b64c] transition-all"
                  style={{ width: `${status === "loading" ? (loadPct !== null ? loadPct * 100 : 5) : progressPct}%` }}
                />
              </div>
            </div>
          ) : (
            <span className="text-[#a7a6a2]">
              {status === "done" ? "✓ " : ""}
              {statusText || "Ready"} · depth {usedSettings.depth} · MultiPV {usedSettings.multiPv}
              {savedId ? " · saved to history" : ""}
            </span>
          )}
        </div>
        {engineInfo && (
          <span className="hidden text-xs text-[#8b8987] md:inline" title={engineInfo.file}>
            {engineInfo.name} · {engineInfo.variant === "full" ? "NNUE full" : "NNUE lite"} · {engineInfo.threads} thread{engineInfo.threads > 1 ? "s" : ""} · {engineInfo.hashMb} MB hash
          </span>
        )}
        {analyzing && (
          <button onClick={cancel} className="rounded-md bg-[#ca3431] px-3 py-1.5 font-semibold text-white hover:bg-[#e04542]">
            Stop
          </button>
        )}
      </div>
      {error && <div className="mb-3 rounded-lg border border-[#ca3431]/60 bg-[#ca3431]/15 px-3 py-2 text-sm text-[#ffb4b2]">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_430px]">
        {/* ---------- board column ---------- */}
        <div className="mx-auto w-full" style={{ maxWidth: "min(100%, calc(100vh - 150px))", minWidth: 280 }}>
          {playerBar(topSide)}
          <div className="flex gap-2">
            <EvalBar cp={barLine ? barLine.cp : null} mate={barLine ? barLine.mate : null} flipped={flipped} />
            <div className="min-w-0 flex-1">
              <BoardView
                fen={currentFen}
                flipped={flipped}
                lastMove={gm ? { from: gm.from, to: gm.to, cls: reviewed?.classification } : null}
                bestMove={bestArrow}
                extraArrows={topArrow}
              />
            </div>
          </div>
          {playerBar(bottomSide)}

          <div className="mt-2 flex items-center justify-center gap-1.5">
            <CtrlButton label="⏮" title="Start (Home)" onClick={() => go(0)} />
            <CtrlButton label="◀" title="Previous (←)" onClick={() => go(ply - 1)} />
            <CtrlButton label={playing ? "⏸" : "▶"} title="Auto-play" onClick={() => setPlaying((p) => !p)} wide />
            <CtrlButton label="▶" title="Next (→)" onClick={() => go(ply + 1)} />
            <CtrlButton label="⏭" title="End (End)" onClick={() => go(maxPly)} />
            <CtrlButton label="⇅" title="Flip board (F)" onClick={() => setFlipped((f) => !f)} />
          </div>
        </div>

        {/* ---------- side panel ---------- */}
        <div className="flex min-w-0 flex-col gap-3">
          {/* coach */}
          <div className="rounded-lg bg-[#262421] p-4 shadow-lg shadow-black/20">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-wide text-[#a7a6a2]">Coach</span>
              <div className="flex overflow-hidden rounded-md bg-[#1d1c1a] text-[11px] font-semibold">
                {(["w", "b"] as Side[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setPerspective(s)}
                    className={`px-2 py-1 ${perspective === s ? "bg-[#81b64c] text-white" : "text-[#a7a6a2] hover:text-white"}`}
                  >
                    As {s === "w" ? "White" : "Black"}
                  </button>
                ))}
              </div>
            </div>

            {ply === 0 ? (
              <div>
                <p className="text-base font-bold text-white">{game.isFenOnly ? "Position analysis" : "Starting position"}</p>
                <p className="mt-1 text-sm text-[#c4c3c0]">
                  {game.isFenOnly
                    ? `${turnToMove === "w" ? "White" : "Black"} to move. Stockfish evaluates the position with its top ${usedSettings.multiPv} candidate lines below.`
                    : "Use the arrow keys or the move list to step through the game. Every move is graded by how much win probability it gained or lost."}
                </p>
              </div>
            ) : reviewed && gm ? (
              <div>
                <div className="flex items-center gap-2.5">
                  <ClassBadge cls={reviewed.classification} size={30} />
                  <div className="min-w-0">
                    <p className="truncate text-base font-bold text-white">
                      {gm.san} <span style={{ color: CLASS_META[reviewed.classification].color }}>is {articleFor(CLASS_META[reviewed.classification].label)}</span>
                    </p>
                    <p className="text-xs text-[#8b8987]">
                      {gm.color === "w" ? "White" : "Black"} · move {startNumber + Math.floor((ply - 1 + (startsBlack ? 1 : 0)) / 2)}
                      {reviewed.mitigated ? " · pawn-blunder mitigation applied" : ""}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-[#e1e0dd]">{resolve(reviewed.explanation, gm.color)}</p>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <Stat label="Eval before" value={evalText(evals[ply - 1])} />
                  <Stat label="Eval after" value={evalText(evals[ply])} />
                  <Stat label="Win-rate Δ" value={`${reviewed.deltaWR > 0 ? "−" : ""}${(reviewed.deltaWR * 100).toFixed(1)}%`} />
                </div>

                {reviewed.bestSan && reviewed.rank !== 0 && (
                  <button
                    onClick={() => setShowBest((s) => !s)}
                    className="mt-3 w-full rounded-md bg-[#3c3a37] px-3 py-2 text-sm font-semibold text-white hover:bg-[#4b4947]"
                  >
                    {showBest ? "Hide" : "Show"} best move: <span className="text-[#81b64c]">{reviewed.bestSan}</span>
                  </button>
                )}
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-[#a7a6a2]">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#81b64c] border-t-transparent" />
                Waiting for the engine to finish this position…
              </p>
            )}
          </div>

          {/* tabs */}
          <div className="rounded-lg bg-[#262421] p-3 shadow-lg shadow-black/20">
            <div className="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-[#1d1c1a] p-1 text-sm font-semibold">
              {(
                [
                  ["report", "Report"],
                  ["moves", "Moves"],
                  ["lines", "Engine lines"],
                ] as [Tab, string][]
              ).map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)} className={`rounded-md py-1.5 ${tab === id ? "bg-[#3c3a37] text-white" : "text-[#a7a6a2] hover:text-white"}`}>
                  {label}
                </button>
              ))}
            </div>

            {tab === "report" && (
              <div className="space-y-4">
                {!game.isFenOnly && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      {(["w", "b"] as Side[]).map((s) => (
                        <div key={s} className="rounded-lg bg-[#1d1c1a] p-3 text-center">
                          <p className="truncate text-xs font-semibold text-[#a7a6a2]">{names[s]}</p>
                          <p className="mt-1 text-3xl font-extrabold text-white">{summary.accuracy[s].toFixed(1)}</p>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-[#81b64c]">Accuracy</p>
                        </div>
                      ))}
                    </div>

                    <EvalGraph evals={evals} moves={moves} ply={ply} onSelect={go} />

                    <div className="rounded-lg bg-[#1d1c1a] p-2">
                      {CLASS_ORDER.map((c) => (
                        <div key={c} className="grid grid-cols-[1fr_44px_44px] items-center gap-2 px-2 py-1 text-sm">
                          <span className="flex items-center gap-2 text-[#d3d2d0]">
                            <ClassBadge cls={c} size={18} /> {CLASS_META[c].label}
                          </span>
                          <span className="text-center font-bold" style={{ color: summary.counts.w[c] ? CLASS_META[c].color : "#5f5d5a" }}>
                            {summary.counts.w[c]}
                          </span>
                          <span className="text-center font-bold" style={{ color: summary.counts.b[c] ? CLASS_META[c].color : "#5f5d5a" }}>
                            {summary.counts.b[c]}
                          </span>
                        </div>
                      ))}
                      <div className="grid grid-cols-[1fr_44px_44px] gap-2 border-t border-[#3c3a37] px-2 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-[#8b8987]">
                        <span>Move classification</span>
                        <span className="text-center">White</span>
                        <span className="text-center">Black</span>
                      </div>
                    </div>
                  </>
                )}
                {game.isFenOnly && <p className="text-sm text-[#a7a6a2]">Position analysis has no move report. Open the “Engine lines” tab to see the best continuations.</p>}
              </div>
            )}

            {tab === "moves" && <MoveList game={game.moves} moves={moves} ply={ply} onSelect={go} startNumber={startNumber} />}

            {tab === "lines" && (
              <div className="space-y-1.5">
                {lines.length === 0 && <p className="p-2 text-sm text-[#8b8987]">{analyzing ? "Waiting for the engine…" : "No engine lines for this position."}</p>}
                {curEval?.terminal && <p className="p-2 text-sm text-[#c4c3c0]">{curEval.terminal === "checkmate" ? "Checkmate – the game is over." : "The game is drawn."}</p>}
                {!curEval?.terminal &&
                  lines.map((l) => (
                    <div key={l.multipv} className="flex items-start gap-2 rounded-md bg-[#1d1c1a] p-2">
                      <span
                        className={`mt-0.5 w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-extrabold ${l.cp >= 0 ? "bg-[#f1f1ee] text-[#262421]" : "bg-[#3c3a37] text-white"}`}
                      >
                        {formatEval(l.cp, l.mate)}
                      </span>
                      <span className="text-sm leading-snug text-[#d3d2d0]">{pvToSan(currentFen, l.pv, 9)}</span>
                    </div>
                  ))}
                {lines.length > 0 && !curEval?.terminal && (
                  <p className="px-1 pt-1 text-xs text-[#8b8987]">
                    Depth {lineDepth} · top {lines.length} lines (MultiPV {usedSettings.multiPv}) · evals from White’s point of view
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const CLASS_PHRASE: Record<string, string> = {
  Brilliant: "a brilliant move",
  "Great Move": "a great move",
  "Best Move": "the best move",
  Excellent: "an excellent move",
  Good: "a good move",
  Inaccuracy: "an inaccuracy",
  Mistake: "a mistake",
  Blunder: "a blunder",
};

function articleFor(label: string) {
  return CLASS_PHRASE[label] ?? label.toLowerCase();
}

function evalText(e: PositionEval | null | undefined) {
  const l = e?.lines[0];
  return l ? formatEval(l.cp, l.mate) : "…";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[#1d1c1a] px-2 py-1.5">
      <div className="text-sm font-extrabold text-white">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-[#8b8987]">{label}</div>
    </div>
  );
}

function CtrlButton({ label, title, onClick, wide }: { label: string; title: string; onClick: () => void; wide?: boolean }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`rounded-md bg-[#3c3a37] py-2 text-base font-bold text-white transition hover:bg-[#4b4947] active:translate-y-px ${wide ? "w-16" : "w-12"}`}
    >
      {label}
    </button>
  );
}
