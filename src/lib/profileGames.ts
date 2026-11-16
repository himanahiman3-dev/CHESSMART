import { Chess } from "chess.js";

export type ChessPlatform = "lichess" | "chesscom";
export type GameOutcome = "win" | "loss" | "draw" | "unknown";

export interface ProfileGame {
  id: string;
  platform: ChessPlatform;
  date: string;
  white: string;
  black: string;
  opponent: string;
  color: "white" | "black" | "unknown";
  moves: number;
  halfMoves: number;
  outcome: GameOutcome;
  result: string;
  pgn: string;
  url?: string;
}

export interface ProfileGamesProgress {
  done: number;
  total: number;
  label: string;
}

const MAX_LICHESS_BATCH = 3000;
const MAX_SPLIT_DEPTH = 32;

function abortError(): Error {
  return new DOMException("Загрузка отменена", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function splitPgnCollection(text: string): string[] {
  const source = text.trim();
  if (!source) return [];
  const starts = Array.from(source.matchAll(/^\[Event\s+/gm), (m) => m.index ?? -1).filter((i) => i >= 0);
  if (starts.length <= 1) return [source];
  return starts
    .map((start, i) => source.slice(start, starts[i + 1] ?? source.length).trim())
    .filter(Boolean);
}

function headerValue(headers: Record<string, string>, key: string): string {
  return headers[key] ?? "";
}

function dateFromHeaders(headers: Record<string, string>): string {
  const raw = headerValue(headers, "Date");
  if (raw && !raw.includes("?")) return raw.replace(/\./g, "-");
  return raw || "Дата неизвестна";
}

function resultForPlayer(result: string, color: "white" | "black" | "unknown"): GameOutcome {
  if (result === "1/2-1/2") return "draw";
  if (result !== "1-0" && result !== "0-1") return "unknown";
  if (color === "unknown") return "unknown";
  const whiteWon = result === "1-0";
  return (color === "white") === whiteWon ? "win" : "loss";
}

function normalizedUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLocaleLowerCase();
}

function gameFromPgn(
  pgn: string,
  platform: ChessPlatform,
  username: string,
  fallbackId: string,
  metadata?: { url?: string; endTime?: number; white?: string; black?: string; whiteResult?: string; blackResult?: string }
): ProfileGame | null {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    const h = chess.header() as Record<string, string | null>;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(h)) if (value) headers[key] = value;

    const white = metadata?.white || headers.White || "Белые";
    const black = metadata?.black || headers.Black || "Чёрные";
    const user = normalizedUsername(username);
    const color: ProfileGame["color"] = normalizedUsername(white) === user ? "white" : normalizedUsername(black) === user ? "black" : "unknown";
    const result = headers.Result || (metadata?.whiteResult === "win" ? "1-0" : metadata?.blackResult === "win" ? "0-1" : "*");
    const halfMoves = chess.history().length;
    const site = headers.Site || metadata?.url || "";
    const idMatch = site.match(/(?:lichess\.org\/|chess\.com\/game\/[^/]+\/)([A-Za-z0-9_-]{6,})/i);
    const id = idMatch?.[1] ?? fallbackId;

    let outcome = resultForPlayer(result, color);
    if (metadata && color !== "unknown") {
      const direct = color === "white" ? metadata.whiteResult : metadata.blackResult;
      if (direct === "win") outcome = "win";
      else if (["checkmated", "resigned", "timeout", "lose", "abandoned"].includes(direct ?? "")) outcome = "loss";
      else if (["agreed", "repetition", "stalemate", "insufficient", "50move", "threecheck", "draw"].includes(direct ?? "")) outcome = "draw";
    }

    const opponent = color === "white" ? black : color === "black" ? white : `${white} — ${black}`;
    return {
      id,
      platform,
      date: metadata?.endTime ? new Date(metadata.endTime * 1000).toISOString().slice(0, 10) : dateFromHeaders(headers),
      white,
      black,
      opponent,
      color,
      moves: Math.ceil(halfMoves / 2),
      halfMoves,
      outcome,
      result,
      pgn,
      url: metadata?.url || (site.startsWith("http") ? site : undefined),
    };
  } catch {
    return null;
  }
}

