import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Engine, isEngineCached, clearEngineCache, type DownloadProgress } from "../lib/engine";
import { loadBook } from "../lib/book";
import {
  analyzeGame,
  parsePgn,
  SAMPLE_PGN,
  type Mode,
  type MoveInfo,
  type ProgressInfo,
  type Review,
} from "../lib/analysis";

export type Phase = "input" | "analyzing" | "done";
export type EngineState = "idle" | "downloading" | "starting" | "ready" | "error";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

async function resolveInput(text: string): Promise<string> {
  const t = text.trim();
  const m = /lichess\.org\/([A-Za-z0-9]{8})/.exec(t);
  if (m && !t.includes("[") && !/\d+\.\s*\S/.test(t.replace(/https?:\/\/\S+/g, ""))) {
    const res = await fetch(`https://lichess.org/game/export/${m[1]}?clocks=false&evals=false`, {
      headers: { Accept: "application/x-chess-pgn" },
    });
    if (!res.ok) throw new Error("Не удалось загрузить партию с lichess.");
    return await res.text();
  }
  return t;
}

export function useReviewApp(isMobile: boolean) {
  const [pgn, setPgn] = useState("");
  const [mode, setMode] = useState<Mode>("fast");
  const [phase, setPhase] = useState<Phase>("input");
  const [error, setError] = useState<string | null>(null);
  const [engineState, setEngineState] = useState<EngineState>("idle");
  const [cached, setCached] = useState<boolean | null>(null);
  const [dl, setDl] = useState<DownloadProgress | null>(null);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [ply, setPlyState] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showBest, setShowBest] = useState(false);

  const engineRef = useRef<Engine | null>(null);
  const enginePromise = useRef<Promise<Engine> | null>(null);
  const abort = useRef({ aborted: false });

  const hash = isMobile ? 32 : 96;

  const ensureEngine = useCallback((): Promise<Engine> => {
    if (enginePromise.current) return enginePromise.current;
    setEngineState("downloading");
    setError(null);
    const p = Engine.create((d) => {
      setDl(d);
      if (d.phase === "start") setEngineState("starting");
    }, hash)
      .then((e) => {
        engineRef.current = e;
        setEngineState("ready");
        setCached(true);
        return e;
      })
      .catch((err) => {
        enginePromise.current = null;
        setEngineState("error");
        setError(
          "Не удалось загрузить Stockfish 19: " +
            (err?.message || "нет соединения") +
            ". Проверьте интернет и попробуйте ещё раз."
        );
        throw err;
      });
    enginePromise.current = p;
    return p;
  }, [hash]);

  // при заходе: проверяем кэш; если движок уже в кэше — тихо запускаем его
  useEffect(() => {
    let alive = true;
    loadBook().catch(() => {});
    isEngineCached().then((c) => {
      if (!alive) return;
      setCached(c);
      if (c) ensureEngine().catch(() => {});
    });
    return () => {
      alive = false;
    };
  }, [ensureEngine]);

  const setPly = useCallback(
    (p: number) => {
      setPlyState((cur) => {
        const max = review ? review.moves.length : 0;
        const next = Math.max(0, Math.min(max, typeof p === "number" ? p : cur));
        return next;
      });
      setShowBest(false);
    },
    [review]
  );

  const start = useCallback(async () => {
    setError(null);
    let text = pgn;
    try {
      text = await resolveInput(pgn);
      if (!text) throw new Error("Вставьте PGN партии или ссылку на партию lichess.");
      parsePgn(text);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    abort.current = { aborted: false };
    const signal = abort.current;
    setPhase("analyzing");
    setProgress(null);
    try {
      const engine = await ensureEngine();
      if (signal.aborted) return;
      const book = await loadBook();
      const r = await analyzeGame({
        pgn: text,
        mode,
        engine,
        book,
        signal,
        onProgress: setProgress,
      });
      setReview(r);
      setPlyState(0);
      setFlipped(false);
      setShowBest(false);
      setPhase("done");
    } catch (e) {
      if (signal.aborted) return;
      setPhase("input");
      setError((e as Error).message || "Ошибка анализа");
    }
  }, [pgn, mode, ensureEngine]);

  const cancel = useCallback(() => {
    abort.current.aborted = true;
    engineRef.current?.stop();
    setPhase("input");
    setProgress(null);
  }, []);

  const reset = useCallback(() => {
    setReview(null);
    setPhase("input");
    setPlyState(0);
    setProgress(null);
  }, []);

  const loadSample = useCallback(() => {
    setPgn(SAMPLE_PGN);
    setError(null);
  }, []);

  const removeEngineCache = useCallback(async () => {
    engineRef.current?.terminate();
    engineRef.current = null;
    enginePromise.current = null;
    await clearEngineCache();
    setCached(false);
    setEngineState("idle");
    setDl(null);
  }, []);

  // клавиатура
  useEffect(() => {
    if (phase !== "done" || !review) return;
    const max = review.moves.length;
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft") setPlyState((p) => Math.max(0, p - 1));
      else if (e.key === "ArrowRight") setPlyState((p) => Math.min(max, p + 1));
      else if (e.key === "ArrowUp" || e.key === "Home") setPlyState(0);
      else if (e.key === "ArrowDown" || e.key === "End") setPlyState(max);
      else if (e.key === "f") setFlipped((f) => !f);
      else return;
      setShowBest(false);
      e.preventDefault();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [phase, review]);

  // что показываем на доске
  const view = useMemo(() => {
    if (phase === "analyzing") {
      return {
        fen: progress?.fen ?? START_FEN,
        move: null as MoveInfo | null,
        value: progress?.value ?? 0,
        mate: progress?.mate ?? null,
      };
    }
    if (review) {
      const pos = review.positions[ply];
      const move = ply > 0 ? review.moves[ply - 1] : null;
      return { fen: pos.fen, move, value: pos.value, mate: pos.mate };
    }
    return { fen: START_FEN, move: null as MoveInfo | null, value: 0, mate: null as number | null };
  }, [phase, progress, review, ply]);

  const lastMove: [string, string] | null = view.move ? [view.move.from, view.move.to] : null;
  const arrow =
    showBest && view.move && view.move.bestUci
      ? { from: view.move.bestUci.slice(0, 2), to: view.move.bestUci.slice(2, 4) }
      : null;
  const badge = view.move && phase === "done" ? { square: view.move.to, cat: view.move.cat } : null;

  return {
    pgn,
    setPgn,
    mode,
    setMode,
    phase,
    error,
    setError,
    engineState,
    cached,
    dl,
    progress,
    review,
    ply,
    setPly,
    flipped,
    setFlipped,
    showBest,
    setShowBest,
    start,
    cancel,
    reset,
    loadSample,
    ensureEngine,
    removeEngineCache,
    view,
    lastMove,
    arrow,
    badge,
  };
}

export type ReviewApp = ReturnType<typeof useReviewApp>;
