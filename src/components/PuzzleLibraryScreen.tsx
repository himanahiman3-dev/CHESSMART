import { useCallback, useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import type { PlayerProfile, PuzzleRatingEntry } from "../lib/playerProfile";
import { GameBoard, type BoardMove } from "./GameBoard";
import { playSound, soundForSan } from "../lib/sound";

interface Puzzle {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  themes: string[];
  color: "w" | "b";
}
interface PuzzleStats {
  rating: number;
  solved: string[];
  attempts: number;
  correct: number;
  streak: number;
  lastDaily: string;
}
type Mode = "rated" | "daily" | "themes";
type Mission = "mixed" | "mate1" | "mate2" | "mate3" | "punish" | "fork" | "defend" | "hanging";
type Difficulty = "easy" | "medium" | "all";

const MISSIONS: Array<{ id: Mission; label: string; themes: string[]; prompt: string }> = [
  { id: "mixed", label: "Смешанная тактика", themes: [], prompt: "Найди лучший тактический ход" },
  { id: "mate1", label: "Мат в 1", themes: ["mateIn1"], prompt: "Поставь мат в один ход" },
  { id: "mate2", label: "Мат в 2", themes: ["mateIn2"], prompt: "Найди форсированный мат в два хода" },
  { id: "mate3", label: "Мат в 3", themes: ["mateIn3"], prompt: "Рассчитай матовую комбинацию в три хода" },
  { id: "punish", label: "Накажи зевок", themes: ["crushing", "hangingPiece", "trappedPiece"], prompt: "Соперник ошибся. Найди удар и используй его ошибку" },
  { id: "fork", label: "Вилка", themes: ["fork"], prompt: "Найди шахматную вилку" },
  { id: "defend", label: "Защита", themes: ["defensiveMove"], prompt: "Найди лучший защитительный ход" },
  { id: "hanging", label: "Выиграй фигуру", themes: ["hangingPiece", "skewer", "pin"], prompt: "Найди тактику, которая выигрывает материал" },
];

const DATASET = "Lichess/chess-puzzles";
const CACHE_KEY = "chessmart:puzzle-bank:3500:v1";
const STATS_KEY = "chessmart:puzzle-stats:v1";
const PAGE_SIZE = 100;
const TARGET = 3500;
const EMPTY_STATS: PuzzleStats = { rating: 1200, solved: [], attempts: 0, correct: 0, streak: 0, lastDaily: "" };
const THEME_LABELS: Record<string, string> = {
  mateIn1: "Мат в 1", mateIn2: "Мат в 2", mateIn3: "Мат в 3", mate: "Мат",
  fork: "Вилка", pin: "Связка", skewer: "Шпажка", doubleCheck: "Двойной шах",
  discoveredAttack: "Вскрытое нападение", hangingPiece: "Подвешенная фигура", sacrifice: "Жертва",
  deflection: "Отвлечение", attraction: "Завлечение", promotion: "Превращение",
  backRankMate: "Мат на последней горизонтали", crushing: "Решающий перевес", endgame: "Эндшпиль",
  middlegame: "Миттельшпиль", opening: "Дебют", advancedPawn: "Проходная пешка",
  trappedPiece: "Запертая фигура", interference: "Перекрытие", clearance: "Освобождение линии",
  defensiveMove: "Защитительный ход", quietMove: "Тихий ход", underPromotion: "Недопревращение",
};

function readStats(): PuzzleStats {
  try {
    const value = JSON.parse(localStorage.getItem(STATS_KEY) ?? "null") as Partial<PuzzleStats> | null;
    return { ...EMPTY_STATS, ...value, solved: Array.isArray(value?.solved) ? value.solved : [] };
  } catch { return EMPTY_STATS; }
}
function saveStats(stats: PuzzleStats) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify({ ...stats, solved: stats.solved.slice(-5000) })); } catch { /* storage is optional */ }
}
function validPuzzle(row: Record<string, unknown>): Puzzle | null {
  const id = String(row.PuzzleId ?? "");
  const fen = String(row.FEN ?? "");
  const moves = String(row.Moves ?? "").trim().split(/\s+/).filter(Boolean);
  const rating = Number(row.Rating);
  const themes = Array.isArray(row.Themes) ? row.Themes.map(String) : String(row.Themes ?? "").split(/\s+/).filter(Boolean);
  if (!id || !fen || moves.length < 2 || !Number.isFinite(rating)) return null;
  try {
    const chess = new Chess(fen);
    // В Lichess CSV первый ход — обязательный ход соперника до начала задачи.
    const first = moves[0];
    chess.move({ from: first.slice(0, 2) as never, to: first.slice(2, 4) as never, promotion: first[4] as never });
    const startFen = chess.fen();
    const color = chess.turn();
    for (const uci of moves.slice(1)) {
      chess.move({ from: uci.slice(0, 2) as never, to: uci.slice(2, 4) as never, promotion: uci[4] as never });
    }
    return { id, fen: startFen, moves: moves.slice(1), rating: Math.round(rating), themes, color };
  } catch { return null; }
}
async function fetchPage(offset: number, signal: AbortSignal): Promise<Puzzle[]> {
  const url = new URL("https://datasets-server.huggingface.co/rows");
  url.searchParams.set("dataset", DATASET);
  url.searchParams.set("config", "default");
  url.searchParams.set("split", "train");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("length", String(PAGE_SIZE));
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if (response.ok) break;
    if (response.status !== 429 && response.status < 500) throw new Error("База задач вернула HTTP " + response.status);
    await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)));
  }
  if (!response?.ok) throw new Error("Сервер базы задач временно недоступен. Попробуй ещё раз.");
  const payload = await response.json() as { rows?: Array<{ row?: Record<string, unknown> }> };
  return (payload.rows ?? []).map((item) => validPuzzle(item.row ?? {})).filter((item): item is Puzzle => !!item);
}
async function loadPuzzleBank(signal: AbortSignal, onProgress: (count: number) => void): Promise<Puzzle[]> {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as Puzzle[] | null;
    if (Array.isArray(cached) && cached.length >= TARGET) return cached.slice(0, TARGET);
  } catch { /* ignore stale cache */ }

  const found = new Map<string, Puzzle>();
  // Берём столько страниц, сколько нужно для 3 000 именно легальных задач, а не просто CSV-строк.
  const maxRawRows = TARGET * 8;
  for (let offset = 0; found.size < TARGET && offset < maxRawRows; offset += PAGE_SIZE * 4) {
    const offsets = [offset, offset + PAGE_SIZE, offset + PAGE_SIZE * 2, offset + PAGE_SIZE * 3];
    const batch = await Promise.all(offsets.map((pageOffset) => fetchPage(pageOffset, signal)));
    let emptyPages = 0;
    for (const page of batch) {
      if (page.length === 0) emptyPages++;
      for (const puzzle of page) if (!found.has(puzzle.id)) found.set(puzzle.id, puzzle);
    }
    onProgress(Math.min(TARGET, found.size));
    if (emptyPages === batch.length) break;
  }

  const bank = [...found.values()].slice(0, TARGET);
  if (bank.length < TARGET) {
    throw new Error("Удалось проверить только " + bank.length + " из " + TARGET + " задач. Повтори загрузку, чтобы добрать полный набор.");
  }
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(bank)); } catch { /* continue without cache */ }
  return bank;
}
function localDateKey(date = new Date()): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

