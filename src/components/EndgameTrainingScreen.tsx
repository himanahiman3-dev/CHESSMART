import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import type { StockfishEngine } from "../lib/engine";
import type { PlayerProfile, TrainingSessionSummary } from "../lib/playerProfile";
import { GameBoard, type BoardMove } from "./GameBoard";

interface Props {
  engine: StockfishEngine;
  profile: PlayerProfile;
  onChange: (profile: PlayerProfile) => void;
  onBack: () => void;
}

const ENDGAMES = [
  {
    id: "queen-mate",
    title: "Мат ферзём и королём",
    description: "Поставь мат одинокому королю. Начальная позиция содержит мат в один ход.",
    fen: "7k/8/5KQ1/8/8/8/8/8 w - - 0 1",
    goal: "mate" as const,
  },
  {
    id: "rook-mate",
    title: "Мат ладьёй и королём",
    description: "Ограничь короля соперника и доведи технически выигранный эндшпиль до мата.",
    fen: "k7/8/2K5/8/8/8/8/1R6 w - - 0 1",
    goal: "mate" as const,
  },
  {
    id: "passed-pawn",
    title: "Проведи проходную пешку",
    description: "Используй проходную пешку и добейся превращения в ферзя или ладью.",
    fen: "8/P7/8/8/4k3/8/4K3/8 w - - 0 1",
    goal: "promotion" as const,
  },
];

type Result = "success" | "failed" | null;

