import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { GameBoard, type BoardMove } from "./GameBoard";
import { clearAccountProfile, publishAccountProfile } from "../lib/accountProfile";
import { resolvePremove, type Premove, formatPremove } from "../lib/premoves";
import { loadGameplayPreferences, updateGameplayPreferences, getBoardOrientation, clockUrgency, formatClock, type GameplayPreferences } from "../lib/gameplayPreferences";
import { playSound, setSoundEnabled, soundForSan } from "../lib/sound";
import { buildPgnFromUci, copyText, downloadTextFile, formatSanMoveList, pgnFilename, textFilename } from "../lib/gameNotation";

interface OnlineSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string };
}
interface OnlineProfile {
  user_id: string;
  username: string;
  bullet_rating: number;
  blitz_rating: number;
  rapid_rating: number;
  bullet_games: number;
  blitz_games: number;
  rapid_games: number;
  avatar_url?: string | null;
}
interface OnlineMove { uci: string; san: string; color: "w" | "b"; at: string; premove?: boolean; }
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
  reason: string | null;
  white_rating: number | null;
  black_rating: number | null;
}
interface Invitation {
  id: string;
  from_user: string;
  created_at: string;
  game: { id: string; white_name: string; rating_type: "bullet" | "blitz" | "rapid"; minutes: number; increment_seconds: number };
}
interface ActionResponse {
  session?: OnlineSession;
  profile?: OnlineProfile;
  player?: Partial<OnlineProfile>;
  game?: OnlineGame;
  queued?: boolean;
  invitations?: Invitation[];
  sent?: boolean;
  cancelled?: boolean;
  error?: string;
}
type AuthMode = "login" | "register";
const SESSION_KEY = "chessmart:account-session:v2";
const GAME_KEY = "chessmart:online-game:v2";

