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
  {
    id: "connected-pawns",
    title: "Две связанные проходные",
    description: "Используй взаимную поддержку пешек и проведи хотя бы одну из них в ферзи.",
    fen: "8/1PP5/8/8/4k3/8/4K3/8 w - - 0 1",
    goal: "promotion" as const,
  },
  {
    id: "queen-technique",
    title: "Мат ферзём с активным королём",
    description: "Сократи пространство короля и поставь мат, не допуская пата.",
    fen: "7k/8/5K2/8/8/8/8/6Q1 w - - 0 1",
    goal: "mate" as const,
  },
  {
    id: "rook-pawn-mate",
    title: "Ладья и проходная пешка",
    description: "Используй ладью и короля, чтобы создать матовую сеть.",
    fen: "7k/8/5K2/8/8/8/6P1/6R1 w - - 0 1",
    goal: "mate" as const,
  },
  {
    id: "outside-passer",
    title: "Дальняя проходная",
    description: "Продвинь пешку на фланге, пока король соперника далеко.",
    fen: "8/8/P7/1K6/3k4/8/8/8 w - - 0 1",
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
  const [challengeQueue, setChallengeQueue] = useState<string[]>([]);
  const [challengeIndex, setChallengeIndex] = useState(0);
  const [challengeResults, setChallengeResults] = useState<Exclude<Result, null>[]>([]);
  const [challengeActive, setChallengeActive] = useState(false);
  const [challengeFinished, setChallengeFinished] = useState(false);
  const [challengeStartedAt, setChallengeStartedAt] = useState<number | null>(null);
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
    const trainingSessions = [...(profile.trainingSessions ?? [])];
    if (!challengeActive) trainingSessions.push(summary);
    if (challengeActive) {
      const results = [...challengeResults, outcome];
      setChallengeResults(results);
      if (challengeIndex === challengeQueue.length - 1) {
        const challengeStarted = challengeStartedAt ?? active.startedAt;
        const solved = results.filter((item) => item === "success").length;
        trainingSessions.push({
          id: `endgame-challenge:${challengeStarted}`,
          category: "endgame",
          label: "Эндшпильный вызов · 5 позиций",
          startedAt: challengeStarted,
          durationMs: Math.max(0, completedAt - challengeStarted),
          total: challengeQueue.length,
          solved,
          attempts: challengeQueue.length,
          correctMoves: solved,
          accuracy: Math.round(solved / Math.max(1, challengeQueue.length) * 100),
        });
        setChallengeActive(false);
        setChallengeFinished(true);
      }
    }
    onChange({ ...profile, trainingSessions: trainingSessions.slice(-100) });
    sessionRef.current = null;
  }, [onChange, profile, task.title, challengeActive, challengeResults, challengeIndex, challengeQueue.length, challengeStartedAt]);

  const startTask = (nextTask: typeof ENDGAMES[number], challenge = false) => {
    generation.current++;
    const startedAt = Date.now();
    sessionRef.current = { id: `endgame:${nextTask.id}:${startedAt}`, startedAt };
    resultRef.current = null;
    setTaskId(nextTask.id);
    setFen(nextTask.fen);
    setStarted(true);
    setThinking(false);
    setResult(null);
    setError(null);
    setLastMove(null);
    if (!challenge) {
      setChallengeActive(false);
      setChallengeFinished(false);
      setChallengeQueue([]);
      setChallengeResults([]);
    }
    engine.newGame();
  };

  const reset = () => startTask(task);

  const startChallenge = () => {
    const selected = [...ENDGAMES].sort(() => Math.random() - 0.5).slice(0, 5);
    if (selected.length < 5) return;
    setChallengeQueue(selected.map((item) => item.id));
    setChallengeIndex(0);
    setChallengeResults([]);
    setChallengeStartedAt(Date.now());
    setChallengeActive(true);
    setChallengeFinished(false);
    startTask(selected[0], true);
  };

  const nextChallengePosition = () => {
    const nextIndex = challengeIndex + 1;
    if (!challengeActive || nextIndex >= challengeQueue.length) return;
    const nextTask = ENDGAMES.find((item) => item.id === challengeQueue[nextIndex]);
    if (!nextTask) return;
    setChallengeIndex(nextIndex);
    startTask(nextTask, true);
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
    setChallengeActive(false);
    setChallengeFinished(false);
    setChallengeQueue([]);
    setChallengeResults([]);
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
              <span className="text-xs text-[#a7a6a2]">{challengeActive ? `Вызов · ${challengeIndex + 1}/5` : thinking ? "Stockfish думает…" : started ? "Твой ход" : "Позиция готова"}</span>
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
            {challengeActive && result && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#6b8052] bg-[#2b3827] p-3">
                <div className="text-xs text-[#d5e5c9]">Позиция {challengeIndex + 1} из 5 · Верно: {challengeResults.filter((item) => item === "success").length} из {challengeResults.length}</div>
                <button onClick={nextChallengePosition} className="rounded-lg bg-[#9bc96e] px-4 py-2 text-xs font-black text-[#192415]">Следующая позиция →</button>
              </div>
            )}
            {challengeFinished && (
              <div className="mt-3 rounded-xl border border-[#718e55] bg-[#30442b] p-3">
                <div className="text-sm font-black text-[#d7edc3]">Пятиступенчатый вызов завершён</div>
                <div className="mt-1 text-xs text-[#c2d6b4]">Решено {challengeResults.filter((item) => item === "success").length} из 5. Результат записан в статистику эндшпиля.</div>
              </div>
            )}
          </section>

          <aside className="space-y-3">
            <section className="rounded-2xl bg-[#262421] p-4">
              <div className="mb-2 text-sm font-extrabold">Выбери упражнение</div>
              <button onClick={startChallenge} className="mb-3 w-full rounded-xl border border-[#759657] bg-gradient-to-r from-[#405b32] to-[#31442c] p-3 text-left hover:from-[#4b683b] hover:to-[#3b5232]">
                <div className="text-sm font-black text-[#e0efd5]">Вызов · 5 позиций</div>
                <div className="mt-1 text-[10px] text-[#b7c9a9]">Пять случайных эндшпилей подряд. Результат попадёт в твою статистику.</div>
              </button>
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