export function EndgameTrainingScreen({ engine, profile, onChange, onBack }: Props) {
  const [taskId, setTaskId] = useState(ENDGAMES[0].id);
  const task = ENDGAMES.find((item) => item.id === taskId) ?? ENDGAMES[0];
  const [fen, setFen] = useState(task.fen);
  const [started, setStarted] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const generation = useRef(0);
  const resultRef = useRef<Result>(null);
  const sessionRef = useRef<{ id: string; startedAt: number } | null>(null);
  const game = useMemo(() => new Chess(fen), [fen]);
  const endgameSessions = (profile.trainingSessions ?? []).filter((session) => session.category === "endgame");
  const endgameWins = endgameSessions.reduce((total, session) => total + session.solved, 0);
  const endgameTotal = endgameSessions.reduce((total, session) => total + session.total, 0);
  const endgameAccuracy = endgameTotal ? Math.round(endgameWins / endgameTotal * 100) : 0;

  const completeTask = useCallback((outcome: Exclude<Result, null>) => {
    if (resultRef.current) return;
    resultRef.current = outcome;
    setResult(outcome);
    setStarted(false);
    const active = sessionRef.current;
    if (!active) return;
    const completedAt = Date.now();
    const summary: TrainingSessionSummary = {
      id: active.id,
      category: "endgame",
      label: task.title,
      startedAt: active.startedAt,
      durationMs: Math.max(0, completedAt - active.startedAt),
      total: 1,
      solved: outcome === "success" ? 1 : 0,
      attempts: 1,
      correctMoves: outcome === "success" ? 1 : 0,
      accuracy: outcome === "success" ? 100 : 0,
    };
    onChange({
      ...profile,
      trainingSessions: [...(profile.trainingSessions ?? []), summary].slice(-100),
    });
    sessionRef.current = null;
  }, [onChange, profile, task.title]);

  const reset = () => {
    generation.current++;
    const startedAt = Date.now();
    sessionRef.current = { id: `endgame:${task.id}:${startedAt}`, startedAt };
    resultRef.current = null;
    setFen(task.fen);
    setStarted(true);
    setThinking(false);
    setResult(null);
    setError(null);
    setLastMove(null);
    engine.newGame();
  };

  useEffect(() => {
    if (!started || result || game.isGameOver() || game.turn() !== "b") return;
    const requestId = ++generation.current;
    let stale = false;
    const handle = engine.search({
      fen,
      depth: 16,
      multipv: 1,
      movetimeMs: 1100,
      strength: { skillLevel: 20, limitStrength: false },
    });
    setThinking(true);
    handle.promise.then((lines) => {
      if (stale || requestId !== generation.current) return;
      const uci = lines[0]?.pv[0];
      if (!uci) {
        setError("Stockfish не вернул ход. Нажми «Повторить позицию».");
        setThinking(false);
        return;
      }
      const next = new Chess(fen);
      const move = next.move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci.length > 4 ? uci[4] : "q" });
      if (!move) {
        setError("Движок вернул нелегальный ход. Повтори позицию.");
        setThinking(false);
        return;
      }
      setLastMove({ from: move.from, to: move.to });
      setFen(next.fen());
      setThinking(false);
    }).catch((reason: unknown) => {
      if (!stale && requestId === generation.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
        setThinking(false);
      }
    });
    return () => {
      stale = true;
      handle.stop();
    };
  }, [started, result, fen, game, engine]);

  useEffect(() => {
    if (!started || result || !game.isGameOver()) return;
    if (game.isCheckmate() && game.turn() === "b") completeTask("success");
    else completeTask("failed");
  }, [fen, game, started, result, completeTask]);

  const handlePlayerMove = (move: BoardMove): boolean => {
    if (!started || thinking || result || game.turn() !== "w") return false;
    const next = new Chess(fen);
    try {
      const played = next.move({ from: move.from as Square, to: move.to as Square, promotion: move.uci.length > 4 ? move.uci[4] : undefined });
      if (!played) return false;
      setLastMove({ from: played.from, to: played.to });
      setFen(next.fen());
      if (task.goal === "promotion" && played.promotion) completeTask("success");
      return true;
    } catch {
      return false;
    }
  };

  const changeTask = (id: string) => {
    const next = ENDGAMES.find((item) => item.id === id) ?? ENDGAMES[0];
    generation.current++;
    sessionRef.current = null;
    resultRef.current = null;
    setTaskId(id);
    setFen(next.fen);
    setStarted(false);
    setThinking(false);
    setResult(null);
    setError(null);
    setLastMove(null);
  };

  return (
    <div className="min-h-screen bg-[#312e2b] p-4 text-white sm:p-7">
      <div className="mx-auto max-w-5xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold">Тренировка эндшпиля</h1>
            <p className="text-sm text-[#a7a6a2]">Учись реализовывать материальное преимущество против Stockfish</p>
          </div>
          <button onClick={onBack} className="rounded-lg bg-[#3d3a37] px-3 py-2 text-sm font-semibold hover:bg-[#4b4844]">Назад</button>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
          <section className="rounded-2xl bg-[#262421] p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="font-bold">Ты — белыми</span>
              <span className="text-xs text-[#a7a6a2]">{thinking ? "Stockfish думает…" : started ? "Твой ход" : "Позиция готова"}</span>
            </div>
            <GameBoard
              fen={fen}
              orientation="white"
              lastMove={lastMove}
              animKey={fen.length + (fen.charCodeAt(0) || 0)}
              interactive={started && !thinking && !result && game.turn() === "w"}
              allowedColor="w"
              onMove={handlePlayerMove}
            />
            {result && (
              <div className={`mt-3 rounded-lg p-3 text-sm font-bold ${result === "success" ? "bg-[#2f3a28] text-[#cfe7ac]" : "bg-[#4a2927] text-[#ffb4b2]"}`}>
                {result === "success" ? (task.goal === "promotion" ? "Отлично! Пешка превратилась — задача выполнена." : "Мат! Эндшпиль реализован правильно.") : "Позиция завершилась не в твою пользу. Попробуй ещё раз."}
              </div>
            )}
            {error && <div className="mt-3 rounded-lg bg-[#4a2927] p-3 text-sm text-[#ffb4b2]">{error}</div>}
          </section>

          <aside className="space-y-3">
            <section className="rounded-2xl bg-[#262421] p-4">
              <div className="mb-2 text-sm font-extrabold">Выбери упражнение</div>
              <div className="space-y-2">
                {ENDGAMES.map((item) => (
                  <button key={item.id} onClick={() => changeTask(item.id)} className={`w-full rounded-lg border p-3 text-left ${taskId === item.id ? "border-[#81b64c] bg-[#2f3a28]" : "border-[#3d3a37] bg-[#2b2926] hover:bg-[#35322e]"}`}>
                    <div className="text-sm font-bold">{item.title}</div>
                    <div className="mt-1 text-xs leading-relaxed text-[#a7a6a2]">{item.description}</div>
                  </button>
                ))}
              </div>
              <button onClick={reset} disabled={thinking} className="mt-3 w-full rounded-xl bg-[#81b64c] py-3 text-sm font-extrabold text-[#17210f] shadow-[0_3px_0_#45753c] hover:bg-[#95c75f] disabled:opacity-40">{started ? "Повторить позицию" : "Начать упражнение"}</button>
            </section>
            <section className="rounded-xl bg-[#262421] p-4">
              <div className="text-sm font-bold">Твой прогресс</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-[#1f1d1b] p-2"><div className="text-xl font-black">{endgameSessions.length}</div><div className="text-[10px] text-[#a7a6a2]">Попыток</div></div>
                <div className="rounded-lg bg-[#1f1d1b] p-2"><div className="text-xl font-black text-[#a3d160]">{endgameAccuracy}%</div><div className="text-[10px] text-[#a7a6a2]">Успешность</div></div>
              </div>
              <div className="mt-2 text-xs text-[#a7a6a2]">Успешно выполнено: {endgameWins} из {endgameTotal}</div>
            </section>
            <section className="rounded-xl bg-[#262421] p-4 text-sm">
              <div className="font-bold">Цель</div>
              <p className="mt-1 text-[#a7a6a2]">{task.goal === "mate" ? "Поставить мат чёрному королю. Stockfish защищается на максимальной силе." : "Продвинуть проходную пешку до превращения. После превращения упражнение засчитывается."}</p>
              <p className="mt-2 text-xs text-[#77746f]">Это учебные позиции, а не официальный рейтинг или оценка твоей силы.</p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