async function fetchLichessRange(
  username: string,
  since: number,
  until: number,
  signal: AbortSignal | undefined,
  onProgress: (p: ProfileGamesProgress) => void,
  splitDepth = 0
): Promise<string[]> {
  throwIfAborted(signal);
  const params = new URLSearchParams({
    max: String(MAX_LICHESS_BATCH),
    since: String(since),
    until: String(until),
    sort: "dateAsc",
    moves: "true",
    tags: "true",
    clocks: "false",
    evals: "false",
    opening: "true",
    ongoing: "false",
    finished: "true",
  });
  const response = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(username)}?${params}`, {
    signal,
    headers: { Accept: "application/x-chess-pgn" },
  });
  if (response.status === 404) throw new Error(`Профиль Lichess «${username}» не найден или закрыт.`);
  if (response.status === 429) throw new Error("Lichess временно ограничил запросы (429). Попробуй ещё раз чуть позже.");
  if (!response.ok) throw new Error(`Lichess вернул ошибку ${response.status}.`);
  const pgn = await response.text();
  const games = splitPgnCollection(pgn);
  onProgress({ done: 0, total: 0, label: `Получено ${games.length} партий из интервала…` });

  // Lichess ограничивает один экспорт размером партии. Если упёрлись в предел,
  // режем период пополам и забираем обе части, пока не получим полную историю.
  if (games.length < MAX_LICHESS_BATCH) return games;
  if (splitDepth >= MAX_SPLIT_DEPTH || until - since < 60_000) {
    throw new Error("В одном временном интервале слишком много партий для полного экспорта. Уточни период истории.");
  }
  const middle = Math.floor((since + until) / 2);
  const older = await fetchLichessRange(username, since, middle, signal, onProgress, splitDepth + 1);
  const newer = await fetchLichessRange(username, middle + 1, until, signal, onProgress, splitDepth + 1);
  return [...older, ...newer];
}

async function fetchLichessGames(
  username: string,
  signal: AbortSignal | undefined,
  onProgress: (p: ProfileGamesProgress) => void
): Promise<ProfileGame[]> {
  const allPgn = await fetchLichessRange(username, 0, Date.now(), signal, onProgress);
  const byId = new Map<string, ProfileGame>();
  allPgn.forEach((pgn, index) => {
    const game = gameFromPgn(pgn, "lichess", username, `lichess-${index}`);
    if (game) byId.set(game.id, game);
  });
  return Array.from(byId.values()).sort((a, b) => b.date.localeCompare(a.date));
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw new Error("Браузер не смог обратиться к Chess.com PubAPI. Проверь соединение или попробуй позже.");
  }
  if (response.status === 404) throw new Error("Chess.com не нашёл такой публичный профиль.");
  if (response.status === 429) throw new Error("Chess.com временно ограничил запросы (429). Попробуй ещё раз позже.");
  if (!response.ok) throw new Error(`Chess.com PubAPI вернул ошибку ${response.status}.`);
  return (await response.json()) as T;
}

interface ChessComArchives {
  archives?: string[];
}
interface ChessComArchive {
  games?: Array<{
    pgn?: string;
    url?: string;
    end_time?: number;
    white?: { username?: string; result?: string; rating?: number };
    black?: { username?: string; result?: string; rating?: number };
  }>;
}

async function fetchChessComGames(
  username: string,
  signal: AbortSignal | undefined,
  onProgress: (p: ProfileGamesProgress) => void
): Promise<ProfileGame[]> {
  const root = `https://api.chess.com/pub/player/${encodeURIComponent(username)}`;
  const archiveData = await fetchJson<ChessComArchives>(`${root}/games/archives`, signal);
  const archives = archiveData.archives ?? [];
  const games: ProfileGame[] = [];
  let done = 0;
  // Запросы идут последовательно: Chess.com предупреждает, что параллельные запросы
  // могут приводить к HTTP 429.
  for (const url of archives) {
    throwIfAborted(signal);
    const archive = await fetchJson<ChessComArchive>(url, signal);
    for (const [index, game] of (archive.games ?? []).entries()) {
      if (!game.pgn) continue;
      const parsed = gameFromPgn(game.pgn, "chesscom", username, `${url}-${index}`, {
        url: game.url,
        endTime: game.end_time,
        white: game.white?.username,
        black: game.black?.username,
        whiteResult: game.white?.result,
        blackResult: game.black?.result,
      });
      if (parsed) games.push(parsed);
    }
    done++;
    onProgress({ done, total: archives.length, label: `Архив ${done} из ${archives.length}` });
    if (done < archives.length) await sleep(120, signal);
  }
  const deduped = new Map<string, ProfileGame>();
  games.forEach((game) => deduped.set(game.id, game));
  return Array.from(deduped.values()).sort((a, b) => b.date.localeCompare(a.date));
}

export function detectPlatformAndUsername(input: string, preferred: ChessPlatform): { platform: ChessPlatform; username: string } {
  const text = input.trim();
  const lichess = text.match(/(?:lichess\.org\/(?:@\/)?)([A-Za-z0-9_-]+)/i);
  if (lichess) return { platform: "lichess", username: lichess[1] };
  const chessCom = text.match(/chess\.com\/(?:member|profile)\/([A-Za-z0-9_-]+)/i);
  if (chessCom) return { platform: "chesscom", username: chessCom[1] };
  const cleaned = text.replace(/^@/, "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(cleaned)) {
    throw new Error("Введи ник или ссылку на профиль Lichess / Chess.com.");
  }
  return { platform: preferred, username: cleaned };
}

export async function fetchProfileGames(
  input: string,
  preferredPlatform: ChessPlatform,
  signal?: AbortSignal,
  onProgress: (p: ProfileGamesProgress) => void = () => undefined
): Promise<ProfileGame[]> {
  const { platform, username } = detectPlatformAndUsername(input, preferredPlatform);
  const games = platform === "lichess"
    ? await fetchLichessGames(username, signal, onProgress)
    : await fetchChessComGames(username, signal, onProgress);
  if (!games.length) throw new Error("В публичной истории этого профиля не найдено партий с PGN.");
  return games;
}
