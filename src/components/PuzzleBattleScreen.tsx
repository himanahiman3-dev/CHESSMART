import { useCallback, useEffect, useRef, useState } from "react";
import { GameBoard, type BoardMove } from "./GameBoard";

interface BattleSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string };
}
interface BattlePlayer {
  user_id: string;
  username: string;
  avatar_url: string | null;
  score: number;
  round_index: number;
  mistakes: number;
  completed: boolean;
  puzzle_battle_rating: number;
  puzzle_battle_games: number;
  puzzle_battle_wins: number;
  puzzle_battle_losses: number;
  puzzle_battle_draws: number;
  puzzle_battle_win_streak: number;
  puzzle_battle_best_win_streak: number;
  season_points: number;
}
interface BattlePuzzle {
  round: number;
  puzzle_id: string;
  fen: string;
  color: "w" | "b";
  rating: number;
  themes: string[];
}
interface BattleLeader {
  user_id: string;
  username: string;
  avatar_url: string | null;
  puzzle_battle_rating: number;
  puzzle_battle_games: number;
  season_points: number;
  wins: number;
  losses: number;
  draws: number;
  best_win_streak: number;
}
interface BattleSnapshot {
  status: "active" | "completed" | "cancelled";
  battle: {
    id: string;
    player_one_id: string;
    player_two_id: string;
    started_at: string;
    ends_at: string;
    finished_at: string | null;
    winner_id: string | null;
    finish_reason: string | null;
    player_one_rating: number | null;
    player_two_rating: number | null;
    player_one_rating_after: number | null;
    player_two_rating_after: number | null;
    season_points_one: number;
    season_points_two: number;
    rating_applied: boolean;
  };
  players: BattlePlayer[];
  me: BattlePlayer;
  opponent: BattlePlayer;
  puzzle: BattlePuzzle | null;
}
interface BattleResponse {
  status: "idle" | "queued" | "active" | "completed" | "cancelled";
  queued_at?: string;
  result?: {
    correct?: boolean;
    mistakes?: number;
    puzzle_completed?: boolean;
    completed?: boolean;
    battle_finished?: boolean;
    reason?: string;
  };
  battle?: BattleSnapshot["battle"];
  players?: BattlePlayer[];
  me?: BattlePlayer | null;
  opponent?: BattlePlayer | null;
  puzzle?: BattlePuzzle | null;
  leaders?: BattleLeader[];
  my_rank?: number | null;
  season_start?: string;
  sort?: "points" | "rating";
  error?: string;
}
const SESSION_KEY = "chessmart:account-session:v2";
const CONFIG_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const CONFIG_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