interface Props {
  onBack: () => void;
  profile: PlayerProfile;
  onChange: (profile: PlayerProfile) => void;
}

export function PuzzleLibraryScreen({ onBack, profile, onChange }: Props) {
  const [bank, setBank] = useState<Puzzle[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<PuzzleStats>(readStats);
  const [mode, setMode] = useState<Mode>("rated");
  const [mission, setMission] = useState<Mission>("mixed");
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [theme, setTheme] = useState("fork");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [position, setPosition] = useState("");
  const [solutionIndex, setSolutionIndex] = useState(0);
  const [feedback, setFeedback] = useState<"idle" | "wrong" | "solved" | "revealed">("idle");
  const [hint, setHint] = useState(false);
  const [rushCount, setRushCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    loadPuzzleBank(controller.signal, setProgress)
      .then((items) => {
        setBank(items);
        setSelectedId(items[0]?.id ?? "");
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => saveStats(stats), [stats]);

  // Keep the legacy puzzle-bank rating while moving new snapshots into the portable profile.
  useEffect(() => {
    if (profile.puzzleRatingHistory.length > 0) {
      if (stats.rating !== profile.puzzleRating) {
        setStats((previous) => ({ ...previous, rating: profile.puzzleRating }));
      }
    } else if (stats.rating !== profile.puzzleRating) {
      onChange({ ...profile, puzzleRating: stats.rating });
    }
    // This is a one-time migration on screen entry; later writes use the latest props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dailyId = useMemo(() => {
    if (!bank.length) return "";
    const day = Math.floor(new Date().setHours(0, 0, 0, 0) / 86400000);
    return bank[day % bank.length]?.id ?? "";
  }, [bank]);
  const filtered = useMemo(() => {
    let items = bank;
    if (mode === "daily") items = bank.filter((p) => p.id === dailyId);
    if (mission !== "mixed") {
      const selectedMission = MISSIONS.find((item) => item.id === mission);
      const tags = selectedMission?.themes ?? [];
      items = items.filter((p) => tags.some((tag) => p.themes.includes(tag)));
    }
    if (difficulty === "easy") items = items.filter((p) => p.rating <= 1200);
    if (difficulty === "medium") items = items.filter((p) => p.rating > 1200 && p.rating <= 1800);
    if (mode === "themes") items = items.filter((p) => p.themes.includes(theme));
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      items = items.filter((p) => p.id.toLowerCase().includes(q) || String(p.rating).includes(q) || p.themes.some((t) => t.toLowerCase().includes(q)));
    }
    return items;
  }, [bank, mode, dailyId, theme, mission, difficulty, query]);
  const current = useMemo(() => filtered.find((p) => p.id === selectedId) ?? filtered[0] ?? null, [filtered, selectedId]);
  const today = localDateKey();
  const dailyDone = stats.lastDaily === today;
  // Ежедневная задача имеет собственный статус: решение той же позиции в обычной тренировке не должно блокировать daily streak.
  const solved = mode === "daily" ? dailyDone : stats.solved.includes(current?.id ?? "");
  const playerMove = current?.moves[solutionIndex] ?? "";
  const currentThemes = current?.themes ?? [];
  const currentMission = MISSIONS.find((item) => item.id === mission) ?? MISSIONS[0];

  useEffect(() => {
    if (!current) { setPosition(""); return; }
    setPosition(current.fen);
    setSolutionIndex(0);
    setFeedback(mode === "daily"
      ? (stats.lastDaily === localDateKey() ? "solved" : "idle")
      : (stats.solved.includes(current.id) ? "solved" : "idle"));
    setHint(false);
  }, [current?.id, current?.fen, mode]);

  const selectPuzzle = useCallback((puzzle: Puzzle) => {
    setSelectedId(puzzle.id);
    setPosition(puzzle.fen);
    setSolutionIndex(0);
    setFeedback(mode === "daily"
      ? (stats.lastDaily === localDateKey() ? "solved" : "idle")
      : (stats.solved.includes(puzzle.id) ? "solved" : "idle"));
    setHint(false);
  }, [mode, stats.lastDaily, stats.solved]);

  const finishPuzzle = useCallback((puzzle: Puzzle, wasRevealed: boolean) => {
    const alreadySolved = stats.solved.includes(puzzle.id);
    const nextRating = Math.max(400, Math.min(3200, Math.round(stats.rating + 24 * ((wasRevealed ? 0 : 1) - expectedScore(stats.rating, puzzle.rating)))));
    const completedAt = Date.now();
    const today = localDateKey(new Date(completedAt));
    const now = new Date(completedAt);
    const yesterday = localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    const ratingAfter = alreadySolved ? stats.rating : nextRating;
    const ratingEntry: PuzzleRatingEntry = {
      at: completedAt,
      puzzleId: puzzle.id,
      mode,
      solved: !wasRevealed,
      change: ratingAfter - stats.rating,
      ratingAfter,
    };
    onChange({
      ...profile,
      puzzleRating: ratingAfter,
      puzzleRatingHistory: [...profile.puzzleRatingHistory, ratingEntry].slice(-180),
    });
    setStats((previous) => {
      const completedDailyToday = mode === "daily" && !wasRevealed && previous.lastDaily !== today;
      const nextDailyStreak = previous.lastDaily === yesterday ? previous.streak + 1 : 1;
      return {
        ...previous,
        rating: alreadySolved ? previous.rating : nextRating,
        solved: alreadySolved ? previous.solved : [...previous.solved, puzzle.id],
        attempts: previous.attempts + 1,
        correct: previous.correct + (wasRevealed ? 0 : 1),
        streak: mode === "daily"
          ? (completedDailyToday ? nextDailyStreak : previous.streak)
          : (wasRevealed ? 0 : previous.streak + 1),
        lastDaily: completedDailyToday ? today : previous.lastDaily,
      };
    });
    if (mode === "rated" && !wasRevealed) setRushCount((value) => value + 1);
    setFeedback(wasRevealed ? "revealed" : "solved");
  }, [stats.solved, stats.rating, stats.lastDaily, mode, profile, onChange]);

  const handleMove = useCallback((move: BoardMove): boolean => {
    if (!current || feedback === "solved" || feedback === "revealed" || !playerMove) return false;
    if (move.uci !== playerMove) {
      playSound("wrong");
      setFeedback("wrong");
      setStats((previous) => ({ ...previous, attempts: previous.attempts + 1, streak: 0 }));
      return false;
    }
    try {
      const chess = new Chess(position);
      const played = chess.move({ from: move.from as never, to: move.to as never, promotion: (move.uci[4] ?? "q") as never });
      if (played) playSound(soundForSan(played.san));
      let nextIndex = solutionIndex + 1;
      // Ответный ход из решения Lichess автоматически проигрывается приложением.
      if (current.moves[nextIndex]) {
        const reply = current.moves[nextIndex];
        const replyPlayed = chess.move({ from: reply.slice(0, 2) as never, to: reply.slice(2, 4) as never, promotion: (reply[4] ?? "q") as never });
        if (replyPlayed) playSound(soundForSan(replyPlayed.san, chess.isGameOver(), undefined, "opponent"));
        nextIndex++;
      }
      setPosition(chess.fen());
      setSolutionIndex(nextIndex);
      if (nextIndex >= current.moves.length) finishPuzzle(current, false);
      else setFeedback("idle");
      return true;
    } catch {
      return false;
    }
  }, [current, feedback, playerMove, position, solutionIndex, finishPuzzle]);

  const skipPuzzle = () => {
    if (!current || !filtered.length) return;
    const index = filtered.findIndex((p) => p.id === current.id);
    const next = filtered[(index + 1) % filtered.length];
    if (next) selectPuzzle(next);
  };
  const showAnswer = () => {
    if (!current) return;
    setHint(true);
    setFeedback("revealed");
    const at = Date.now();
    const ratingEntry: PuzzleRatingEntry = {
      at,
      puzzleId: current.id,
      mode,
      solved: false,
      change: 0,
      ratingAfter: stats.rating,
    };
    onChange({
      ...profile,
      puzzleRating: stats.rating,
      puzzleRatingHistory: [...profile.puzzleRatingHistory, ratingEntry].slice(-180),
    });
    setStats((previous) => ({ ...previous, attempts: previous.attempts + 1 }));
  };
  const isConfigured = bank.length > 0;

  return (
    <div className="min-h-screen bg-[#262522] p-4 text-[#f0f0ed] sm:p-7">
      <div className="mx-auto max-w-[1240px]">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#a3c86d]">Chessmart training</p>
            <h1 className="mt-1 text-2xl font-extrabold">Шахматные задачи</h1>
            <p className="mt-1 text-sm text-[#a6a59f]">Матовые комбинации, наказание зевков и простая тактика</p>
          </div>
          <button onClick={onBack} className="rounded-lg border border-[#474640] bg-[#33322e] px-4 py-2 text-sm font-bold hover:bg-[#3d3c36]">Назад</button>
        </header>

        <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Рейтинг задач", String(stats.rating), "Локальный puzzle rating"],
            ["Решено", String(stats.solved.length), "Уникальных позиций"],
            ["Точность", (stats.attempts ? Math.round(stats.correct / stats.attempts * 100) : 0) + "%", "Верные решения"],
            ["Серия", String(stats.streak), "Подряд без подсказки"],
          ].map(([label, value, sub]) => (
            <div key={label} className="rounded-xl border border-[#41403a] bg-[#30302b] p-3">
              <div className="text-[11px] font-semibold text-[#aaa9a2]">{label}</div>
              <div className="mt-1 text-2xl font-black tabular-nums">{value}</div>
              <div className="mt-0.5 text-[10px] text-[#77766f]">{sub}</div>
            </div>
          ))}
        </section>

        <div className="mb-4 flex flex-wrap gap-2">
          {([
            ["rated", "Тренировка"],
            ["daily", "Задача дня"],
            ["themes", "Все темы"],
          ] as const).map(([id, label]) => (
            <button key={id} onClick={() => { setMode(id); setQuery(""); }} className={"rounded-lg px-4 py-2 text-sm font-bold " + (mode === id ? "bg-[#81b64c] text-[#17210f]" : "border border-[#41403a] bg-[#30302b] text-[#d2d1cb] hover:bg-[#3b3a34]")}>{label}</button>
          ))}
          <div className="ml-auto flex items-center gap-2 rounded-lg border border-[#41403a] bg-[#30302b] px-3 py-2 text-xs text-[#aaa9a2]">
            <span>Проверено</span><b className="text-white">{isConfigured ? bank.length.toLocaleString("ru-RU") + " задач" : "загрузка"}</b>
          </div>
        </div>
        <section className="mb-4 rounded-xl border border-[#41403a] bg-[#30302b] p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-extrabold uppercase tracking-wide text-[#aaa9a2]">Тип задания</div>
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)} className="rounded-md border border-[#4a4942] bg-[#242520] px-2.5 py-1.5 text-[10px] font-bold">
              <option value="easy">Лёгкие · до 1200</option>
              <option value="medium">Средние · 1200–1800</option>
              <option value="all">Любая сложность</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {MISSIONS.map((item) => <button key={item.id} onClick={() => { setMission(item.id); setMode("rated"); setQuery(""); }} className={"rounded-md px-3 py-2 text-[10px] font-bold " + (mission === item.id ? "bg-[#81b64c] text-[#17210f]" : "bg-[#22231f] text-[#cbc9c1] hover:bg-[#41423b]")}>{item.label}</button>)}
          </div>
        </section>

        {mode === "themes" && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <label className="text-xs font-semibold text-[#aaa9a2]" htmlFor="puzzle-theme">Тема</label>
            <select id="puzzle-theme" value={theme} onChange={(e) => setTheme(e.target.value)} className="rounded-lg border border-[#41403a] bg-[#30302b] px-3 py-2 text-sm">
              {Object.entries(THEME_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск: тема, ID или рейтинг" className="min-w-[220px] flex-1 rounded-lg border border-[#41403a] bg-[#30302b] px-3 py-2 text-sm outline-none focus:border-[#81b64c]" />
          </div>
        )}
        {mode === "rated" && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-[#41403a] bg-[#30302b] px-3 py-2">
            <span className="text-xs text-[#aaa9a2]">Режим решения · рейтинг меняется после каждой новой задачи</span>
            <span className="text-xs font-bold text-[#d7edbd]">Решено подряд: {rushCount}</span>
          </div>
        )}

        {loading && (
          <section className="mb-4 rounded-xl border border-[#41403a] bg-[#30302b] p-4">
            <div className="flex items-center justify-between text-sm"><b>Загружаем базу задач Lichess</b><span className="tabular-nums text-[#aaa9a2]">{progress.toLocaleString("ru-RU")} / {TARGET.toLocaleString("ru-RU")}</span></div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#1f201d]"><div className="h-full rounded-full bg-[#81b64c] transition-all" style={{ width: Math.min(100, progress / TARGET * 100) + "%" }} /></div>
            <p className="mt-2 text-xs text-[#8f8e87]">Позиции проверяются через chess.js и сохраняются в браузере для повторной игры без повторной загрузки.</p>
          </section>
        )}
        {error && (
          <section className="mb-4 rounded-xl border border-[#8c5049] bg-[#3e2926] p-4 text-sm text-[#ffd2cd]">
            <b>Не получилось загрузить задачи</b><p className="mt-1">{error}</p>
            <button onClick={() => window.location.reload()} className="mt-3 rounded-lg bg-[#f0f0ed] px-3 py-2 text-xs font-bold text-[#262522]">Повторить загрузку</button>
          </section>
        )}

        {!loading && current && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
            <section className="rounded-xl border border-[#41403a] bg-[#30302b] p-3 sm:p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div><div className="text-sm font-bold">{mission === "mixed" ? "Найди лучший ход" : currentMission.prompt}</div><div className="mt-0.5 text-xs text-[#93928b]">Играй за {current.color === "w" ? "белых" : "чёрных"} · {current.rating <= 1200 ? "лёгкая позиция" : current.rating <= 1800 ? "средняя позиция" : "сложная позиция"}</div></div>
                <div className="flex items-center gap-2 text-xs"><span className="rounded-md bg-[#22231f] px-2 py-1 text-[#c4c3bc]">{current.rating} puzzle rating</span><span className="rounded-md bg-[#22231f] px-2 py-1 text-[#c4c3bc]">{solved ? "Решена" : "Не решена"}</span></div>
              </div>
              <GameBoard fen={position || current.fen} orientation={current.color === "w" ? "white" : "black"} interactive={feedback !== "solved" && feedback !== "revealed" && !solved} allowedColor={current.color} onMove={handleMove} />
              <div className={"mt-3 rounded-lg border p-3 text-sm " + (feedback === "solved" || solved ? "border-[#557b3d] bg-[#293a25] text-[#d7edbd]" : feedback === "wrong" ? "border-[#81504a] bg-[#402b28] text-[#ffd2cd]" : "border-[#45443e] bg-[#272823] text-[#d6d5ce]")}>
                {feedback === "solved" || solved ? "Верно. Отличный расчёт — задача засчитана." : feedback === "revealed" ? "Решение: " + current.moves.map((m) => m.slice(0, 2) + "–" + m.slice(2, 4)).join(", ") : feedback === "wrong" ? "Это не лучший ход. Попробуй ещё раз." : mission === "mate1" ? "Проверь все шахи и найди ход, который сразу завершает партию." : mission === "mate2" || mission === "mate3" ? "Рассчитай ответ соперника. После каждого его хода найди продолжение матовой атаки." : mission === "punish" ? "Соперник оставил слабость. Найди тактический способ наказать ошибку." : mission === "defend" ? "Позиция под угрозой. Найди ход, который удерживает её." : mission === "fork" ? "Ищи ход с двойным нападением на две цели." : mission === "hanging" ? "Найди выигрыш фигуры с помощью связки, шпажки или атаки." : "Найди тактический удар или единственный сильный ход."}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => setHint(true)} disabled={hint || feedback !== "idle"} className="rounded-lg border border-[#4a4942] bg-[#393831] px-3 py-2 text-xs font-bold disabled:opacity-40">Подсказка</button>
                <button onClick={showAnswer} disabled={feedback === "solved" || feedback === "revealed" || solved} className="rounded-lg border border-[#4a4942] bg-[#393831] px-3 py-2 text-xs font-bold disabled:opacity-40">Показать решение</button>
                <button onClick={skipPuzzle} className="ml-auto rounded-lg bg-[#81b64c] px-4 py-2 text-xs font-extrabold text-[#17210f] hover:bg-[#95c75f]">Следующая задача</button>
              </div>
              {hint && feedback === "idle" && playerMove && <p className="mt-2 text-xs text-[#cbdcae]">Подсказка: начни с фигуры на поле {playerMove.slice(0, 2)}.</p>}
            </section>

            <aside className="space-y-3">
              <section className="rounded-xl border border-[#41403a] bg-[#30302b] p-4">
                <div className="text-sm font-bold">Позиция</div>
                <div className="mt-2 text-xs text-[#a6a59f]">ID: <span className="font-mono text-[#dddcd6]">{current.id}</span></div>
                <div className="mt-1 text-xs text-[#a6a59f]">Сложность: <b className="text-white">{current.rating}</b></div>
                <div className="mt-3 flex flex-wrap gap-1.5">{currentThemes.map((item) => <span key={item} className="rounded-md bg-[#22231f] px-2 py-1 text-[10px] text-[#c1c0b9]">{THEME_LABELS[item] ?? item}</span>)}</div>
                {mode === "daily" && <div className="mt-3 border-t border-[#45443e] pt-3 text-xs text-[#cbdcae]">{dailyDone || stats.lastDaily === localDateKey() ? "Ежедневная задача выполнена." : "Выполни сегодняшнюю задачу, чтобы поддержать серию."}</div>}
              </section>
              <section className="rounded-xl border border-[#41403a] bg-[#30302b] p-4">
                <div className="mb-2 text-sm font-bold">Задачи набора</div>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по ID, рейтингу, теме" className="w-full rounded-lg border border-[#41403a] bg-[#242520] px-3 py-2 text-xs outline-none focus:border-[#81b64c]" />
                <div className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
                  {filtered.slice(0, 100).map((puzzle) => <button key={puzzle.id} onClick={() => selectPuzzle(puzzle)} className={"flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs " + (puzzle.id === current.id ? "bg-[#46553b] text-white" : "text-[#bdbcb5] hover:bg-[#3c3b35]")}><span className="min-w-0 flex-1 truncate">{puzzle.rating} · {puzzle.themes.slice(0, 2).map((t) => THEME_LABELS[t] ?? t).join(", ")}</span><span className="font-mono text-[10px] text-[#8e8d85]">{puzzle.id}</span></button>)}
                  {filtered.length === 0 && <p className="p-3 text-xs text-[#93928b]">По этому фильтру задач нет.</p>}
                </div>
                <div className="mt-2 text-[10px] text-[#77766f]">Показано {Math.min(100, filtered.length)} из {filtered.length.toLocaleString("ru-RU")}</div>
              </section>
              <p className="px-1 text-[10px] leading-relaxed text-[#77766f]">Источник: Lichess Open Database, CC0. Позиции и решения проверяются на легальность перед добавлением в локальный набор.</p>
            </aside>
          </div>
        )}
        {!loading && !current && bank.length > 0 && <div className="rounded-xl border border-[#41403a] bg-[#30302b] p-5 text-sm text-[#aaa9a2]">Нет задач по выбранным фильтрам. Измени тему или поисковый запрос.</div>}
      </div>
    </div>
  );
}