async function callPublicAction(url: string, key: string, action: string, payload: Record<string, unknown> = {}): Promise<ActionResponse> {
  const response = await fetch(url + "/functions/v1/game-action", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await response.json() as ActionResponse;
  if (!response.ok) throw new Error(data.error || "Сервер отклонил запрос.");
  return data;
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
async function refreshSession(url: string, key: string, refreshToken: string): Promise<OnlineSession> {
  const response = await fetch(url + "/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data = await response.json() as OnlineSession & { expires_in?: number; msg?: string };
  if (!response.ok || !data.access_token || !data.user?.id) throw new Error(data.msg || "Сессия истекла. Войди снова.");
  return { ...data, expires_at: Date.now() + (data.expires_in ?? 3600) * 1000 };
}
function saveSession(session: OnlineSession) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* storage can be disabled */ }
}
async function encodeAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Выбери файл изображения.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Исходное изображение должно быть меньше 8 МБ.");
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Браузер не смог обработать изображение.");
  context.drawImage(bitmap, sx, sy, side, side, 0, 0, 512, 512);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Не удалось обработать изображение.")), "image/jpeg", 0.86);
  });
  if (blob.size > 1_048_576) throw new Error("Не удалось сжать аватар до 1 МБ.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function clockText(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}
function typeLabel(type: string): string {
  return type === "bullet" ? "Bullet" : type === "blitz" ? "Blitz" : "Rapid";
}
function resultText(game: OnlineGame, myColor: "w" | "b" | null): string {
  if (game.result === "draw") return "Ничья";
  if (game.result === "white_win") return myColor === "w" ? "Победа" : "Поражение";
  if (game.result === "black_win") return myColor === "b" ? "Победа" : "Поражение";
  return "Партия завершена";
}
function reasonText(reason: string | null): string {
  const labels: Record<string, string> = {
    checkmate: "Мат", timeout: "Время вышло", resignation: "Сдача",
    stalemate: "Пат", threefold_repetition: "Троекратное повторение",
    insufficient_material: "Недостаточно материала", draw: "Ничья",
  };
  return reason ? labels[reason] ?? reason : "";
}

export function OnlinePlayScreen({ onBack }: { onBack: () => void }) {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
  const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";
  const configured = !!url && !!key;

  const [session, setSession] = useState<OnlineSession | null>(null);
  const [onlineProfile, setOnlineProfile] = useState<OnlineProfile | null>(null);
  const [authBusy, setAuthBusy] = useState(configured);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [game, setGame] = useState<OnlineGame | null>(null);
  const [inviteCode, setInviteCode] = useState(() => new URLSearchParams(window.location.search).get("challenge") ?? "");
  const [inviteUsername, setInviteUsername] = useState("");
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteTarget, setInviteTarget] = useState("");
  const [timeControl, setTimeControl] = useState("5+0");
  const [rated, setRated] = useState(true);
  const [busy, setBusy] = useState(false);
  const [movePending, setMovePending] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [lastSync, setLastSync] = useState(Date.now());
  const [premove, setPremove] = useState<Premove | null>(null);
  const premoveGameIdRef = useRef<string | null>(null);
  const [boardFlipped, setBoardFlipped] = useState(false);
  const [preferences, setPreferences] = useState<GameplayPreferences>(() => loadGameplayPreferences());
  const [connectionOnline, setConnectionOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [exportNotice, setExportNotice] = useState("");
  const movePendingRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const timeoutRequestedRef = useRef(false);
  const timeoutLastAttemptRef = useRef(0);
  const searchBusyRef = useRef(false);

  const selectAvatar = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Выбери файл изображения."); return; }
    if (file.size > 8 * 1024 * 1024) { setError("Исходное изображение должно быть меньше 8 МБ."); return; }
    setAvatarFile(file);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const saveAvatar = async (file: File, activeSession: OnlineSession) => {
    const avatarData = await encodeAvatar(file);
    const data = await callAction(url, key, activeSession, "update_avatar", { avatarData, contentType: "image/jpeg" });
    if (!data.profile) throw new Error("Сервер не вернул обновлённый профиль.");
    setOnlineProfile(data.profile);
    publishAccountProfile(data.profile);
    setAvatarFile(null);
    setAvatarPreview(null);
    setNotice("Аватар успешно обновлён.");
  };

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    const connect = async () => {
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return;
        let saved = JSON.parse(raw) as OnlineSession;
        if (!saved.access_token || !saved.user?.id) return;
        if (saved.expires_at <= Date.now() + 60_000) {
          saved = await refreshSession(url, key, saved.refresh_token);
          saveSession(saved);
        }
        const [profileData, storedId] = await Promise.all([
          callAction(url, key, saved, "profile"),
          Promise.resolve(localStorage.getItem(GAME_KEY)),
        ]);
        if (cancelled) return;
        if (profileData.profile) {
          setOnlineProfile(profileData.profile);
          publishAccountProfile(profileData.profile);
        }
        setSession(saved);
        if (profileData.game) {
          if (!cancelled) {
            setGame(profileData.game);
            localStorage.setItem(GAME_KEY, profileData.game.id);
          }
        } else if (storedId) {
          try {
            const data = await callAction(url, key, saved, "get", { gameId: storedId });
            if (!cancelled && data.game) setGame(data.game);
          } catch { localStorage.removeItem(GAME_KEY); }
        }
      } catch {
        localStorage.removeItem(SESSION_KEY);
        clearAccountProfile();
      } finally {
        if (!cancelled) setAuthBusy(false);
      }
    };
    void connect();
    return () => { cancelled = true; };
  }, [configured, url, key]);

  const authenticate = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const action = authMode === "register" ? "register" : "login";
      const data = await callPublicAction(url, key, action, {
        username: username.trim(),
        password,
      });
      if (!data.session || !data.profile) throw new Error("Сервер не вернул профиль или сессию.");
      const nextSession = {
        ...data.session,
        expires_at: data.session.expires_at ? data.session.expires_at * 1000 : Date.now() + 3600_000,
      };
      saveSession(nextSession);
      setSession(nextSession);
      setOnlineProfile(data.profile);
      publishAccountProfile(data.profile);
      setPassword("");
      setNotice(authMode === "register" ? "Аккаунт создан. Добро пожаловать в CHESSMART." : "Вход выполнен.");
      if (authMode === "register" && avatarFile) {
        try { await saveAvatar(avatarFile, nextSession); }
        catch (avatarError) { setNotice("Аккаунт создан, но аватар не загрузился: " + (avatarError instanceof Error ? avatarError.message : String(avatarError))); }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  };
  const signOut = () => {
    clearAccountProfile();
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(GAME_KEY);
    setSession(null); setOnlineProfile(null); setGame(null); setSearching(false);
    setInvitations([]); setError(null); setNotice("Ты вышел из аккаунта на этом устройстве.");
  };

  const refreshProfile = useCallback(async () => {
    if (!session) return;
    const data = await callAction(url, key, session, "profile");
    if (data.profile) {
      setOnlineProfile(data.profile);
      publishAccountProfile(data.profile);
    }
  }, [session, url, key]);

  const refreshGame = useCallback(async () => {
    if (!session || !game?.id || refreshInFlightRef.current || document.visibilityState === "hidden") return;
    refreshInFlightRef.current = true;
    try {
      const data = await callAction(url, key, session, "get", { gameId: game.id });
      if (data.game) setGame(data.game);
      setLastSync(Date.now());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [session, game?.id, url, key]);

  useEffect(() => { setSoundEnabled(preferences.soundEnabled); }, [preferences.soundEnabled]);

  const updatePreference = <K extends keyof GameplayPreferences>(key: K, value: GameplayPreferences[K]) => {
    const next = updateGameplayPreferences(preferences, { [key]: value });
    setPreferences(next);
    setSoundEnabled(next.soundEnabled);
  };

  useEffect(() => {
    const setOnline = () => setConnectionOnline(true);
    const setOffline = () => setConnectionOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setConnectionOnline(navigator.onLine);
        void refreshGame();
      }
    };
    window.addEventListener("online", setOnline);
    window.addEventListener("offline", setOffline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", setOnline);
      window.removeEventListener("offline", setOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshGame]);

  const refreshInvitations = useCallback(async () => {
    if (!session || game) return;
    try {
      const data = await callAction(url, key, session, "list_invitations");
      setInvitations(data.invitations ?? []);
    } catch { /* inbox polling is best-effort */ }
  }, [session, game]);

  useEffect(() => {
    if (!game || game.status === "completed" || !session) return;
    const timer = window.setInterval(() => { void refreshGame(); }, 1400);
    return () => window.clearInterval(timer);
  }, [game?.id, game?.status, session, refreshGame]);

  useEffect(() => {
    if (!session || game) return;
    void refreshInvitations();
    const timer = window.setInterval(() => { void refreshInvitations(); }, 3500);
    return () => window.clearInterval(timer);
  }, [session, game?.id, refreshInvitations]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const findMatch = useCallback(async () => {
    if (!session || searchBusyRef.current) return;
    searchBusyRef.current = true;
    try {
      const [minutes, increment] = timeControl.split("+").map(Number);
      const data = await callAction(url, key, session, "find_match", { minutes, increment, rated });
      if (data.game) {
        setGame(data.game);
        setSearching(false);
        setNotice("Соперник найден. Удачной партии!");
        localStorage.setItem(GAME_KEY, data.game.id);
      } else {
        setSearching(true);
      }
      setError(null);
    } catch (reason) {
      setSearching(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { searchBusyRef.current = false; }
  }, [session, timeControl, url, key]);

  useEffect(() => {
    if (!searching || !session || game) return;
    const timer = window.setInterval(() => { void findMatch(); }, 2200);
    return () => window.clearInterval(timer);
  }, [searching, session, game?.id, findMatch]);

  const stopSearch = async () => {
    if (!session) return;
    setSearching(false);
    try {
      const data = await callAction(url, key, session, "cancel_match");
      if (data.game) rememberGame(data.game);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  const myColor = session && game ? (game.white_id === session.user.id ? "w" : game.black_id === session.user.id ? "b" : null) : null;
  const turn = useMemo(() => {
    if (!game) return null;
    try { return new Chess(game.fen).turn(); } catch { return null; }
  }, [game?.fen]);
  const activeElapsed = game?.turn_started_at ? Math.max(0, now - new Date(game.turn_started_at).getTime()) : 0;
  const whiteClock = game ? game.white_ms - (turn === "w" ? activeElapsed : 0) : 0;
  const blackClock = game ? game.black_ms - (turn === "b" ? activeElapsed : 0) : 0;

  useEffect(() => {
    timeoutRequestedRef.current = false;
  }, [game?.fen, game?.status]);

  useEffect(() => {
    setPremove(null);
    movePendingRef.current = false;
    setMovePending(false);
    setBoardFlipped(false);
    premoveGameIdRef.current = null;
  }, [game?.id]);

  // Apply a premove only after the authoritative server FEN says it is our turn.
  useEffect(() => {
    if (!premove || !game || premoveGameIdRef.current !== game.id || game.status !== "active" || !myColor || turn !== myColor || movePending) return;
    const resolved = resolvePremove(game.fen, myColor, premove);
    setPremove(null);
    if (!resolved) {
      setNotice("Premove отменён: ход соперника сделал его нелегальным.");
      playSound("wrong");
      return;
    }
    setNotice("Premove отправлен автоматически: " + resolved.san);
    sendMove(resolved, true);
  }, [premove, game?.id, game?.fen, game?.status, myColor, turn, movePending]);
  useEffect(() => {
    if (!session || !game || game.status !== "active" || timeoutRequestedRef.current) return;
    const expired = (turn === "w" && whiteClock <= 0) || (turn === "b" && blackClock <= 0);
    if (!expired || now - timeoutLastAttemptRef.current < 2500) return;
    timeoutRequestedRef.current = true;
    timeoutLastAttemptRef.current = now;
    void callAction(url, key, session, "timeout", { gameId: game.id })
      .then((data) => { if (data.game) setGame(data.game); })
      .catch((reason: unknown) => {
        timeoutRequestedRef.current = false;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, [session, game?.id, game?.fen, game?.status, turn, whiteClock, blackClock, now, url, key]);

  const isMyTurn = !!game && game.status === "active" && !!myColor && turn === myColor && !movePending;
  const canQueuePremove = !!game && game.status === "active" && !!myColor && turn !== myColor && preferences.premovesEnabled && !movePending;
  const myRating = game && myColor === "w" ? game.white_rating : game?.black_rating;
  const opponentName = game && myColor === "w" ? (game.black_name ?? "Ожидаем игрока") : game?.white_name ?? "Соперник";
  const ratingType = game?.rating_type ?? "blitz";

  const rememberGame = (next: OnlineGame) => {
    setGame(next);
    localStorage.setItem(GAME_KEY, next.id);
    setSearching(false);
    setError(null);
  };
  const createGame = async () => {
    if (!session || !onlineProfile) return;
    setBusy(true); setError(null);
    try {
      const [minutes, increment] = timeControl.split("+").map(Number);
      const data = await callAction(url, key, session, "create", { username: onlineProfile.username, minutes, increment, rated });
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
    if (!session || !onlineProfile || !inviteCode.trim()) return;
    setBusy(true); setError(null);
    try {
      const data = await callAction(url, key, session, "join", { inviteCode: inviteCode.trim().toUpperCase(), username: onlineProfile.username });
      if (!data.game) throw new Error(data.error || "Не удалось присоединиться к партии.");
      rememberGame(data.game);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  };
  const sendChallenge = async () => {
    if (!session || !inviteUsername.trim()) return;
    setBusy(true); setError(null);
    try {
      const [minutes, increment] = timeControl.split("+").map(Number);
      const data = await callAction(url, key, session, "challenge_player", { username: inviteUsername.trim(), minutes, increment, rated });
      if (!data.sent) throw new Error(data.error || "Не удалось отправить вызов.");
      if (data.game) {
        setInviteTarget(inviteUsername.trim().toLowerCase());
        rememberGame(data.game);
      }
      setNotice("Приглашение отправлено игроку @" + inviteUsername.trim().toLowerCase() + ". Ожидаем ответа.");
      setInviteUsername("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  };
  const acceptInvitation = async (inviteId: string) => {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      const data = await callAction(url, key, session, "accept_invitation", { inviteId });
      if (!data.game) throw new Error("Сервер не вернул партию.");
      rememberGame(data.game);
      setInvitations([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      void refreshInvitations();
    } finally { setBusy(false); }
  };
  const declineInvitation = async (inviteId: string) => {
    if (!session) return;
    try {
      await callAction(url, key, session, "decline_invitation", { inviteId });
      setInvitations((items) => items.filter((item) => item.id !== inviteId));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const sendMove = (move: BoardMove, isPremove = false): boolean => {
    if (!session || !game || !isMyTurn || movePendingRef.current) return false;
    movePendingRef.current = true;
    setMovePending(true);
    void callAction(url, key, session, "move", { gameId: game.id, uci: move.uci, premove: isPremove })
      .then((data) => {
        if (data.game) setGame(data.game);
        playSound(soundForSan(move.san));
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => {
        movePendingRef.current = false;
        setMovePending(false);
      });
    return true;
  };
  const resign = async () => {
    if (!session || !game) return;
    if (preferences.confirmResign && !window.confirm("Сдаться в этой партии?")) return;
    premoveGameIdRef.current = null;
    setPremove(null);
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
    } catch { setError("Не удалось скопировать ссылку. Код приглашения: " + game.invite_code); }
  };
  const exportPgn = () => {
    if (!game) return;
    try {
      const pgn = buildPgnFromUci(game.moves, { Event: "CHESSMART Online", White: game.white_name, Black: game.black_name ?? "Соперник", Result: game.result === "white_win" ? "1-0" : game.result === "black_win" ? "0-1" : game.result === "draw" ? "1/2-1/2" : "*" });
      downloadTextFile(pgn, pgnFilename("chessmart-online"));
      setExportNotice("PGN скачан.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const copyPgn = async () => {
    if (!game) return;
    try {
      const pgn = buildPgnFromUci(game.moves, { Event: "CHESSMART Online", White: game.white_name, Black: game.black_name ?? "Соперник" });
      setExportNotice(await copyText(pgn) ? "PGN скопирован." : "Не удалось скопировать PGN.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const copyFen = async () => {
    if (!game) return;
    setExportNotice(await copyText(game.fen) ? "FEN скопирован." : "Не удалось скопировать FEN.");
  };
  const copyMoves = async () => {
    if (!game) return;
    setExportNotice(await copyText(formatSanMoveList(game.moves.map((move) => move.san))) ? "Список ходов скопирован." : "Не удалось скопировать ходы.");
  };

  const clearGame = () => {
    premoveGameIdRef.current = null;
    setPremove(null);
    localStorage.removeItem(GAME_KEY);
    setGame(null);
    setInviteTarget("");
    setInviteCode("");
    const next = new URL(window.location.href);
    next.searchParams.delete("challenge");
    window.history.replaceState({}, "", next.toString());
    void refreshProfile();
  };

  if (!configured) {
    return (
      <main className="min-h-screen bg-[#262522] p-4 text-[#f0f0ed] sm:p-7">
        <div className="mx-auto max-w-3xl">
          <button onClick={onBack} className="mb-5 rounded-lg border border-[#474640] bg-[#33322e] px-4 py-2 text-sm font-bold">Назад</button>
          <section className="rounded-2xl border border-[#41403a] bg-[#30302b] p-6 sm:p-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#a3c86d]">Chessmart online</p>
            <h1 className="mt-2 text-3xl font-black">Аккаунты и онлайн-шахматы</h1>
            <p className="mt-3 text-sm leading-relaxed text-[#b8b7b0]">Render Static Site оставляем как есть. Для аккаунтов, рейтинга и поиска нужен Supabase backend. Добавь VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в Environment своего Static Site и разверни серверную функцию.</p>
            <button onClick={onBack} className="mt-5 rounded-lg bg-[#81b64c] px-5 py-3 text-sm font-extrabold text-[#17210f]">Назад</button>
          </section>
        </div>
      </main>
    );
  }
  if (authBusy) return <main className="min-h-screen bg-[#262522] p-8 text-center text-sm text-[#b8b7b0]">Подключаем аккаунт…</main>;

  if (!session || !onlineProfile) {
    return (
      <main className="min-h-screen bg-[#262522] p-4 text-[#f0f0ed] sm:p-7">
        <div className="mx-auto max-w-xl">
          <header className="mb-6 flex items-center justify-between">
            <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#a3c86d]">Chessmart account</p><h1 className="mt-1 text-2xl font-black">Твой шахматный аккаунт</h1></div>
            <button onClick={onBack} className="rounded-lg border border-[#474640] bg-[#33322e] px-4 py-2 text-xs font-bold">Назад</button>
          </header>
          <section className="rounded-2xl border border-[#41403a] bg-[#30302b] p-5 sm:p-7">
            <div className="mb-5 grid grid-cols-2 rounded-lg bg-[#22231f] p-1">
              <button onClick={() => { setAuthMode("login"); setError(null); }} className={"rounded-md py-2.5 text-sm font-bold " + (authMode === "login" ? "bg-[#81b64c] text-[#17210f]" : "text-[#aaa9a2]")}>Войти</button>
              <button onClick={() => { setAuthMode("register"); setError(null); }} className={"rounded-md py-2.5 text-sm font-bold " + (authMode === "register" ? "bg-[#81b64c] text-[#17210f]" : "text-[#aaa9a2]")}>Создать аккаунт</button>
            </div>
            <label className="block text-xs font-bold text-[#cbc9c1]" htmlFor="account-username">Ник</label>
            <input id="account-username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 18))} placeholder="например, chessking" className="mt-2 w-full rounded-lg border border-[#4a4942] bg-[#22231f] px-3 py-3 text-sm outline-none focus:border-[#81b64c]" />
            <p className="mt-1 text-[10px] text-[#85847d]">3–18 символов: латиница, цифры и подчёркивание. По нику тебя смогут найти другие игроки.</p>
            {authMode === "register" && (
              <div className="mt-4 rounded-xl border border-[#4a5940] bg-[#262b23] p-3">
                <div className="flex items-center gap-3">
                  {avatarPreview
                    ? <img src={avatarPreview} alt="Предпросмотр аватара" className="h-14 w-14 rounded-xl object-cover" />
                    : <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#3d5033] text-xl font-black text-[#d9edc4]">?</div>}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-[#e3ecd9]">Аватар профиля</div>
                    <div className="mt-1 text-[10px] text-[#929b89]">Необязательно · изображение будет обрезано по центру</div>
                    <button type="button" onClick={() => avatarInputRef.current?.click()} className="mt-2 rounded-lg bg-[#3d5033] px-3 py-1.5 text-[11px] font-bold text-[#e3ecd9]">Выбрать фото</button>
                  </div>
                </div>
                <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { selectAvatar(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
              </div>
            )}
            <label className="mt-4 block text-xs font-bold text-[#cbc9c1]" htmlFor="account-password">Пароль</label>
            <input id="account-password" type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void authenticate(); }} placeholder="Минимум 8 символов" className="mt-2 w-full rounded-lg border border-[#4a4942] bg-[#22231f] px-3 py-3 text-sm outline-none focus:border-[#81b64c]" />
            {authMode === "register" && <p className="mt-3 text-[10px] leading-relaxed text-[#85847d]">Аккаунт создаётся по нику и паролю без email. Пока восстановление забытого пароля не подключено — обязательно сохрани пароль.</p>}
            {error && <div role="alert" className="mt-4 rounded-lg border border-[#814c45] bg-[#432a27] p-3 text-xs text-[#ffd2cd]">{error}</div>}
            {notice && <div className="mt-4 rounded-lg border border-[#557b3d] bg-[#293a25] p-3 text-xs text-[#d7edbd]">{notice}</div>}
            <button onClick={() => void authenticate()} disabled={busy || username.length < 3 || password.length < 8} className="mt-5 w-full rounded-lg bg-[#81b64c] py-3 text-sm font-extrabold text-[#17210f] disabled:opacity-40">{busy ? "Подключаемся…" : authMode === "register" ? "Создать аккаунт" : "Войти в CHESSMART"}</button>
          </section>
          <p className="mt-3 text-center text-[10px] leading-relaxed text-[#77766f]">Аккаунт и рейтинг хранятся на сервере. Локальная статистика против Stockfish и Puzzle Rating остаются отдельными.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#262522] p-4 text-[#f0f0ed] sm:p-7">
      <div className="mx-auto max-w-[1240px]">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#a3c86d]">Chessmart online</p>
            <h1 className="mt-1 text-2xl font-extrabold">Играть онлайн</h1>
            <p className="mt-1 text-sm text-[#a6a59f]">Аккаунт @{onlineProfile.username} · серверный рейтинг</p>
          </div>
          <div className="flex gap-2">
            <button onClick={signOut} className="rounded-lg border border-[#474640] bg-[#33322e] px-3 py-2 text-xs font-bold">Выйти</button>
            <button onClick={onBack} className="rounded-lg border border-[#474640] bg-[#33322e] px-3 py-2 text-xs font-bold">Назад</button>
          </div>
        </header>

        <section className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-[#414d39] bg-[#30382c] p-3">
          {avatarPreview
            ? <img src={avatarPreview} alt="Предпросмотр аватара" className="h-14 w-14 rounded-xl object-cover" />
            : onlineProfile.avatar_url
              ? <img src={onlineProfile.avatar_url} alt={"Аватар " + onlineProfile.username} className="h-14 w-14 rounded-xl object-cover" />
              : <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#526d3e] text-xl font-black text-white">{onlineProfile.username.slice(0, 1).toUpperCase()}</div>}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-extrabold">Аватар профиля</div>
            <div className="mt-1 text-[10px] text-[#a6b19b]">Фото видно в профиле и навигации CHESSMART</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => avatarInputRef.current?.click()} className="rounded-lg border border-[#657a51] bg-[#3d5033] px-3 py-1.5 text-[11px] font-bold">Выбрать фото</button>
              {avatarFile && <button type="button" disabled={avatarBusy} onClick={() => {
                if (!session || !avatarFile) return;
                setAvatarBusy(true);
                void saveAvatar(avatarFile, session).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setAvatarBusy(false));
              }} className="rounded-lg bg-[#81b64c] px-3 py-1.5 text-[11px] font-extrabold text-[#17210f] disabled:opacity-50">{avatarBusy ? "Загружаем…" : "Сохранить аватар"}</button>}
            </div>
          </div>
          <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { selectAvatar(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
        </section>
        {error && <section role="alert" className="mb-4 rounded-xl border border-[#81504a] bg-[#402b28] p-3 text-sm text-[#ffd2cd]">{error}</section>}
        {notice && !game && <section className="mb-4 rounded-xl border border-[#6b814a] bg-[#303c28] p-3 text-sm text-[#d7edbd]">{notice}</section>}

        {!game ? (
          <>
            <section className="mb-4 grid grid-cols-3 gap-2">
              {([
                ["Bullet", onlineProfile.bullet_rating, onlineProfile.bullet_games],
                ["Blitz", onlineProfile.blitz_rating, onlineProfile.blitz_games],
                ["Rapid", onlineProfile.rapid_rating, onlineProfile.rapid_games],
              ] as const).map(([label, value, games]) => (
                <div key={label} className="rounded-xl border border-[#41403a] bg-[#30302b] p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-[#99988f]">{label}</div>
                  <div className="mt-1 text-2xl font-black tabular-nums">{value}</div>
                  <div className="mt-0.5 text-[10px] text-[#77766f]">{games} партий</div>
                </div>
              ))}
            </section>

            <section className="mb-4 rounded-xl border border-[#41403a] bg-[#30302b] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="text-sm font-extrabold">Контроль времени</h2><p className="mt-1 text-[10px] text-[#93928b]">Для поиска соперника и вызова по нику</p></div>
                <label className="flex items-center gap-2 text-xs text-[#bdbcb5]"><input type="checkbox" checked={rated} onChange={(e) => setRated(e.target.checked)} className="accent-[#81b64c]" /> Рейтинговая</label>
              </div>
              <select value={timeControl} onChange={(e) => setTimeControl(e.target.value)} disabled={searching} className="w-full rounded-lg border border-[#4a4942] bg-[#242520] px-3 py-3 text-sm sm:max-w-xs">
                {["1+0", "2+1", "3+0", "3+2", "5+0", "5+3", "10+0", "10+5", "15+10"].map((value) => <option key={value} value={value}>{value.replace("+", " + ")} · {Number(value.split("+")[0]) < 3 ? "Bullet" : Number(value.split("+")[0]) < 10 ? "Blitz" : "Rapid"}</option>)}
              </select>
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-xl border border-[#41403a] bg-[#30302b] p-5">
                <h2 className="text-lg font-extrabold">Найти соперника</h2>
                <p className="mt-1 text-xs leading-relaxed text-[#a6a59f]">Система ищет живого игрока с похожим рейтингом. Чем дольше поиск, тем шире допустимый диапазон Elo.</p>
                {!searching ? (
                  <button onClick={() => { setError(null); setSearching(true); void findMatch(); }} disabled={busy} className="mt-5 w-full rounded-lg bg-[#81b64c] px-4 py-3 text-sm font-extrabold text-[#17210f] disabled:opacity-40">Найти соперника</button>
                ) : (
                  <div className="mt-5 rounded-lg border border-[#596d47] bg-[#293625] p-3">
                    <div className="flex items-center gap-2 text-sm font-bold text-[#d7edbd]"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#9ccf6d]" />Ищем соперника…</div>
                    <p className="mt-1 text-xs text-[#a9bb98]">Подбираем игрока близкого рейтинга. Окно поиска постепенно расширяется.</p>
                    <button onClick={() => void stopSearch()} className="mt-3 w-full rounded-lg border border-[#637451] px-3 py-2 text-xs font-bold text-[#d7edbd]">Отменить поиск</button>
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-[#41403a] bg-[#30302b] p-5">
                <h2 className="text-lg font-extrabold">Вызвать по нику</h2>
                <p className="mt-1 text-xs leading-relaxed text-[#a6a59f]">Введи ник друга. Ему придёт приглашение в CHESSMART.</p>
                <input value={inviteUsername} onChange={(e) => setInviteUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 18))} onKeyDown={(e) => { if (e.key === "Enter") void sendChallenge(); }} placeholder="Ник друга" className="mt-4 w-full rounded-lg border border-[#4a4942] bg-[#242520] px-3 py-3 text-sm outline-none focus:border-[#81b64c]" />
                <button onClick={() => void sendChallenge()} disabled={busy || inviteUsername.length < 3} className="mt-3 w-full rounded-lg border border-[#66834a] bg-[#39462e] px-4 py-3 text-sm font-extrabold text-[#d7edbd] disabled:opacity-40">Отправить вызов</button>
              </section>

              <section className="rounded-xl border border-[#41403a] bg-[#30302b] p-5">
                <h2 className="text-lg font-extrabold">Создать комнату</h2>
                <p className="mt-1 text-xs leading-relaxed text-[#a6a59f]">Для друзей, которым удобнее отправить ссылку или код.</p>
                <button onClick={() => void createGame()} disabled={busy} className="mt-4 w-full rounded-lg border border-[#4a4942] bg-[#393831] px-4 py-3 text-sm font-bold hover:bg-[#45443c]">Создать приглашение по ссылке</button>
                <div className="mt-4 flex gap-2">
                  <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))} placeholder="Код игры" className="min-w-0 flex-1 rounded-lg border border-[#4a4942] bg-[#242520] px-3 py-2.5 font-mono text-sm tracking-[0.16em] outline-none focus:border-[#81b64c]" />
                  <button onClick={() => void joinGame()} disabled={busy || inviteCode.trim().length < 5} className="rounded-lg bg-[#81b64c] px-3 py-2.5 text-xs font-extrabold text-[#17210f] disabled:opacity-40">Войти</button>
                </div>
              </section>

              <section className="rounded-xl border border-[#41403a] bg-[#30302b] p-5">
                <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-lg font-extrabold">Входящие вызовы</h2><span className="rounded-md bg-[#242520] px-2 py-1 text-[10px] text-[#aaa9a2]">{invitations.length}</span></div>
                {invitations.length ? (
                  <div className="space-y-2">
                    {invitations.map((item) => <div key={item.id} className="rounded-lg bg-[#242520] p-3">
                      <div className="text-sm font-bold">@{item.game.white_name}</div>
                      <div className="mt-1 text-[10px] text-[#93928b]">{typeLabel(item.game.rating_type)} · {item.game.minutes}+{item.game.increment_seconds}</div>
                      <div className="mt-3 flex gap-2"><button onClick={() => void acceptInvitation(item.id)} disabled={busy} className="flex-1 rounded-md bg-[#81b64c] px-2 py-2 text-xs font-extrabold text-[#17210f]">Принять</button><button onClick={() => void declineInvitation(item.id)} className="rounded-md border border-[#55534b] px-3 py-2 text-xs font-bold text-[#bbb9b1]">Отклонить</button></div>
                    </div>)}
                  </div>
                ) : <p className="text-xs text-[#85847d]">Пока никто не вызвал тебя на партию.</p>}
              </section>
            </div>
          </>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
            <section className="rounded-xl border border-[#41403a] bg-[#30302b] p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div><div className="text-sm font-bold">{game.status === "waiting" ? "Ожидаем соперника" : opponentName}</div><div className="mt-0.5 text-xs text-[#9a9992]">{typeLabel(game.rating_type)} · {game.rated ? "Рейтинговая" : "Без рейтинга"}</div></div>
                <div className="rounded-md bg-[#242520] px-2 py-1 text-xs font-semibold text-[#c9c8c1]">{myColor === "w" ? "Вы играете белыми" : myColor === "b" ? "Вы играете чёрными" : "Ожидание"}</div>
              </div>
              <div className="mb-2 flex items-center justify-between rounded-lg bg-[#252621] px-3 py-2 text-sm"><span>{game.black_name ?? "Соперник"} <span className="text-xs text-[#85847d]">чёрные</span></span><b className={"font-mono text-xl tabular-nums " + (turn === "b" ? (clockUrgency(blackClock) === "critical" ? "text-[#ff7770]" : "text-white") : "text-[#aaa9a2]")}>{formatClock(blackClock, true)}</b></div>
              <GameBoard
                fen={game.fen}
                orientation={getBoardOrientation(myColor ?? "w", boardFlipped)}
                interactive={isMyTurn}
                allowedColor={myColor}
                onMove={(move) => sendMove(move, false)}
                premoveEnabled={canQueuePremove}
                premove={premove}
                onPremove={(next) => { premoveGameIdRef.current = game.id; setPremove(next); setNotice(""); }}
                onClearPremove={() => { premoveGameIdRef.current = null; setPremove(null); setNotice("Premove отменён."); }}
                theme={preferences.boardTheme}
                showLegalMoves={preferences.showLegalMoves}
                highlightLastMove={preferences.highlightLastMove}
                animations={preferences.boardAnimations}
                autoQueen={preferences.autoQueen}
              />
              <div className="mt-2 flex items-center justify-between rounded-lg bg-[#252621] px-3 py-2 text-sm"><span>{game.white_name} <span className="text-xs text-[#85847d]">белые</span></span><b className={"font-mono text-xl tabular-nums " + (turn === "w" ? (clockUrgency(whiteClock) === "critical" ? "text-[#ff7770]" : "text-white") : "text-[#aaa9a2]")}>{formatClock(whiteClock, true)}</b></div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={() => setBoardFlipped((value) => !value)} className="rounded-lg border border-[#4a4942] bg-[#393831] px-3 py-2.5 text-xs font-bold">Перевернуть доску</button>
                <button onClick={() => void copyFen()} className="rounded-lg border border-[#4a4942] bg-[#393831] px-3 py-2.5 text-xs font-bold">Скопировать FEN</button>
                <button onClick={() => void copyPgn()} disabled={!game.moves.length} className="rounded-lg border border-[#4a4942] bg-[#393831] px-3 py-2.5 text-xs font-bold disabled:opacity-40">Копировать PGN</button>
                <button onClick={exportPgn} disabled={!game.moves.length} className="rounded-lg border border-[#4a4942] bg-[#393831] px-3 py-2.5 text-xs font-bold disabled:opacity-40">Скачать PGN</button>
                <button onClick={() => void copyInvite()} className="rounded-lg bg-[#81b64c] px-4 py-2.5 text-xs font-extrabold text-[#17210f]">{copied ? "Ссылка скопирована" : "Скопировать приглашение"}</button>
                {game.status === "active" && <button onClick={() => void resign()} disabled={busy} className="rounded-lg border border-[#7d4a44] bg-[#422a27] px-4 py-2.5 text-xs font-bold text-[#ffd2cd]">Сдаться</button>}
                <button onClick={clearGame} className="ml-auto rounded-lg border border-[#4a4942] bg-[#393831] px-3 py-2.5 text-xs font-bold">В меню</button>
              </div>
            </section>
            <aside className="space-y-3">
              {game.status === "waiting" && <section className="rounded-xl border border-[#6b814a] bg-[#303c28] p-4"><div className="text-sm font-extrabold text-[#d7edbd]">Комната создана</div><div className="mt-2 font-mono text-2xl font-black tracking-[0.2em]">{game.invite_code}</div><p className="mt-2 text-xs text-[#b7cba0]">{inviteTarget ? "Вызов отправлен игроку @" + inviteTarget + ". Ожидаем, пока он примет приглашение." : "Отправь код или ссылку другу."}</p></section>}
              {game.status === "active" && <section className="rounded-xl border border-[#41403a] bg-[#30302b] p-4"><div className="text-sm font-bold">Статус партии</div><p className="mt-2 text-sm text-[#c9c8c1]">{isMyTurn ? "Ваш ход" : "Ход соперника"}{movePending ? " · отправляем ход…" : ""}</p><p className={"mt-2 text-[10px] " + (connectionOnline ? "text-[#9acb72]" : "text-[#ff7770]")}>{connectionOnline ? "Соединение активно" : "Нет соединения"} · синхронизация {Math.max(0, Math.floor((now - lastSync) / 1000))} сек. назад</p>{canQueuePremove && <p className="mt-2 text-xs text-[#ff9b94]">Можно поставить premove — он будет проверен после ответа соперника.</p>}<p className="mt-2 text-xs text-[#a3c86d]">Рейтинг {typeLabel(ratingType)}: {myRating ?? "—"}</p></section>}
              {game.status === "completed" && <section className="rounded-xl border border-[#6b814a] bg-[#303c28] p-4"><div className="text-lg font-extrabold">{resultText(game, myColor)}</div><p className="mt-2 text-sm text-[#d7edbd]">{reasonText(game.reason)}</p><p className="mt-2 text-xs text-[#b7cba0]">Рейтинг после партии: {myRating ?? "—"}</p></section>}
              <section className="rounded-xl border border-[#41403a] bg-[#30302b] p-4">
                <div className="mb-2 text-sm font-bold">Настройки доски</div>
                <div className="space-y-2 text-xs text-[#c2c0b8]">
                  <label className="flex items-center justify-between gap-2"><span>Разрешить premove</span><input type="checkbox" checked={preferences.premovesEnabled} onChange={(e) => updatePreference("premovesEnabled", e.target.checked)} className="accent-[#81b64c]" /></label>
                  <label className="flex items-center justify-between gap-2"><span>Звук ходов</span><input type="checkbox" checked={preferences.soundEnabled} onChange={(e) => updatePreference("soundEnabled", e.target.checked)} className="accent-[#81b64c]" /></label>
                  <label className="flex items-center justify-between gap-2"><span>Подсветка легальных ходов</span><input type="checkbox" checked={preferences.showLegalMoves} onChange={(e) => updatePreference("showLegalMoves", e.target.checked)} className="accent-[#81b64c]" /></label>
                  <label className="flex items-center justify-between gap-2"><span>Последний ход</span><input type="checkbox" checked={preferences.highlightLastMove} onChange={(e) => updatePreference("highlightLastMove", e.target.checked)} className="accent-[#81b64c]" /></label>
                  <label className="flex items-center justify-between gap-2"><span>Анимации фигур</span><input type="checkbox" checked={preferences.boardAnimations} onChange={(e) => updatePreference("boardAnimations", e.target.checked)} className="accent-[#81b64c]" /></label>
                  <label className="flex items-center justify-between gap-2"><span>Подтверждать сдачу</span><input type="checkbox" checked={preferences.confirmResign} onChange={(e) => updatePreference("confirmResign", e.target.checked)} className="accent-[#81b64c]" /></label>
                  <label className="flex items-center justify-between gap-2"><span>Цвет доски</span><select value={preferences.boardTheme} onChange={(e) => updatePreference("boardTheme", e.target.value as GameplayPreferences["boardTheme"])} className="rounded-md bg-[#242520] px-2 py-1"><option value="classic">Классическая</option><option value="blue">Синяя</option><option value="walnut">Ореховая</option><option value="violet">Фиолетовая</option></select></label>
                </div>
              </section>
              <section className="rounded-xl border border-[#41403a] bg-[#30302b] p-4">
                <div className="mb-2 flex items-center justify-between gap-2"><span className="text-sm font-bold">Ходы</span><button onClick={() => void copyMoves()} disabled={!game.moves.length} className="rounded-md bg-[#3d3a37] px-2 py-1 text-[10px] font-bold disabled:opacity-40">Копировать</button></div>
                <div className="max-h-72 overflow-y-auto text-xs leading-7 text-[#c9c8c1]">
                  {game.moves.length ? game.moves.map((move, index) => <span key={move.at + move.uci} className="mr-2 inline-block"><span className="text-[#77766f]">{Math.floor(index / 2) + 1}{move.color === "w" ? "." : "…"}</span> {move.premove && <span title="Автоматический premove" className="text-[#ff7770]">▶ </span>}{move.san}</span>) : <span className="text-[#85847d]">Пока нет ходов.</span>}
                </div>
                {premove && (
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-[#8b4444] bg-[#3c2928] px-3 py-2 text-xs text-[#ffd4d1]">
                    <span>Ожидающий premove: <b>{formatPremove(premove)}</b></span>
                    <button type="button" onClick={() => { premoveGameIdRef.current = null; setPremove(null); setNotice("Premove отменён."); }} className="rounded-md border border-[#a95a55] px-2 py-1 font-bold">Отменить</button>
                  </div>
                )}
                {exportNotice && <p role="status" className="mt-2 text-xs text-[#a3d160]">{exportNotice}</p>}
              </section>
              <p className="px-1 text-[10px] leading-relaxed text-[#77766f]">Во время рейтинговой партии не используй подсказки движка. Ходы и результат проверяются сервером.</p>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}