function loadSession(): BattleSession | null {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as BattleSession | null;
    return session?.access_token && session.refresh_token && session.user?.id ? session : null;
  } catch {
    return null;
  }
}
async function freshSession(session: BattleSession): Promise<BattleSession> {
  if (session.expires_at > Date.now() + 60_000) return session;
  const response = await fetch(CONFIG_URL + "/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: CONFIG_KEY },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  const data = await response.json().catch(() => ({})) as Partial<BattleSession> & { expires_in?: number; msg?: string };
  if (!response.ok || !data.access_token || !data.refresh_token || !data.user?.id) {
    throw new Error(data.msg || "Сессия истекла. Войди в CHESSMART Online заново.");
  }
  const next = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
    user: data.user,
  };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(next)); } catch { /* storage is optional */ }
  return next;
}
async function battleAction(session: BattleSession, action: string, payload: Record<string, unknown> = {}) {
  if (!CONFIG_URL || !CONFIG_KEY) throw new Error("Облачный сервер не настроен.");
  const current = await freshSession(session);
  const response = await fetch(CONFIG_URL + "/functions/v1/puzzle-battle", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CONFIG_KEY,
      Authorization: "Bearer " + current.access_token,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await response.json().catch(() => ({})) as BattleResponse;
  if (!response.ok) throw new Error(data.error || "Сервер дуэли отклонил запрос.");
  return { data, session: current };
}
function formatRemaining(seconds: number): string {
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}
function themeLabel(theme: string): string {
  const labels: Record<string, string> = {
    fork: "Вилка", pin: "Связка", skewer: "Шпажка", mateIn1: "Мат в 1",
    mateIn2: "Мат в 2", mateIn3: "Мат в 3", hangingPiece: "Выигрыш фигуры",
    sacrifice: "Жертва", backRankMate: "Мат на последней линии",
    discoveredAttack: "Вскрытая атака", promotion: "Превращение", endgame: "Эндшпиль",
    defensiveMove: "Защита", quietMove: "Тихий ход",
  };
  return labels[theme] ?? theme;
}

export function PuzzleBattleScreen({ onBack }: { onBack: () => void }) {
  const [session, setSession] = useState<BattleSession | null>(null);
  const [phase, setPhase] = useState<"loading" | "idle" | "queued" | "active" | "completed">("loading");
  const [battle, setBattle] = useState<BattleSnapshot | null>(null);
  const [localFen, setLocalFen] = useState("");
  const [message, setMessage] = useState("Подготавливаем соревновательный режим.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [leaderboard, setLeaderboard] = useState<BattleLeader[]>([]);
  const [leaderboardSort, setLeaderboardSort] = useState<"points" | "rating">("points");
  const [leaderboardBusy, setLeaderboardBusy] = useState(false);
  const [leaderboardRank, setLeaderboardRank] = useState<number | null>(null);
  const [seasonStart, setSeasonStart] = useState("");
  const [now, setNow] = useState(Date.now());
  const leaderboardRequest = useRef(0);
  const polling = useRef(false);
  const currentSession = session;

  useEffect(() => {
    const stored = loadSession();
    setSession(stored);
    setPhase(stored ? "idle" : "loading");
    setMessage(stored ? "Готов к поиску соперника." : "Для Puzzle Battle нужен аккаунт CHESSMART Online.");
  }, []);

  const applyResponse = useCallback((data: BattleResponse) => {
    if (data.status === "queued") {
      setPhase("queued");
      setMessage("Ищем соперника с близким рейтингом…");
      return;
    }
    if (data.status === "idle") {
      setBattle(null);
      setLocalFen("");
      setPhase("idle");
      return;
    }
    if (data.battle && data.me && data.opponent) {
      const snapshot: BattleSnapshot = {
        status: data.status === "completed" ? "completed" : data.status === "cancelled" ? "cancelled" : "active",
        battle: data.battle,
        players: data.players ?? [data.me, data.opponent],
        me: data.me,
        opponent: data.opponent,
        puzzle: data.puzzle ?? null,
      };
      setBattle(snapshot);
      setLocalFen(snapshot.puzzle?.fen ?? "");
      setPhase(snapshot.status === "completed" ? "completed" : "active");
      return;
    }
    setPhase(data.status === "completed" ? "completed" : "idle");
  }, []);

  const perform = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    if (!currentSession) throw new Error("Сначала войди в CHESSMART Online.");
    const { data, session: fresh } = await battleAction(currentSession, action, payload);
    setSession(fresh);
    applyResponse(data);
    return data;
  }, [currentSession, applyResponse]);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    void battleAction(session, "status")
      .then(({ data, session: fresh }) => {
        if (!alive) return;
        setSession(fresh);
        applyResponse(data);
        if (data.status === "queued") setMessage("Ты уже в очереди. Продолжаем поиск соперника…");
        else if (data.battle) setMessage("Восстановили твою текущую дуэль.");
      })
      .catch((reason) => {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { alive = false; };
  }, [session, applyResponse]);

  const loadLeaderboard = useCallback(async (sort: "points" | "rating" = leaderboardSort) => {
    if (!session) return;
    const requestId = ++leaderboardRequest.current;
    setLeaderboardBusy(true);
    try {
      const { data, session: fresh } = await battleAction(session, "leaderboard", { sort });
      if (requestId !== leaderboardRequest.current) return;
      setSession(fresh);
      setLeaderboard(data.leaders ?? []);
      setLeaderboardRank(data.my_rank ?? null);
      setSeasonStart(data.season_start ?? "");
    } catch (reason) {
      if (requestId === leaderboardRequest.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (requestId === leaderboardRequest.current) setLeaderboardBusy(false);
    }
  }, [session, leaderboardSort]);

  useEffect(() => {
    if (session) void loadLeaderboard(leaderboardSort);
  }, [session, leaderboardSort]);

  useEffect(() => {
    if (phase === "completed") void loadLeaderboard(leaderboardSort);
  }, [phase, leaderboardSort]);

  const startQueue = async () => {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    setMessage("Подбираем пять проверенных задач и ищем соперника…");
    try {
      await perform("queue");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setPhase("idle");
    } finally {
      setBusy(false);
    }
  };

  const cancelQueue = async () => {
    if (!session || busy) return;
    setBusy(true);
    try {
      await perform("cancel");
      setMessage("Поиск соперника отменён.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (phase !== "queued" && phase !== "active") return;
    let alive = true;
    const poll = async () => {
      if (!alive || polling.current || !currentSession || busy) return;
      polling.current = true;
      try {
        const { data, session: fresh } = await battleAction(currentSession, "status");
        if (!alive) return;
        setSession(fresh);
        applyResponse(data);
        if (data.status === "queued") setMessage("Ожидаем второго игрока. Подбор продолжается автоматически.");
      } catch (reason) {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        polling.current = false;
      }
    };
    const timer = window.setInterval(poll, phase === "queued" ? 2200 : 1800);
    void poll();
    return () => { alive = false; window.clearInterval(timer); };
  }, [phase, currentSession, busy, applyResponse]);

  useEffect(() => {
    if (phase !== "active") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const onMove = useCallback((move: BoardMove): boolean => {
    if (!session || !battle || !battle.puzzle || phase !== "active" || busy || battle.me.completed) return false;
    const previousFen = battle.puzzle.fen;
    setLocalFen(move.fenAfter);
    setBusy(true);
    setError("");
    void battleAction(session, "answer", { battleId: battle.battle.id, uci: move.uci })
      .then(({ data, session: fresh }) => {
        setSession(fresh);
        applyResponse(data);
        if (!data.result?.correct) {
          setMessage(data.me?.completed
            ? "Три ошибки. Твоя серия завершена — ждём результат соперника."
            : "Нет, этот ход не входит в комбинацию. Одна ошибка засчитана.");
        } else if (data.result.puzzle_completed) {
          setMessage(data.me?.completed
            ? "Пять задач решены! Отличная серия — ждём соперника."
            : "Задача решена. Переходим к следующей позиции.");
        } else {
          setMessage("Верно! Ответ соперника сделан автоматически.");
        }
      })
      .catch((reason) => {
        setLocalFen(previousFen);
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setBusy(false));
    return true;
  }, [session, battle, phase, busy, applyResponse]);

  const remaining = battle ? Math.max(0, Math.ceil((Date.parse(battle.battle.ends_at) - now) / 1000)) : 180;
  const winnerText = battle?.battle.winner_id === null
    ? "Ничья"
    : battle?.battle.winner_id === battle?.me.user_id ? "Ты победил!" : "Победил соперник";
  const myProgress = battle?.me.round_index ?? 0;
  const opponentProgress = battle?.opponent.round_index ?? 0;
  const myRatingBefore = battle
    ? (battle.battle.player_one_id === battle.me.user_id
      ? battle.battle.player_one_rating
      : battle.battle.player_two_rating) ?? battle.me.puzzle_battle_rating
    : 1200;
  const myRatingAfter = battle
    ? (battle.battle.player_one_id === battle.me.user_id
      ? battle.battle.player_one_rating_after
      : battle.battle.player_two_rating_after) ?? battle.me.puzzle_battle_rating
    : 1200;
  const myRatingDelta = myRatingAfter - myRatingBefore;
  const mySeasonPoints = battle
    ? battle.battle.player_one_id === battle.me.user_id
      ? battle.battle.season_points_one
      : battle.battle.season_points_two
    : 0;

  return (
    <div className="min-h-screen bg-[#1b241c] p-4 text-[#edf3e8] sm:p-7">
      <div className="mx-auto max-w-[1320px]">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[.2em] text-[#a8d17a]">CHESSMART ARENA</div>
            <h1 className="mt-1 text-2xl font-black sm:text-3xl">Puzzle Battle</h1>
            <p className="mt-1 max-w-2xl text-sm text-[#a8b5a0]">Три минуты. Пять задач. Три ошибки — и серия заканчивается. Оба игрока решают один набор позиций.</p>
          </div>
          <button onClick={onBack} className="rounded-xl border border-[#52634b] bg-[#293429] px-4 py-2.5 text-xs font-bold hover:bg-[#344232]">← Назад</button>
        </header>

        {!CONFIG_URL || !CONFIG_KEY ? (
          <div className="rounded-2xl border border-[#80564b] bg-[#402b27] p-5 text-sm text-[#ffd1c9]">Соревновательный сервер не настроен.</div>
        ) : !session ? (
          <section className="rounded-3xl border border-[#46563d] bg-[#263326] p-6">
            <div className="text-lg font-black">Сначала войди в CHESSMART Online</div>
            <p className="mt-2 max-w-xl text-sm text-[#a8b5a0]">Для честного подбора соперника и серверной проверки ходов нужна учётная запись. Прогресс дуэлей нельзя подделать изменением счётчика в браузере.</p>
            <button onClick={onBack} className="mt-4 rounded-xl bg-[#a5d17c] px-4 py-3 text-xs font-black text-[#172315]">Перейти в онлайн-игру →</button>
          </section>
        ) : (
          <>
            {phase === "idle" && (
              <section className="rounded-3xl border border-[#46563d] bg-gradient-to-br from-[#2d3d2c] to-[#202b21] p-6 sm:p-8">
                <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
                  <div>
                    <div className="text-[9px] font-black uppercase tracking-[.2em] text-[#a8ca89]">СОРЕВНОВАТЕЛЬНЫЙ РЕЖИМ</div>
                    <h2 className="mt-2 text-2xl font-black">Кто быстрее найдёт комбинации?</h2>
                    <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#adbaa4]">Подбираем игрока по отдельному Puzzle Battle Elo. Вы получаете одинаковые пять задач из проверенной базы. За каждую решённую задачу — очко и сезонный прогресс; победные серии усиливают награду. При равных очках выигрывает тот, кто допустил меньше ошибок.</p>
                    <button onClick={startQueue} disabled={busy} className="mt-5 rounded-xl bg-[#a5d17c] px-6 py-3 text-sm font-black text-[#172315] hover:bg-[#b7e28e] disabled:opacity-50">{busy ? "Подготовка…" : "Найти соперника"}</button>
                    <p className="mt-2 text-[10px] text-[#879781]">Без входного рейтинга, ставок и платных ограничений.</p>
                  </div>
                  <aside className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        ["3:00", "Время раунда"],
                        ["5", "Позиций"],
                        ["3", "Допустимые ошибки"],
                        ["1", "Очко за решение"],
                      ].map(([value, label]) => <div key={label} className="rounded-2xl border border-white/[.07] bg-black/[.14] p-3"><div className="text-2xl font-black">{value}</div><div className="mt-1 text-[10px] text-[#9eac94]">{label}</div></div>)}
                    </div>
                    <div className="rounded-2xl border border-white/[.08] bg-black/[.13] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-black">Лидеры Puzzle Battle</div>
                        <div className="flex gap-1">
                          <button onClick={() => setLeaderboardSort("points")} className={"rounded-md px-2 py-1 text-[9px] font-bold " + (leaderboardSort === "points" ? "bg-[#9bc96e] text-[#182315]" : "bg-white/[.07] text-[#aebba6]")}>Сезон</button>
                          <button onClick={() => setLeaderboardSort("rating")} className={"rounded-md px-2 py-1 text-[9px] font-bold " + (leaderboardSort === "rating" ? "bg-[#9bc96e] text-[#182315]" : "bg-white/[.07] text-[#aebba6]")}>Рейтинг</button>
                        </div>
                      </div>
                      <div className="mt-1 text-[9px] text-[#82927a]">{leaderboardSort === "points" ? "Месячные очки · " + (seasonStart || "текущий сезон") : "Отдельный Battle Elo"}{leaderboardBusy ? " · обновляем" : ""}</div>
                      <div className="mt-2 space-y-1.5">
                        {leaderboard.slice(0, 8).map((leader, index) => (
                          <div key={leader.user_id} className={"flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 " + (leader.user_id === session?.user.id ? "bg-[#3a4c31]" : "bg-white/[.035]")}>
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="w-4 shrink-0 text-[10px] font-black text-[#9aab8e]">{index + 1}</span>
                              <div className="min-w-0">
                                <span className="block truncate text-[10px] font-bold text-[#dbe7d1]">{leader.username}</span>
                                <span className="block text-[8px] text-[#879781]">{leader.wins} побед · {leader.puzzle_battle_games} игр · рекорд серии {leader.best_win_streak}</span>
                              </div>
                            </div>
                            <span className="shrink-0 text-[10px] font-black tabular-nums text-[#cce4b3]">{leaderboardSort === "points" ? leader.season_points + " очк." : leader.puzzle_battle_rating}</span>
                          </div>
                        ))}
                        {!leaderboard.length && <div className="py-3 text-center text-[10px] text-[#82927a]">{leaderboardBusy ? "Загружаем таблицу…" : "В этом сезоне пока нет результатов."}</div>}
                      </div>
                      {leaderboardRank && <div className="mt-2 border-t border-white/[.06] pt-2 text-[10px] font-bold text-[#a6ba99]">Твоё место: #{leaderboardRank}</div>}
                      <button onClick={() => void loadLeaderboard(leaderboardSort)} disabled={leaderboardBusy} className="mt-2 text-[9px] font-bold text-[#a9c68d] disabled:opacity-40">Обновить таблицу</button>
                    </div>
                  </aside>
                </div>
              </section>
            )}

            {phase === "queued" && (
              <section className="rounded-3xl border border-[#526b46] bg-gradient-to-br from-[#2d3e2b] to-[#202b21] p-8 text-center">
                <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-[#77965f]/30 border-t-[#a9d77f]" />
                <h2 className="mt-4 text-xl font-black">Ищем соперника</h2>
                <p className="mt-2 text-sm text-[#a8b5a0]">Очередь расширяется по рейтингу. Когда второй игрок найдётся, доска откроется автоматически.</p>
                <button onClick={cancelQueue} disabled={busy} className="mt-5 rounded-xl border border-white/[.12] px-4 py-2.5 text-xs font-bold text-[#c4d0bd]">Отменить поиск</button>
              </section>
            )}

            {(phase === "active" || phase === "completed") && battle && (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <section className="rounded-3xl border border-[#43533b] bg-gradient-to-br from-[#2a3928] to-[#202a20] p-4 sm:p-6">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-[9px] font-black uppercase tracking-[.2em] text-[#a8ca89]">{phase === "completed" ? "РАУНД ЗАВЕРШЁН" : "ДУЭЛЬ ИДЁТ"}</div>
                      <h2 className="mt-1 text-xl font-black">{phase === "completed" ? winnerText : "Решай быстрее соперника"}</h2>
                    </div>
                    <div className="rounded-2xl border border-white/[.08] bg-black/20 px-5 py-2 text-center">
                      <div className="text-3xl font-black tabular-nums">{formatRemaining(remaining)}</div>
                      <div className="text-[9px] font-bold uppercase text-[#95a38b]">Осталось</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-xl bg-black/[.15] p-3"><div className="text-2xl font-black tabular-nums">{battle.me.score}</div><div className="text-[9px] font-bold uppercase text-[#92a188]">Твои очки</div><div className="mt-1 text-[9px] text-[#abc39a]">{battle.me.puzzle_battle_rating} Battle Elo</div></div>
                    <div className="rounded-xl bg-black/[.15] p-3"><div className="text-2xl font-black tabular-nums">{battle.opponent.score}</div><div className="text-[9px] font-bold uppercase text-[#92a188]">Соперник</div><div className="mt-1 text-[9px] text-[#abc39a]">{battle.opponent.puzzle_battle_rating} Battle Elo</div></div>
                    <div className="rounded-xl bg-black/[.15] p-3"><div className="text-2xl font-black tabular-nums">{myProgress}/5</div><div className="text-[9px] font-bold uppercase text-[#92a188]">Мой прогресс</div></div>
                    <div className="rounded-xl bg-black/[.15] p-3"><div className="text-2xl font-black tabular-nums">{battle.me.mistakes}/3</div><div className="text-[9px] font-bold uppercase text-[#92a188]">Ошибки</div></div>
                  </div>

                  {phase === "completed" ? (
                    <div className="mt-5 rounded-2xl border border-[#718e55] bg-[#30442b] p-5">
                      <div className="text-lg font-black text-[#d7edc3]">{winnerText}</div>
                      <div className="mt-1 text-sm text-[#c4d8b5]">Счёт {battle.me.score} : {battle.opponent.score}</div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                        <div className="rounded-lg bg-black/[.14] p-2">
                          <div className="text-[#879781]">Твой Battle Elo</div>
                          <b className="text-[#d7edc3]">{battle.me.puzzle_battle_rating}</b>
                          <span className="ml-1 text-[#a3b996]">· {myRatingDelta >= 0 ? "+" : ""}{myRatingDelta}</span>
                        </div>
                        <div className="rounded-lg bg-black/[.14] p-2"><div className="text-[#879781]">Сезонные очки</div><b className="text-[#d7edc3]">+{mySeasonPoints}</b></div>
                      </div>
                      <p className="mt-2 text-xs text-[#9eb48c]">{battle.battle.finish_reason === "time" ? "Время вышло. Результат зафиксирован сервером." : "Оба игрока завершили серию или исчерпали ошибки."}</p>
                      <div className="mt-2 text-[10px] text-[#b2c5a5]">Твоя серия побед: {battle.me.puzzle_battle_win_streak} · лучший рекорд: {battle.me.puzzle_battle_best_win_streak}</div>
                      <button onClick={startQueue} disabled={busy} className="mt-4 rounded-xl bg-[#a5d17c] px-4 py-3 text-xs font-black text-[#172315]">Новая дуэль →</button>
                    </div>
                  ) : battle.me.completed ? (
                    <div className="mt-5 rounded-2xl border border-[#6a8053] bg-[#2e3d2a] p-5">
                      <div className="text-lg font-black">Твоя серия завершена</div>
                      <p className="mt-1 text-sm text-[#aebfa3]">Соперник ещё решает задачи. Дождись конца раунда — счёт обновится автоматически.</p>
                    </div>
                  ) : battle.puzzle ? (
                    <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_250px]">
                      <div className="min-w-0">
                        <GameBoard fen={localFen || battle.puzzle.fen} orientation={battle.puzzle.color === "w" ? "white" : "black"} interactive={!busy && phase === "active"} allowedColor={battle.puzzle.color} onMove={onMove} />
                        <div className="mt-3 rounded-xl border border-white/[.08] bg-black/[.14] p-3 text-sm text-[#d0ddc8]">{message}</div>
                        <div className="mt-2 text-[10px] text-[#879781]">Задача {battle.puzzle.round}/5 · Рейтинг позиции {battle.puzzle.rating}</div>
                      </div>
                      <aside className="space-y-3">
                        <div className="rounded-2xl border border-white/[.07] bg-[#1b271d] p-4">
                          <div className="text-[9px] font-black uppercase tracking-widest text-[#91a481]">Тема позиции</div>
                          <div className="mt-2 flex flex-wrap gap-1.5">{battle.puzzle.themes.slice(0, 5).map((theme) => <span key={theme} className="rounded-md bg-white/[.07] px-2 py-1 text-[9px] font-bold text-[#c5d3bc]">{themeLabel(theme)}</span>)}</div>
                          <div className="mt-4 text-xs text-[#aab8a0]">Белые ходят: {battle.puzzle.color === "w" ? "да" : "нет"}</div>
                        </div>
                        <div className="rounded-2xl border border-white/[.07] bg-[#1b271d] p-4">
                          <div className="text-[9px] font-black uppercase tracking-widest text-[#91a481]">Твой соперник</div>
                          <div className="mt-2 text-sm font-black">{battle.opponent.username}</div>
                          <div className="mt-1 text-[10px] text-[#abc39a]">{battle.opponent.puzzle_battle_rating} Battle Elo · {battle.opponent.season_points} сезонных очков</div>
                          <div className="mt-1 text-xs text-[#9eae94]">Позиции: {opponentProgress}/5</div>
                          <div className="mt-3 flex gap-1">{Array.from({ length: 5 }, (_, index) => <span key={index} className={"h-1.5 flex-1 rounded-full " + (index < opponentProgress ? "bg-[#a8d17a]" : "bg-white/[.08]")} />)}</div>
                          <div className="mt-3 text-xs text-[#9eae94]">Ошибки: {battle.opponent.mistakes}/3</div>
                        </div>
                      </aside>
                    </div>
                  ) : (
                    <div className="mt-5 rounded-xl bg-black/15 p-8 text-center text-sm text-[#a8b5a0]">Ожидаем обновления доски…</div>
                  )}
                </section>
              </div>
            )}
          </>
        )}
        {error && <div className="mt-4 rounded-xl border border-[#87534a] bg-[#402a27] p-3 text-xs text-[#ffd1c9]">{error}</div>}
      </div>
    </div>
  );
}
