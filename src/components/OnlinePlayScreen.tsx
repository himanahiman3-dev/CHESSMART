import { useCallback, useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import type { PlayerProfile } from "../lib/playerProfile";
import { GameBoard, type BoardMove } from "./GameBoard";

interface OnlineSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string };
}
interface OnlineMove {
  uci: string;
  san: string;
  color: "w" | "b";
  at: string;
}
interface OnlineGame {
  id: string;
  invite_code: string;
  status: "waiting" | "active" | "completed";
  white_id: string;
  black_id: string | null;
  white_name: string;
  black_name: string | null;
  fen: string;
  moves: OnlineMove[];
  white_ms: number;
  black_ms: number;
  increment_ms: number;
  turn_started_at: string | null;
  rated: boolean;
  rating_type: "bullet" | "blitz" | "rapid";
  result: string | null;
  white_rating: number | null;
  black_rating: number | null;
}
interface ActionResponse {
  game?: OnlineGame;
  error?: string;
  message?: string;
}
const SESSION_KEY = "chessmart:online-session:v1";
const GAME_KEY = "chessmart:online-game:v1";

async function authRequest(url: string, key: string, route: string, body: unknown): Promise<OnlineSession> {
  const response = await fetch(url + "/auth/v1/" + route, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as Partial<OnlineSession> & { expires_in?: number; error_description?: string; msg?: string };
  if (!response.ok || !payload.access_token || !payload.user?.id) {
    throw new Error(payload.error_description || payload.msg || "Не удалось создать сетевую сессию.");
  }
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token ?? "",
    expires_at: Date.now() + (payload.expires_in ?? 3600) * 1000,
    user: payload.user,
  };
}
async function validSession(url: string, key: string): Promise<OnlineSession> {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as OnlineSession | null;
    if (saved?.access_token && saved.expires_at > Date.now() + 60_000) return saved;
    if (saved?.refresh_token) {
      const refreshed = await authRequest(url, key, "token?grant_type=refresh_token", { refresh_token: saved.refresh_token });
      localStorage.setItem(SESSION_KEY, JSON.stringify(refreshed));
      return refreshed;
    }
  } catch { /* sign in with a fresh anonymous account below */ }
  const created = await authRequest(url, key, "signup", { data: { source: "chessmart" } });
  localStorage.setItem(SESSION_KEY, JSON.stringify(created));
  return created;
}
async function callAction(url: string, key: string, session: OnlineSession, action: string, payload: Record<string, unknown> = {}): Promise<ActionResponse> {
  const response = await fetch(url + "/functions/v1/game-action", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: "Bearer " + session.access_token,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await response.json() as ActionResponse;
  if (!response.ok) throw new Error(data.error || "Сервер отклонил запрос.");
  return data;
}
function clockText(ms: number): string {
  const safe = Math.max(0, ms);
  const seconds = Math.ceil(safe / 1000);
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return mm + ":" + String(ss).padStart(2, "0");
}

export function OnlinePlayScreen({ profile, onBack }: { profile: PlayerProfile; onBack: () => void }) {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
  const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";
  const configured = !!url && !!key;
  const [session, setSession] = useState<OnlineSession | null>(null);
  const [authBusy, setAuthBusy] = useState(configured);
  const [game, setGame] = useState<OnlineGame | null>(null);
  const [inviteCode, setInviteCode] = useState(() => new URLSearchParams(window.location.search).get("challenge") ?? "");
  const [timeControl, setTimeControl] = useState("5+0");
  const [rated, setRated] = useState(true);
  const [busy, setBusy] = useState(false);
  const [movePending, setMovePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [lastSync, setLastSync] = useState(Date.now());

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    validSession(url, key)
      .then(async (next) => {
        if (cancelled) return;
        setSession(next);
        const storedId = localStorage.getItem(GAME_KEY);
        if (storedId) {
          try {
            const data = await callAction(url, key, next, "get", { gameId: storedId });
            if (!cancelled && data.game) setGame(data.game);
          } catch {
            localStorage.removeItem(GAME_KEY);
          }
        }
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => { if (!cancelled) setAuthBusy(false); });
    return () => { cancelled = true; };
  }, [configured, url, key]);

  const refresh = useCallback(async () => {
    if (!session || !game?.id) return;
    try {
      const data = await callAction(url, key, session, "get", { gameId: game.id });
      if (data.game) setGame(data.game);
      setLastSync(Date.now());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [session, game?.id, url, key]);

  useEffect(() => {
    if (!game || game.status === "completed" || !session) return;
    const timer = window.setInterval(() => { void refresh(); }, 1500);
    return () => window.clearInterval(timer);
  }, [game?.id, game?.status, session, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const myColor = session && game ? (game.white_id === session.user.id ? "w" : game.black_id === session.user.id ? "b" : null) : null;
  const turn = useMemo(() => {
    if (!game) return null;
    try { return new Chess(game.fen).turn(); } catch { return null; }
  }, [game?.fen]);
  const activeElapsed = game?.turn_started_at ? Math.max(0, now - new Date(game.turn_started_at).getTime()) : 0;
  const whiteClock = game ? game.white_ms - (turn === "w" ? activeElapsed : 0) : 0;
  const blackClock = game ? game.black_ms - (turn === "b" ? activeElapsed : 0) : 0;
  const isMyTurn = !!game && game.status === "active" && !!myColor && turn === myColor && !movePending;
  const myRating = game && myColor === "w" ? game.white_rating : game?.black_rating;
  const opponentName = game && myColor === "w" ? (game.black_name ?? "Ожидаем игрока") : game?.white_name ?? "Соперник";

  const rememberGame = (next: OnlineGame) => {
    setGame(next);
    localStorage.setItem(GAME_KEY, next.id);
    setError(null);
  };
  const createGame = async () => {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      const [minutes, increment] = timeControl.split("+").map(Number);
      const data = await callAction(url, key, session, "create", {
        username: profile.name,
        minutes,
        increment,
        rated,
      });
      if (!data.game) throw new Error(data.error || "Сервер не создал игру.");
      rememberGame(data.game);
      setInviteCode(data.game.invite_code);
      const next = new URL(window.location.href);
      next.searchParams.set("challenge", data.game.invite_code);
      window.history.replaceState({}, "", next.toString());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  };
  const joinGame = async () => {
    if (!session || !inviteCode.trim()) return;
    setBusy(true); setError(null);
    try {
      const data = await callAction(url, key, session, "join", { inviteCode: inviteCode.trim().toUpperCase(), username: profile.name });
      if (!data.game) throw new Error(data.error || "Не удалось присоединиться к партии.");
      rememberGame(data.game);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  };
  const sendMove = (move: BoardMove): boolean => {
    if (!session || !game || !isMyTurn) return false;
    setMovePending(true);
    void callAction(url, key, session, "move", { gameId: game.id, uci: move.uci })
      .then((data) => { if (data.game) setGame(data.game); })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setMovePending(false));
    return true;
  };
  const resign = async () => {
    if (!session || !game) return;
    setBusy(true);
    try {
      const data = await callAction(url, key, session, "resign", { gameId: game.id });
      if (data.game) setGame(data.game);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  };
  const copyInvite = async () => {
    if (!game) return;
    const link = new URL(window.location.href);
    link.searchParams.set("challenge", game.invite_code);
    try {
      await navigator.clipboard.writeText(link.toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Не удалось скопировать ссылку. Код приглашения: " + game.invite_code);
    }
  };
  const clearGame = () => {
    localStorage.removeItem(GAME_KEY);
    setGame(null);
    setInviteCode("");
    const next = new URL(window.location.href);
    next.searchParams.delete("challenge");
    window.history.replaceState({}, "", next.toString());
  };

  if (!configured) {
    return (
      <main className="min-h-screen bg-[#262522] p-4 text-[#f0f0ed] sm:p-7">
        <div className="mx-auto max-w-3xl">
          <button onClick={onBack} className="mb-5 rounded-lg border border-[#474640] bg-[#33322e] px-4 py-2 text-sm font-bold">Назад</button>
          <section className="rounded-2xl border border-[#41403a] bg-[#30302b] p-6 sm:p-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#a3c86d]">Chessmart online</p>
            <h1 className="mt-2 text-3xl font-black">Играй с друзьями</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#b8b7b0]">Сетевой режим подготовлен, но для реальных партий нужен свой Supabase-проект. Это серверная часть: она хранит комнаты, проверяет легальность ходов, считает часы и обновляет отдельный рейтинг Bullet, Blitz и Rapid.</p>
            <div className="mt-5 rounded-xl border border-[#4c4b43] bg-[#242520] p-4">
              <div className="text-sm font-bold">Что нужно подключить</div>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-relaxed text-[#c9c8c1]">
                <li>Создать бесплатный проект Supabase.</li>
                <li>Включить Anonymous Sign-ins в Authentication.</li>
                <li>Применить SQL миграцию из <code>supabase/migrations</code>.</li>
                <li>Развернуть функцию <code>game-action</code> и задать секрет <code>SUPABASE_SERVICE_ROLE_KEY</code>.</li>
                <li>Добавить в окружение сайта <code>VITE_SUPABASE_URL</code> и <code>VITE_SUPABASE_ANON_KEY</code>.</li>
              </ol>
            </div>
            <p className="mt-4 text-xs text-[#85847d]">Ключ Service Role никогда не добавляй во фронтенд. Он нужен только серверной Edge Function.</p>
            <button onClick={onBack} className="mt-5 rounded-lg bg-[#81b64c] px-5 py-3 text-sm font-extrabold text-[#17210f]">Вернуться в Chessmart</button>
          </section>
        </div>
      </main>
    );
  }

  if (authBusy) return <main className="min-h-screen bg-[#262522] p-8 text-center text-sm text-[#b8b7b0]">Подключаем защищённую игровую сессию…</main>;

  return (
    <main className="min-h-screen bg-[#262522] p-4 text-[#f0f0ed] sm:p-7">
      <div className="mx-auto max-w-[1240px]">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#a3c86d]">Chessmart online</p>
            <h1 className="mt-1 text-2xl font-extrabold">Играть онлайн</h1>
            <p className="mt-1 text-sm text-[#a6a59f]">Партии с друзьями · серверные часы · отдельный рейтинг</p>
          </div>
          <button onClick={onBack} className="rounded-lg border border-[#474640] bg-[#33322e] px-4 py-2 text-sm font-bold">Назад</button>
        </header>

        {!session && <section className="mb-4 rounded-xl border border-[#81504a] bg-[#402b28] p-4 text-sm text-[#ffd2cd]">{error ?? "Не удалось войти в сетевую сессию."}</section>}
        {error && <section className="mb-4 rounded-xl border border-[#81504a] bg-[#402b28] p-3 text-sm text-[#ffd2cd]">{error}</section>}

        {!game ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-[#41403a] bg-[#30302b] p-5">
              <h2 className="text-lg font-extrabold">Создать приглашение</h2>
              <p className="mt-1 text-xs leading-relaxed text-[#a6a59f]">Создай комнату, отправь ссылку другу и начните партию, когда он подключится.</p>
              <label className="mt-4 block text-xs font-bold text-[#c9c8c1]">Контроль времени</label>
              <select value={timeControl} onChange={(e) => setTimeControl(e.target.value)} className="mt-2 w-full rounded-lg border border-[#4a4942] bg-[#242520] px-3 py-3 text-sm">
                {["1+0", "2+1", "3+0", "3+2", "5+0", "5+3", "10+0", "10+5", "15+10"].map((value) => <option key={value} value={value}>{value.replace("+", " + ")} · {Number(value.split("+")[0]) < 3 ? "Bullet" : Number(value.split("+")[0]) < 10 ? "Blitz" : "Rapid"}</option>)}
              </select>
              <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={rated} onChange={(e) => setRated(e.target.checked)} className="accent-[#81b64c]" /> Рейтинговая партия</label>
              <button onClick={() => void createGame()} disabled={!session || busy} className="mt-5 w-full rounded-lg bg-[#81b64c] px-4 py-3 text-sm font-extrabold text-[#17210f] disabled:opacity-40">{busy ? "Создаём…" : "Создать игру"}</button>
            </section>
            <section className="rounded-xl border border-[#41403a] bg-[#30302b] p-5">
              <h2 className="text-lg font-extrabold">Присоединиться к другу</h2>
              <p className="mt-1 text-xs leading-relaxed text-[#a6a59f]">Вставь код из приглашения или открой ссылку, которую тебе прислали.</p>
              <label className="mt-4 block text-xs font-bold text-[#c9c8c1]" htmlFor="online-invite-code">Код игры</label>
              <input id="online-invite-code" value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))} placeholder="Например, A4K9P2Q" className="mt-2 w-full rounded-lg border border-[#4a4942] bg-[#242520] px-3 py-3 font-mono text-lg tracking-[0.2em] outline-none focus:border-[#81b64c]" />
              <button onClick={() => void joinGame()} disabled={!session || busy || inviteCode.trim().length < 5} className="mt-5 w-full rounded-lg border border-[#66834a] bg-[#39462e] px-4 py-3 text-sm font-extrabold text-[#d7edbd] disabled:opacity-40">{busy ? "Подключаемся…" : "Присоединиться"}</button>
            </section>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
            <section className="rounded-xl border border-[#41403a] bg-[#30302b] p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div><div className="text-sm font-bold">{game.status === "waiting" ? "Ожидаем соперника" : opponentName}</div><div className="mt-0.5 text-xs text-[#9a9992]">{game.rating_type.toUpperCase()} · {game.rated ? "Рейтинговая" : "Без рейтинга"}</div></div>
                <div className="rounded-md bg-[#242520] px-2 py-1 text-xs font-semibold text-[#c9c8c1]">{myColor === "w" ? "Вы играете белыми" : myColor === "b" ? "Вы играете чёрными" : "Подключение"}</div>
              </div>
              <div className="mb-2 flex items-center justify-between rounded-lg bg-[#252621] px-3 py-2 text-sm"><span>{game.black_name ?? "Соперник"} <span className="text-xs text-[#85847d]">чёрные</span></span><b className={"font-mono text-xl tabular-nums " + (turn === "b" ? "text-white" : "text-[#aaa9a2]")}>{clockText(blackClock)}</b></div>
              <GameBoard fen={game.fen} orientation={myColor === "b" ? "black" : "white"} interactive={isMyTurn} allowedColor={myColor} onMove={sendMove} />
              <div className="mt-2 flex items-center justify-between rounded-lg bg-[#252621] px-3 py-2 text-sm"><span>{game.white_name} <span className="text-xs text-[#85847d]">белые</span></span><b className={"font-mono text-xl tabular-nums " + (turn === "w" ? "text-white" : "text-[#aaa9a2]")}>{clockText(whiteClock)}</b></div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={() => void copyInvite()} className="rounded-lg bg-[#81b64c] px-4 py-2.5 text-xs font-extrabold text-[#17210f]">{copied ? "Ссылка скопирована" : "Скопировать приглашение"}</button>
                {game.status === "active" && <button onClick={() => void resign()} disabled={busy} className="rounded-lg border border-[#7d4a44] bg-[#422a27] px-4 py-2.5 text-xs font-bold text-[#ffd2cd]">Сдаться</button>}
                <button onClick={clearGame} className="ml-auto rounded-lg border border-[#4a4942] bg-[#393831] px-3 py-2.5 text-xs font-bold">В меню</button>
              </div>
            </section>
            <aside className="space-y-3">
              {game.status === "waiting" && <section className="rounded-xl border border-[#6b814a] bg-[#303c28] p-4"><div className="text-sm font-extrabold text-[#d7edbd]">Комната создана</div><div className="mt-2 font-mono text-2xl font-black tracking-[0.2em]">{game.invite_code}</div><p className="mt-2 text-xs text-[#b7cba0]">Отправь код или ссылку другу. Игра начнётся после его подключения.</p></section>}
              {game.status === "active" && <section className="rounded-xl border border-[#41403a] bg-[#30302b] p-4"><div className="text-sm font-bold">Статус партии</div><p className="mt-2 text-sm text-[#c9c8c1]">{isMyTurn ? "Ваш ход" : "Ход соперника"}{movePending ? " · отправляем ход…" : ""}</p><p className="mt-2 text-[10px] text-[#85847d]">Синхронизация: {Math.max(0, Math.floor((now - lastSync) / 1000))} сек. назад</p>{game.rated && <p className="mt-2 text-xs text-[#a3c86d]">Рейтинг {game.rating_type}: {myRating ?? "—"}</p>}</section>}
              {game.status === "completed" && <section className="rounded-xl border border-[#6b814a] bg-[#303c28] p-4"><div className="text-lg font-extrabold">Партия завершена</div><p className="mt-2 text-sm text-[#d7edbd]">{game.result ?? "Результат сохранён"}</p>{game.rated && <p className="mt-2 text-xs text-[#b7cba0]">Рейтинг обновлён на сервере. Ваш новый рейтинг: {myRating ?? "—"}</p>}</section>}
              <section className="rounded-xl border border-[#41403a] bg-[#30302b] p-4">
                <div className="mb-2 text-sm font-bold">Ходы</div>
                <div className="max-h-72 overflow-y-auto text-xs leading-7 text-[#c9c8c1]">
                  {game.moves.length ? game.moves.map((move, index) => <span key={move.at + move.uci} className="mr-2 inline-block"><span className="text-[#77766f]">{Math.floor(index / 2) + 1}{move.color === "w" ? "." : "…"}</span> {move.san}</span>) : <span className="text-[#85847d]">Пока нет ходов.</span>}
                </div>
              </section>
              <p className="px-1 text-[10px] leading-relaxed text-[#77766f]">Не запускай Stockfish и другие подсказки во время рейтинговой онлайн-партии. Сетевые партии и изменения Elo обрабатывает сервер.</p>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}