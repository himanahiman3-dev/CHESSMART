import { useCallback, useEffect, useMemo, useState } from "react";
import { Chess, type Square } from "chess.js";
import { GameBoard, type BoardMove } from "./GameBoard";
import { loadPuzzleBank, type Puzzle } from "./PuzzleLibraryScreen";

type Tab = "daily" | "rush" | "custom";
type RushMode = "3m" | "5m" | "survival";
interface SavedProgress {
  completedDates: string[];
  heartsByDate: Record<string, number>;
  rushBest: Record<RushMode, number>;
  hardMode: boolean;
}
const STORAGE_KEY = "chessmart:daily-rush-progress:v1";
const EMPTY: SavedProgress = { completedDates: [], heartsByDate: {}, rushBest: { "3m": 0, "5m": 0, survival: 0 }, hardMode: false };
const THEMES: Array<[string, string]> = [
  ["fork", "Вилки"], ["pin", "Связки"], ["skewer", "Шпажки"], ["mateIn1", "Мат в 1"],
  ["mateIn2", "Мат в 2"], ["mateIn3", "Мат в 3"], ["hangingPiece", "Выигрыш фигуры"],
  ["sacrifice", "Жертвы"], ["backRankMate", "Мат на последней линии"], ["defensiveMove", "Защита"],
  ["discoveredAttack", "Вскрытое нападение"], ["promotion", "Превращение"], ["quietMove", "Тихий ход"],
];
const dayKey = (date: Date) => date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
const dayOrdinal = (date: Date) => Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
function readProgress(): SavedProgress {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<SavedProgress> | null;
    return {
      completedDates: Array.isArray(saved?.completedDates) ? saved.completedDates.filter((value): value is string => typeof value === "string") : [],
      heartsByDate: saved?.heartsByDate && typeof saved.heartsByDate === "object" ? saved.heartsByDate : {},
      rushBest: { ...EMPTY.rushBest, ...(saved?.rushBest ?? {}) },
      hardMode: typeof saved?.hardMode === "boolean" ? saved.hardMode : false,
    };
  } catch { return EMPTY; }
}
function saveProgress(value: SavedProgress) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* local progress is optional */ }
}
function streakDays(completed: string[]): number {
  const days = new Set(completed);
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  if (!days.has(dayKey(cursor))) return 0;
  let total = 0;
  while (days.has(dayKey(cursor))) { total++; cursor.setDate(cursor.getDate() - 1); }
  return total;
}
function randomItem<T>(items: T[]): T | null {
  return items.length ? items[Math.floor(Math.random() * items.length)] : null;
}
function advancePuzzle(puzzle: Puzzle, fen: string, index: number, move: BoardMove): { fen: string; index: number; done: boolean } | null {
  if (puzzle.moves[index] !== move.uci) return null;
  try {
    const chess = new Chess(fen);
    const played = chess.move({ from: move.from as Square, to: move.to as Square, promotion: (move.uci[4] ?? "q") as never });
    if (!played) return null;
    let nextIndex = index + 1;
    if (nextIndex < puzzle.moves.length) {
      const reply = puzzle.moves[nextIndex];
      const answer = chess.move({ from: reply.slice(0, 2) as Square, to: reply.slice(2, 4) as Square, promotion: (reply[4] ?? "q") as never });
      if (!answer) return null;
      nextIndex++;
    }
    return { fen: chess.fen(), index: nextIndex, done: nextIndex >= puzzle.moves.length };
  } catch { return null; }
}
function formatTime(seconds: number): string {
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

export function DailyTrainingScreen({ onBack }: { onBack: () => void }) {
  const [bank, setBank] = useState<Puzzle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("daily");
  const [saved, setSaved] = useState<SavedProgress>(readProgress);
  const [dailyOffset, setDailyOffset] = useState(0);
  const [dailyFen, setDailyFen] = useState("");
  const [dailyIndex, setDailyIndex] = useState(0);
  const [dailyHearts, setDailyHearts] = useState(5);
  const [dailyHint, setDailyHint] = useState(0);
  const [dailyMessage, setDailyMessage] = useState("Найди лучший ход. У тебя пять жизней — используй их с умом.");
  const [dailyDone, setDailyDone] = useState(false);
  const [rushMode, setRushMode] = useState<RushMode>("3m");
  const [rushRunning, setRushRunning] = useState(false);
  const [rushFinished, setRushFinished] = useState(false);
  const [rushTime, setRushTime] = useState(180);
  const [rushScore, setRushScore] = useState(0);
  const [rushMistakes, setRushMistakes] = useState(0);
  const [rushPuzzle, setRushPuzzle] = useState<Puzzle | null>(null);
  const [rushFen, setRushFen] = useState("");
  const [rushIndex, setRushIndex] = useState(0);
  const [customTheme, setCustomTheme] = useState("fork");
  const [customLevel, setCustomLevel] = useState("all");
  const [customPuzzle, setCustomPuzzle] = useState<Puzzle | null>(null);
  const [customFen, setCustomFen] = useState("");
  const [customIndex, setCustomIndex] = useState(0);
  const [customMessage, setCustomMessage] = useState("Выбери тему и сложность, затем начинай решать.");
  const [customSolved, setCustomSolved] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    loadPuzzleBank(controller.signal, setLoaded)
      .then((items) => { setBank(items); setError(null); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => saveProgress(saved), [saved]);

  const dailyDate = useMemo(() => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + dailyOffset);
    return date;
  }, [dailyOffset]);
  const dailyKey = dayKey(dailyDate);
  const dailyWeekday = (dailyDate.getDay() + 6) % 7;
  const difficultyLabels = ["Разминка", "Лёгкая", "Уверенная", "Средняя", "Сложная", "Очень сложная", "Экспертная"];
  const dailyPuzzle = useMemo(() => {
    if (!bank.length) return null;
    const sorted = [...bank].sort((a, b) => a.rating - b.rating);
    const start = Math.floor(dailyWeekday * sorted.length / 7);
    const end = Math.max(start + 1, Math.floor((dailyWeekday + 1) * sorted.length / 7));
    const pool = sorted.slice(start, end);
    const index = ((dayOrdinal(dailyDate) % pool.length) + pool.length) % pool.length;
    return pool[index] ?? null;
  }, [bank, dailyDate, dailyWeekday]);
  const dailyCurrentMove = dailyPuzzle?.moves[dailyIndex] ?? "";
  const dailyStreak = streakDays(saved.completedDates);
  const dailyPieceHint = dailyHint >= 1 && dailyCurrentMove ? dailyCurrentMove.slice(0, 2) : "";
  const dailySquareStyles = dailyPieceHint ? { [dailyPieceHint]: { background: "rgba(163, 209, 111, .68)", boxShadow: "inset 0 0 0 3px rgba(234,255,214,.8)" } } : undefined;

  useEffect(() => {
    if (!dailyPuzzle) return;
    setDailyFen(dailyPuzzle.fen);
    setDailyIndex(0);
    setDailyHearts(saved.heartsByDate[dailyKey] ?? 5);
    setDailyHint(0);
    const done = saved.completedDates.includes(dailyKey);
    setDailyDone(done);
    setDailyMessage(done ? "Эта задача уже решена. Можешь вернуться к ней в архиве в любое время." : "Найди лучший ход. У тебя пять жизней — используй их с умом.");
  }, [dailyPuzzle?.id, dailyKey]);

  const markDailyDone = useCallback(() => {
    setDailyDone(true);
    setDailyMessage("Задача решена! Отличная работа. Ежедневная серия сохранена.");
    setSaved((previous) => ({
      ...previous,
      completedDates: [...new Set([...previous.completedDates, dailyKey])].sort().slice(-500),
    }));
  }, [dailyKey]);

  const onDailyMove = useCallback((move: BoardMove): boolean => {
    if (!dailyPuzzle || dailyDone) return false;
    const result = advancePuzzle(dailyPuzzle, dailyFen, dailyIndex, move);
    if (!result) {
      const nextHearts = Math.max(0, dailyHearts - 1);
      setDailyHearts(nextHearts);
      setSaved((previous) => ({ ...previous, heartsByDate: { ...previous.heartsByDate, [dailyKey]: nextHearts } }));
      setDailyMessage(saved.hardMode
        ? nextHearts === 0 ? "Сердца закончились. Продолжай самостоятельно — решение всё ещё засчитывается." : "Неверный ход. Одно сердце потеряно. Продолжай без подсказки тренера."
        : nextHearts === 0 ? "Сердца закончились — но ты всё ещё можешь решить задачу и сохранить серию."
        : nextHearts === 1 ? "Осталось последнее сердце. Проверь шахи, взятия и прямые угрозы."
        : "Не тот ход. Тренер подсказывает: проверь все шахи, взятия и угрозы.");
      return false;
    }
    setDailyFen(result.fen);
    setDailyIndex(result.index);
    setDailyMessage(result.done ? "Точно рассчитано. Позиция решена!" : "Верно! Соперник ответил. Найди продолжение.");
    if (result.done) markDailyDone();
    return true;
  }, [dailyPuzzle, dailyDone, dailyFen, dailyIndex, dailyHearts, dailyKey, saved.hardMode, markDailyDone]);

  const useDailyHint = () => {
    if (!dailyPuzzle || dailyDone || dailyHint >= 2 || dailyHearts <= 0) return;
    const nextHint = dailyHint + 1;
    const nextHearts = Math.max(0, dailyHearts - 1);
    setDailyHint(nextHint);
    setDailyHearts(nextHearts);
    setSaved((previous) => ({ ...previous, heartsByDate: { ...previous.heartsByDate, [dailyKey]: nextHearts } }));
    setDailyMessage(nextHint === 1
      ? "Посмотри на фигуру на поле " + dailyPuzzle.moves[dailyIndex].slice(0, 2) + ". Какая у неё роль в позиции?"
      : "Первый ход: " + dailyPuzzle.moves[dailyIndex].slice(0, 2) + "–" + dailyPuzzle.moves[dailyIndex].slice(2, 4) + ". Теперь найди продолжение самостоятельно.");
  };

  const filteredCustom = useMemo(() => bank.filter((puzzle) => {
    const themeMatches = customTheme === "all" || puzzle.themes.includes(customTheme);
    const ratingMatches = customLevel === "all"
      || (customLevel === "beginner" && puzzle.rating < 1200)
      || (customLevel === "club" && puzzle.rating >= 1200 && puzzle.rating < 1800)
      || (customLevel === "advanced" && puzzle.rating >= 1800);
    return themeMatches && ratingMatches;
  }), [bank, customTheme, customLevel]);

  const chooseCustom = useCallback(() => {
    const next = randomItem(filteredCustom);
    setCustomPuzzle(next);
    setCustomFen(next?.fen ?? "");
    setCustomIndex(0);
    setCustomMessage(next ? "Найди лучший ход. Рейтинг не меняется — это чистая практика." : "По этому фильтру не нашлось задач. Выбери другую тему.");
  }, [filteredCustom]);

  useEffect(() => {
    if (bank.length) chooseCustom();
  }, [bank.length, customTheme, customLevel, chooseCustom]);

  const onCustomMove = useCallback((move: BoardMove): boolean => {
    if (!customPuzzle) return false;
    const result = advancePuzzle(customPuzzle, customFen, customIndex, move);
    if (!result) { setCustomMessage("Не совпало. Не спеши: рассмотри шахи, взятия и угрозы."); return false; }
    setCustomFen(result.fen);
    setCustomIndex(result.index);
    setCustomMessage(result.done ? "Задача решена. Отличная работа!" : "Верно. Ответ соперника сделан автоматически — продолжай.");
    if (result.done) setCustomSolved((value) => value + 1);
    return true;
  }, [customPuzzle, customFen, customIndex]);

  const beginRush = () => {
    const next = randomItem(bank);
    setRushPuzzle(next);
    setRushFen(next?.fen ?? "");
    setRushIndex(0);
    setRushScore(0);
    setRushMistakes(0);
    setRushTime(rushMode === "3m" ? 180 : rushMode === "5m" ? 300 : 0);
    setRushFinished(false);
    setRushRunning(!!next);
  };
  const onRushMove = useCallback((move: BoardMove): boolean => {
    if (!rushPuzzle || !rushRunning) return false;
    const result = advancePuzzle(rushPuzzle, rushFen, rushIndex, move);
    if (!result) {
      const nextMistakes = rushMistakes + 1;
      setRushMistakes(nextMistakes);
      if (nextMistakes >= 3) { setRushRunning(false); setRushFinished(true); }
      return false;
    }
    setRushFen(result.fen);
    setRushIndex(result.index);
    if (result.done) {
      setRushScore((value) => value + 1);
      const next = randomItem(bank.filter((puzzle) => puzzle.id !== rushPuzzle.id)) ?? randomItem(bank);
      setRushPuzzle(next);
      setRushFen(next?.fen ?? "");
      setRushIndex(0);
    }
    return true;
  }, [rushPuzzle, rushRunning, rushFen, rushIndex, rushMistakes, bank]);

  useEffect(() => {
    if (!rushRunning || rushMode === "survival") return;
    const timer = window.setInterval(() => {
      setRushTime((seconds) => {
        if (seconds <= 1) { setRushRunning(false); setRushFinished(true); return 0; }
        return seconds - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [rushRunning, rushMode]);

  useEffect(() => {
    if (!rushFinished) return;
    setSaved((previous) => {
      const best = Math.max(previous.rushBest[rushMode] ?? 0, rushScore);
      const next = { ...previous, rushBest: { ...previous.rushBest, [rushMode]: best } };
      saveProgress(next);
      return next;
    });
  }, [rushFinished]);

  const shareDailyResult = async () => {
    const result = [
      "CHESSMART · Ежедневная задача",
      dateLabel,
      "Результат: решено",
      "Осталось сердец: " + dailyHearts + "/5",
      "Серия: " + dailyStreak + " дн.",
      window.location.origin,
    ].join("\\n");
    try {
      await navigator.clipboard.writeText(result);
      setDailyMessage("Результат скопирован. Отправляй друзьям и сравнивайте серию!");
    } catch {
      setDailyMessage(result);
    }
  };
  const customThemeLabel = THEMES.find(([id]) => id === customTheme)?.[1] ?? "Все темы";
  const dateLabel = dailyDate.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="min-h-screen bg-[#1d241d] p-4 text-[#edf3e8] sm:p-7">
      <div className="mx-auto max-w-[1320px]">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[.2em] text-[#a8d17a]">CHESSMART TRAINING CLUB</div>
            <h1 className="mt-1 text-2xl font-black sm:text-3xl">Тренируйся каждый день</h1>
            <p className="mt-1 max-w-2xl text-sm text-[#a8b5a0]">Ежедневная тактика, скоростные серии и практика по слабым темам. Всё открыто, без лимитов и подписки.</p>
          </div>
          <button onClick={onBack} className="rounded-xl border border-[#52634b] bg-[#293429] px-4 py-2.5 text-xs font-bold hover:bg-[#344232]">← Назад</button>
        </header>

        <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-2xl border border-[#45543d] bg-gradient-to-br from-[#31432d] to-[#222e22] p-4">
            <div className="text-[9px] font-black uppercase tracking-widest text-[#a6c48c]">Дневная серия</div>
            <div className="mt-2 text-3xl font-black tabular-nums">{dailyStreak} <span className="text-sm text-[#a2b394]">дн.</span></div>
            <div className="mt-1 text-[10px] text-[#a0ae96]">Задачи без пропусков</div>
          </div>
          <div className="rounded-2xl border border-white/[.07] bg-[#263026] p-4">
            <div className="text-[9px] font-black uppercase tracking-widest text-[#91a184]">Решено ежедневно</div>
            <div className="mt-2 text-3xl font-black tabular-nums">{saved.completedDates.length}</div>
            <div className="mt-1 text-[10px] text-[#91a184]">Сохранено локально</div>
          </div>
          <div className="rounded-2xl border border-white/[.07] bg-[#263026] p-4">
            <div className="text-[9px] font-black uppercase tracking-widest text-[#91a184]">Лучший Rush · 3 мин</div>
            <div className="mt-2 text-3xl font-black tabular-nums">{saved.rushBest["3m"]}</div>
            <div className="mt-1 text-[10px] text-[#91a184]">Задач за раунд</div>
          </div>
          <div className="rounded-2xl border border-white/[.07] bg-[#263026] p-4">
            <div className="text-[9px] font-black uppercase tracking-widest text-[#91a184]">Лучший Rush · 5 мин</div>
            <div className="mt-2 text-3xl font-black tabular-nums">{saved.rushBest["5m"]}</div>
            <div className="mt-1 text-[10px] text-[#91a184]">Задач за раунд</div>
          </div>
        </section>

        <div className="mb-5 flex flex-wrap gap-2 rounded-2xl border border-white/[.07] bg-[#202a20] p-2">
          {([
            ["daily", "Задача дня"], ["rush", "Puzzle Rush"], ["custom", "Своя тренировка"],
          ] as Array<[Tab, string]>).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={"rounded-xl px-4 py-2.5 text-xs font-extrabold transition " + (tab === id ? "bg-[#9bc96e] text-[#182315] shadow-lg" : "text-[#acb9a4] hover:bg-white/[.06] hover:text-white")}>{label}</button>
          ))}
          <span className="ml-auto self-center px-3 text-[10px] font-bold text-[#71806b]">{bank.length ? bank.length.toLocaleString("ru-RU") + " задач" : "База загружается"}</span>
        </div>

        {loading && (
          <section className="rounded-2xl border border-white/[.08] bg-[#263026] p-5">
            <div className="flex items-center justify-between text-xs font-bold"><span>Подготавливаем тактическую базу</span><span className="tabular-nums text-[#9bc96e]">{loaded.toLocaleString("ru-RU")} / 3 500</span></div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#172017]"><div className="h-full rounded-full bg-[#9bc96e] transition-all" style={{ width: Math.min(100, loaded / 3500 * 100) + "%" }} /></div>
            <p className="mt-2 text-[10px] text-[#879582]">Позиции проверяются на легальность, а затем кэшируются в браузере.</p>
          </section>
        )}
        {error && <section className="rounded-2xl border border-[#87534a] bg-[#402a27] p-4 text-sm text-[#ffd1c9]"><b>Не удалось загрузить задачи</b><p className="mt-1 text-xs">{error}</p><button onClick={() => window.location.reload()} className="mt-3 rounded-lg bg-[#f0f4ea] px-3 py-2 text-xs font-bold text-[#1c2818]">Повторить</button></section>}

        {!loading && !error && tab === "daily" && dailyPuzzle && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="rounded-3xl border border-[#44553c] bg-gradient-to-br from-[#2b3a29] via-[#263326] to-[#202a20] p-4 sm:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[9px] font-black uppercase tracking-[.2em] text-[#a8ca89]">DAILY CHALLENGE</div>
                  <h2 className="mt-1 text-xl font-black sm:text-2xl">Задача дня</h2>
                  <div className="mt-1 text-xs capitalize text-[#a4b39a]">{dateLabel} · {difficultyLabels[dailyWeekday]}</div>
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-white/[.08] bg-black/15 px-3 py-2">
                  <span className="text-[9px] font-extrabold uppercase text-[#9eae93]">Жизни</span>
                  <span className="text-lg tracking-[.12em] text-[#f0bd76]">{Array.from({ length: 5 }, (_, index) => index < dailyHearts ? "♥" : "♡").join(" ")}</span>
                  {dailyDone && <button onClick={shareDailyResult} className="ml-2 rounded-lg bg-[#a5cf78] px-3 py-2 text-[10px] font-black text-[#172315] hover:bg-[#b8e28e]">Поделиться</button>}
                </div>
              </div>
              <div className="mb-4 flex items-center justify-between gap-2 rounded-xl border border-white/[.06] bg-black/[.12] p-2">
                <button disabled={dailyOffset <= -365} onClick={() => setDailyOffset((value) => Math.max(-365, value - 1))} className="rounded-lg bg-white/[.06] px-3 py-2 text-xs font-bold disabled:opacity-30">← Предыдущая</button>
                <span className="text-[10px] font-bold text-[#9da992]">{dailyOffset === 0 ? "Сегодня" : Math.abs(dailyOffset) + " дн. назад"}</span>
                <button disabled={dailyOffset >= 0} onClick={() => setDailyOffset((value) => Math.min(0, value + 1))} className="rounded-lg bg-white/[.06] px-3 py-2 text-xs font-bold disabled:opacity-30">Следующая →</button>
              </div>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="min-w-0">
                  <GameBoard fen={dailyFen || dailyPuzzle.fen} orientation={dailyPuzzle.color === "w" ? "white" : "black"} interactive={!dailyDone} allowedColor={dailyPuzzle.color} onMove={onDailyMove} extraSquareStyles={dailySquareStyles} />
                  <div className={"mt-3 rounded-xl border p-3 text-sm " + (dailyDone ? "border-[#668e4d] bg-[#30452a] text-[#d4f0b8]" : "border-white/[.08] bg-black/[.14] text-[#d4dfcd]")}>{dailyMessage}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={useDailyHint} disabled={dailyDone || dailyHint >= 2 || dailyHearts <= 0} className="rounded-xl border border-[#708d5a] bg-[#3a5032] px-4 py-2.5 text-xs font-extrabold text-[#e4f3d7] hover:bg-[#49653c] disabled:opacity-35">Подсказка · −1 ♥</button>
                    <span className="self-center text-[10px] text-[#82917a]">{dailyDone ? "Задача выполнена" : dailyHearts === 0 ? "Сердца закончились — продолжай без подсказок" : "Ошибки и подсказки расходуют сердца"}</span>
                  </div>
                </div>
                <aside className="space-y-3">
                  <div className="rounded-2xl border border-white/[.07] bg-[#1c281c] p-4">
                    <div className="text-[9px] font-black uppercase tracking-widest text-[#8fa17f]">Задание</div>
                    <div className="mt-2 text-lg font-black">{dailyPuzzle.color === "w" ? "Белые ходят" : "Чёрные ходят"}</div>
                    <p className="mt-2 text-xs leading-relaxed text-[#a5b29a]">Найди точную комбинацию и доведи её до конца. После твоего хода ответ соперника появится автоматически.</p>
                    {dailyHint === 2 && dailyCurrentMove && <div className="mt-3 rounded-lg bg-[#35482d] p-2 text-xs font-bold text-[#d7edc3]">Текущий ход: {dailyCurrentMove.slice(0, 2)}–{dailyCurrentMove.slice(2, 4)}</div>}
                  </div>
                  <div className="rounded-2xl border border-white/[.07] bg-[#1c281c] p-4">
                    <div className="text-[9px] font-black uppercase tracking-widest text-[#8fa17f]">Твоя серия</div>
                    <div className="mt-1 text-3xl font-black text-[#cdeaa9]">{dailyStreak} <span className="text-sm text-[#8fa17f]">дней</span></div>
                    <div className="mt-2 text-xs text-[#98a68f]">Задача считается выполненной после всей комбинации, а не после одного угаданного хода.</div>
                  </div>
                  <div className="rounded-2xl border border-white/[.07] bg-[#1c281c] p-4">
                    <div className="text-[9px] font-black uppercase tracking-widest text-[#8fa17f]">Настройки</div>
                    <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-[#aebda4]">
                      <input type="checkbox" checked={saved.hardMode} onChange={(event) => setSaved((previous) => ({ ...previous, hardMode: event.target.checked }))} className="mt-0.5 accent-[#9bc96e]" />
                      <span><b className="text-[#e0ead8]">Сложный режим</b><br />Без автоматических подсказок тренера при ошибках</span>
                    </label>
                  </div>
                  <div className="rounded-2xl border border-white/[.07] bg-[#1c281c] p-4">
                    <div className="text-[9px] font-black uppercase tracking-widest text-[#8fa17f]">Архив</div>
                    <p className="mt-2 text-xs leading-relaxed text-[#98a68f]">Можно вернуться к любой задаче за последний год. История решённых дней хранится в этом браузере.</p>
                    <div className="mt-3 grid grid-cols-7 gap-1">
                      {Array.from({ length: 14 }, (_, index) => {
                        const offset = -13 + index;
                        const date = new Date();
                        date.setDate(date.getDate() + offset);
                        const key = dayKey(date);
                        const active = offset === dailyOffset;
                        const complete = saved.completedDates.includes(key);
                        return <button key={key} onClick={() => setDailyOffset(offset)} title={date.toLocaleDateString("ru-RU")} className={"aspect-square rounded-md text-[9px] font-bold " + (active ? "bg-[#a1ce75] text-[#172415]" : complete ? "bg-[#536f42] text-white" : "bg-white/[.06] text-[#8e9c84] hover:bg-white/[.12]")}>{date.getDate()}</button>;
                      })}
                    </div>
                    <div className="mt-2 text-[9px] text-[#75836d]">Зелёный — решено · светлый — выбранный день</div>
                  </div>
                </aside>
              </div>
            </section>
          </div>
        )}

        {!loading && !error && tab === "rush" && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="rounded-3xl border border-[#40513a] bg-gradient-to-br from-[#2b3928] to-[#202a20] p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><div className="text-[9px] font-black uppercase tracking-[.2em] text-[#a8ca89]">SPEED TACTICS</div><h2 className="mt-1 text-2xl font-black">Puzzle Rush</h2><p className="mt-1 text-xs text-[#9eae93]">Решай максимум задач. Три ошибки — и раунд окончен.</p></div>
                <div className="rounded-2xl border border-white/[.08] bg-black/20 px-4 py-2 text-center"><div className="text-3xl font-black tabular-nums">{rushMode === "survival" ? "∞" : formatTime(rushTime)}</div><div className="text-[9px] font-bold uppercase text-[#91a083]">Время</div></div>
              </div>
              <div className="my-4 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-black/[.16] p-3"><div className="text-2xl font-black tabular-nums">{rushScore}</div><div className="text-[9px] font-bold uppercase text-[#91a083]">Решено</div></div>
                <div className="rounded-xl bg-black/[.16] p-3"><div className="text-2xl font-black tabular-nums">{rushMistakes}/3</div><div className="text-[9px] font-bold uppercase text-[#91a083]">Ошибки</div></div>
                <div className="rounded-xl bg-black/[.16] p-3"><div className="text-2xl font-black tabular-nums">{saved.rushBest[rushMode]}</div><div className="text-[9px] font-bold uppercase text-[#91a083]">Рекорд</div></div>
              </div>
              {rushPuzzle && <div className="mx-auto max-w-[720px]"><GameBoard fen={rushFen || rushPuzzle.fen} orientation={rushPuzzle.color === "w" ? "white" : "black"} interactive={rushRunning} allowedColor={rushPuzzle.color} onMove={onRushMove} /></div>}
              {rushFinished && <div className="mt-4 rounded-2xl border border-[#718e55] bg-[#30442b] p-4"><div className="text-lg font-black text-[#d7edc3]">Раунд завершён</div><div className="mt-1 text-sm text-[#c1d8af]">Решено: {rushScore} · Ошибки: {rushMistakes} · Рекорд: {Math.max(saved.rushBest[rushMode], rushScore)}</div><p className="mt-1 text-[10px] text-[#9eb48c]">{rushMode === "survival" ? "Выживание заканчивается после трёх ошибок." : "Время вышло или закончились попытки."}</p></div>}
              {!rushRunning && !rushFinished && <div className="mt-4 rounded-xl border border-dashed border-white/[.12] p-8 text-center text-sm text-[#a1ad98]">Выбери режим справа и нажми «Старт».</div>}
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={beginRush} disabled={!bank.length} className="rounded-xl bg-[#9bc96e] px-5 py-3 text-sm font-black text-[#182315] hover:bg-[#b0db84] disabled:opacity-40">{rushFinished || rushRunning ? "Начать заново" : "Старт"}</button>
                {rushRunning && <button onClick={() => { setRushRunning(false); setRushFinished(true); }} className="rounded-xl border border-white/[.12] px-4 py-3 text-xs font-bold text-[#c3cebb]">Завершить раунд</button>}
              </div>
            </section>
            <aside className="space-y-3">
              <section className="rounded-2xl border border-white/[.07] bg-[#263026] p-4">
                <div className="text-sm font-black">Выбери режим</div>
                <div className="mt-3 space-y-2">
                  {([
                    ["3m", "3 минуты", "Быстрый спринт"],
                    ["5m", "5 минут", "Длинный раунд"],
                    ["survival", "Выживание", "Без таймера"],
                  ] as Array<[RushMode, string, string]>).map(([id, label, desc]) => <button key={id} onClick={() => { setRushMode(id); setRushRunning(false); setRushFinished(false); setRushPuzzle(null); setRushTime(id === "3m" ? 180 : id === "5m" ? 300 : 0); }} className={"w-full rounded-xl border p-3 text-left " + (rushMode === id ? "border-[#9bc96e] bg-[#354a2d]" : "border-white/[.07] bg-[#1d281d] hover:bg-[#2d3a2b]")}><div className="text-xs font-extrabold">{label}</div><div className="mt-1 text-[10px] text-[#9eaa96]">{desc}</div></button>)}
                </div>
                <div className="mt-3 rounded-lg bg-[#1d281d] p-3 text-xs text-[#9eaa96]">Рейтинг задач не меняется. Тренируй скорость и точность без риска потерять Elo.</div>
              </section>
            </aside>
          </div>
        )}

        {!loading && !error && tab === "custom" && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
            <section className="rounded-3xl border border-[#40513a] bg-gradient-to-br from-[#2b3928] to-[#202a20] p-4 sm:p-6">
              <div className="mb-4"><div className="text-[9px] font-black uppercase tracking-[.2em] text-[#a8ca89]">FOCUSED PRACTICE</div><h2 className="mt-1 text-2xl font-black">Тренируй конкретный навык</h2><p className="mt-1 text-xs text-[#9eae93]">Выбирай тему и уровень. Никаких ограничений по количеству задач.</p></div>
              {customPuzzle ? <div className="mx-auto max-w-[720px]"><GameBoard fen={customFen || customPuzzle.fen} orientation={customPuzzle.color === "w" ? "white" : "black"} interactive={customIndex < customPuzzle.moves.length} allowedColor={customPuzzle.color} onMove={onCustomMove} /></div> : <div className="rounded-xl bg-black/15 p-8 text-center text-sm text-[#9eaa96]">Нет задач по выбранным фильтрам.</div>}
              <div className="mt-4 rounded-xl border border-white/[.08] bg-black/[.14] p-3 text-sm text-[#d1deca]">{customMessage}</div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-[#96a58c]">Решено в этой сессии: <b className="text-white">{customSolved}</b></span><button onClick={chooseCustom} disabled={!filteredCustom.length} className="rounded-xl bg-[#9bc96e] px-4 py-2.5 text-xs font-black text-[#182315] disabled:opacity-40">Следующая задача →</button></div>
            </section>
            <aside className="space-y-3">
              <section className="rounded-2xl border border-white/[.07] bg-[#263026] p-4">
                <div className="text-sm font-black">Фильтры</div>
                <label className="mt-3 block text-[10px] font-bold text-[#9eaa96]">ТЕМА<select value={customTheme} onChange={(event) => setCustomTheme(event.target.value)} className="mt-1 w-full rounded-lg border border-white/[.12] bg-[#1b261b] px-3 py-2.5 text-xs text-white"><option value="all">Все темы</option>{THEMES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
                <label className="mt-3 block text-[10px] font-bold text-[#9eaa96]">СЛОЖНОСТЬ<select value={customLevel} onChange={(event) => setCustomLevel(event.target.value)} className="mt-1 w-full rounded-lg border border-white/[.12] bg-[#1b261b] px-3 py-2.5 text-xs text-white"><option value="all">Все уровни</option><option value="beginner">Начинающий · до 1200</option><option value="club">Клубный · 1200–1800</option><option value="advanced">Продвинутый · 1800+</option></select></label>
                <div className="mt-3 rounded-xl bg-[#1d281d] p-3"><div className="text-2xl font-black">{filteredCustom.length.toLocaleString("ru-RU")}</div><div className="text-[10px] text-[#9eaa96]">Задач доступно · {customThemeLabel}</div></div>
              </section>
            </aside>
          </div>
        )}
        {!loading && !error && !bank.length && <div className="rounded-xl border border-[#80564b] bg-[#402b27] p-4 text-sm text-[#ffd1c9]">База задач пуста. Попробуй обновить страницу.</div>}
      </div>
    </div>
  );
}
