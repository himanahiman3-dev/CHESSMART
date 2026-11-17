import { useEffect, useMemo, useState } from "react";
import type { PlayerProfile, TrainingPuzzle } from "../lib/playerProfile";
import { markPuzzleSolved, recordPuzzleAttempt } from "../lib/playerProfile";
import { GameBoard, type BoardMove } from "./GameBoard";

interface Props {
  profile: PlayerProfile;
  onChange: (profile: PlayerProfile) => void;
  onBack: () => void;
}

export function MistakeTrainerScreen({ profile, onChange, onBack }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(() => profile.puzzles.find((p) => !p.solvedAt)?.id ?? profile.puzzles[0]?.id ?? null);
  const [position, setPosition] = useState("");
  const [feedback, setFeedback] = useState<"idle" | "wrong" | "solved">("idle");
  const [solutionShown, setSolutionShown] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "solved">("open");
  const [severityFilter, setSeverityFilter] = useState<"all" | TrainingPuzzle["cls"]>("all");
  const unsolved = useMemo(() => profile.puzzles.filter((p) => !p.solvedAt), [profile.puzzles]);
  const visiblePuzzles = useMemo(() => profile.puzzles.filter((puzzle) => {
    const statusMatches = statusFilter === "all" || (statusFilter === "open" ? !puzzle.solvedAt : !!puzzle.solvedAt);
    return statusMatches && (severityFilter === "all" || puzzle.cls === severityFilter);
  }), [profile.puzzles, statusFilter, severityFilter]);
  const current = visiblePuzzles.find((p) => p.id === selectedId) ?? visiblePuzzles[0] ?? null;
  const solvedCount = profile.puzzles.length - unsolved.length;

  useEffect(() => {
    setPosition(current?.fen ?? "");
    setFeedback("idle");
    setSolutionShown(false);
  }, [current?.id, current?.fen]);

  const selectNext = () => {
    const next = visiblePuzzles.find((p) => !p.solvedAt && p.id !== current?.id);
    if (next) setSelectedId(next.id);
    else if (current) setSelectedId(current.id);
  };

  const handleMove = (move: BoardMove): boolean => {
    if (!current || current.solvedAt || feedback === "solved") return false;
    if (move.uci === current.bestUci) {
      setPosition(move.fenAfter);
      setFeedback("solved");
      onChange(markPuzzleSolved(profile, current.id));
      return true;
    }
    onChange(recordPuzzleAttempt(profile, current.id));
    setFeedback("wrong");
    return false;
  };

  const label = current ? ({ inaccuracy: "Неточность", mistake: "Ошибка", miss: "Упущенная возможность", blunder: "Зевок" } as const)[current.cls] : "";

  return (
    <div className="min-h-screen bg-[#312e2b] p-4 text-white sm:p-7">
      <div className="mx-auto max-w-5xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold">Задачи из твоих партий</h1>
            <p className="text-sm text-[#a7a6a2]">Повторяй позиции, где можно было сыграть сильнее</p>
          </div>
          <button onClick={onBack} className="rounded-lg bg-[#3d3a37] px-3 py-2 text-sm font-semibold hover:bg-[#4b4844]">Назад</button>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
          <section className="rounded-2xl bg-[#262421] p-3 sm:p-4">
            {current ? (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-bold">Найди лучший ход за {current.color === "w" ? "белых" : "чёрных"}</span>
                  <span className="rounded bg-[#3d3a37] px-2 py-1 text-xs text-[#d5d3cf]">{label} · {current.moveNumber}-й ход</span>
                </div>
                <GameBoard
                  fen={position || current.fen}
                  orientation={current.color === "w" ? "white" : "black"}
                  animKey={current.moveNumber + (feedback === "solved" ? 1 : 0)}
                  interactive={!current.solvedAt && feedback !== "solved"}
                  allowedColor={current.color}
                  onMove={handleMove}
                />
                <div className={`mt-3 rounded-lg p-3 text-sm ${feedback === "solved" ? "bg-[#2f3a28] text-[#cfe7ac]" : feedback === "wrong" ? "bg-[#4a2927] text-[#ffb4b2]" : "bg-[#2b2926] text-[#dcdbd7]"}`}>
                  {feedback === "solved" || current.solvedAt
                    ? `Верно! Лучший ход: ${current.bestSan ?? current.bestUci}. Задача решена.`
                    : feedback === "wrong"
                      ? "Не этот ход. Попробуй ещё раз — позиция осталась прежней."
                      : "Сделай ход на доске. Это позиция из твоей партии, в которой анализатор нашёл более сильное продолжение."}
                </div>
              </>
            ) : (
              <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
                <div className="text-xl font-extrabold">Пока нет задач</div>
                <p className="mt-2 max-w-md text-sm text-[#a7a6a2]">Загрузи и проанализируй партию. Ошибки, зевки и упущенные возможности автоматически попадут сюда.</p>
              </div>
            )}
          </section>

          <aside className="space-y-3">
            <section className="rounded-2xl bg-[#262421] p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-[#a7a6a2]">Прогресс</div>
              <div className="mt-1 text-3xl font-black tabular-nums">{solvedCount}<span className="text-base text-[#77746f]"> / {profile.puzzles.length}</span></div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#1f1d1b]"><div className="h-full rounded-full bg-[#81b64c]" style={{ width: `${profile.puzzles.length ? solvedCount / profile.puzzles.length * 100 : 0}%` }} /></div>
              <div className="mt-3 text-xs text-[#a7a6a2]">Нерешённых: {unsolved.length}</div>
            </section>
            {current && (
              <section className="rounded-2xl bg-[#262421] p-4">
                <div className="text-sm font-extrabold">Разбор ошибки</div>
                <div className="mt-2 text-sm text-[#dcdbd7]">{current.comment}</div>
                <div className="mt-2 text-xs text-[#77746f]">Партия: {current.sourceGame}</div>
                <div className="mt-1 text-xs text-[#77746f]">Попыток: {current.attempts}</div>
                {feedback !== "solved" && !current.solvedAt && (
                  <button onClick={() => setSolutionShown((value) => !value)} className="mt-3 w-full rounded-lg bg-[#3d3a37] px-3 py-2 text-sm font-semibold hover:bg-[#4b4844]">
                    {solutionShown ? "Скрыть ответ" : "Показать ответ"}
                  </button>
                )}
                {solutionShown && <div className="mt-2 rounded-lg bg-[#2f3a28] p-2 text-sm text-[#cfe7ac]">Лучший ход: {current.bestSan ?? current.bestUci}</div>}
                <button onClick={selectNext} disabled={!visiblePuzzles.some((p) => !p.solvedAt && p.id !== current.id)} className="mt-2 w-full rounded-lg bg-[#81b64c] px-3 py-2.5 text-sm font-extrabold text-[#17210f] hover:bg-[#95c75f] disabled:opacity-40">Следующая задача →</button>
              </section>
            )}
            <section className="rounded-2xl bg-[#262421] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-bold uppercase tracking-wide text-[#a7a6a2]">Задачи · {visiblePuzzles.length}</div>
                <button onClick={() => { setStatusFilter("all"); setSeverityFilter("all"); }} className="text-[10px] font-bold text-[#a3d160] hover:text-white">Сбросить</button>
              </div>
              <div className="mb-2 flex flex-wrap gap-1">
                {(["open", "solved", "all"] as const).map((filter) => (
                  <button key={filter} onClick={() => setStatusFilter(filter)} className={`rounded-md px-2 py-1 text-[10px] font-bold ${statusFilter === filter ? "bg-[#526d3e] text-white" : "bg-[#1f1d1b] text-[#a7a6a2] hover:text-white"}`}>
                    {filter === "open" ? "Нерешённые" : filter === "solved" ? "Решённые" : "Все"}
                  </button>
                ))}
              </div>
              <label className="mb-2 block text-[10px] text-[#a7a6a2]">
                Тип ошибки
                <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as typeof severityFilter)} className="mt-1 w-full rounded-lg border border-[#45413c] bg-[#1f1d1b] px-2 py-2 text-xs text-white outline-none focus:border-[#81b64c]">
                  <option value="all">Все типы</option>
                  <option value="inaccuracy">Неточности</option>
                  <option value="mistake">Ошибки</option>
                  <option value="miss">Упущенные возможности</option>
                  <option value="blunder">Зевки</option>
                </select>
              </label>
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {[...visiblePuzzles].reverse().map((puzzle: TrainingPuzzle) => (
                  <button key={puzzle.id} onClick={() => setSelectedId(puzzle.id)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${selectedId === puzzle.id ? "bg-[#3d3a37]" : "hover:bg-[#2b2926]"}`}>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${puzzle.solvedAt ? "bg-[#81b64c]" : "bg-[#f7c045]"}`} />
                    <span className="min-w-0 flex-1 truncate">{puzzle.moveNumber}. {puzzle.playedSan} · {puzzle.sourceGame}</span>
                  </button>
                ))}
                {visiblePuzzles.length === 0 && <div className="p-3 text-center text-xs text-[#77746f]">Нет задач под выбранные фильтры.</div>}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
