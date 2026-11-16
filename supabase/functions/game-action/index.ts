import { createClient } from "npm:@supabase/supabase-js@2";
import { Chess } from "npm:chess.js@1.4.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
type PlayerColor = "w" | "b";
type GameRow = Record<string, any>;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { ...CORS, "Content-Type": "application/json" },
});
const fail = (message: string, status = 400) => json({ error: message }, status);

function cleanName(value: unknown, fallback: string): string {
  const name = String(value ?? "").replace(/[^\p{L}\p{N}_ -]/gu, "").trim().slice(0, 24);
  return name || fallback;
}
function ratingField(type: string): string {
  return type === "bullet" ? "bullet_rating" : type === "blitz" ? "blitz_rating" : "rapid_rating";
}
function gamesField(type: string): string {
  return type === "bullet" ? "bullet_games" : type === "blitz" ? "blitz_games" : "rapid_games";
}
function ratingType(minutes: number, increment: number): string {
  const estimatedSeconds = minutes * 60 + increment * 40;
  return estimatedSeconds < 180 ? "bullet" : estimatedSeconds < 600 ? "blitz" : "rapid";
}
function makeCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = crypto.getRandomValues(new Uint8Array(7));
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}
async function authUser(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Нужна авторизация.");
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error("Сетевая сессия истекла. Перезагрузи страницу.");
  return data.user;
}
async function ensureProfile(userId: string, username: string) {
  const { data: existing } = await admin.from("online_profiles").select("*").eq("user_id", userId).maybeSingle();
  if (existing) {
    if (existing.username !== username) {
      const { error } = await admin.from("online_profiles").update({ username, updated_at: new Date().toISOString() }).eq("user_id", userId);
      if (error) throw new Error("Это имя уже занято. Измени имя профиля в Chessmart.");
      return { ...existing, username };
    }
    return existing;
  }
  let name = username;
  let { data, error } = await admin.from("online_profiles").insert({ user_id: userId, username: name }).select("*").single();
  if (error) {
    name = (username.slice(0, 18) + "_" + userId.slice(0, 4)).slice(0, 24);
    ({ data, error } = await admin.from("online_profiles").insert({ user_id: userId, username: name }).select("*").single());
  }
  if (error || !data) throw new Error("Не удалось создать сетевой профиль.");
  return data;
}
async function participantGame(gameId: string, userId: string): Promise<GameRow> {
  const { data, error } = await admin.from("online_games").select("*").eq("id", gameId).maybeSingle();
  if (error || !data) throw new Error("Партия не найдена.");
  if (data.white_id !== userId && data.black_id !== userId) throw new Error("Ты не участник этой партии.");
  return data;
}
async function updateRating(game: GameRow, _result: string) {
  if (!game.rated || !game.black_id) return game;
  const { data, error } = await admin.rpc("apply_online_game_rating", { p_game_id: game.id });
  if (error) throw new Error("Не удалось атомарно обновить рейтинг игроков: " + error.message);
  const updated = Array.isArray(data) ? data[0] : data;
  return updated ?? game;
}
async function finishGame(game: GameRow, result: string, reason: string, whiteMs = game.white_ms, blackMs = game.black_ms) {
  const now = new Date().toISOString();
  const { data, error } = await admin.from("online_games")
    .update({ status: "completed", result, reason, white_ms: Math.max(0, whiteMs), black_ms: Math.max(0, blackMs), turn_started_at: now, updated_at: now })
    .eq("id", game.id).eq("fen", game.fen).eq("status", game.status).select("*").maybeSingle();
  if (error || !data) throw new Error("Партия уже обновлена другим действием. Обнови доску.");
  return await updateRating(data, result);
}
function gameResult(chess: Chess): { result: string; reason: string } | null {
  if (chess.isCheckmate()) return { result: chess.turn() === "w" ? "black_win" : "white_win", reason: "checkmate" };
  if (chess.isStalemate()) return { result: "draw", reason: "stalemate" };
  if (chess.isInsufficientMaterial()) return { result: "draw", reason: "insufficient_material" };
  if (chess.isThreefoldRepetition()) return { result: "draw", reason: "threefold_repetition" };
  if (chess.isDraw()) return { result: "draw", reason: "draw" };
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("Используй POST.", 405);
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) return fail("Серверная функция не настроена.", 503);
    const user = await authUser(req);
    const body = await req.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    if (action === "create") {
      const minutes = Math.max(1, Math.min(60, Math.floor(Number(body.minutes) || 5)));
      const increment = Math.max(0, Math.min(60, Math.floor(Number(body.increment) || 0)));
      const name = cleanName(body.username, "Игрок-" + user.id.slice(0, 4));
      const profile = await ensureProfile(user.id, name);
      const type = ratingType(minutes, increment);
      let code = makeCode();
      for (let attempt = 0; attempt < 4; attempt++) {
        const { data: exists } = await admin.from("online_games").select("id").eq("invite_code", code).maybeSingle();
        if (!exists) break;
        code = makeCode();
      }
      const rated = body.rated !== false;
      const { data: game, error } = await admin.from("online_games").insert({
        invite_code: code, status: "waiting", white_id: user.id, black_id: null,
        white_name: profile.username, black_name: null, fen: START_FEN, moves: [],
        minutes, increment_seconds: increment, increment_ms: increment * 1000,
        white_ms: minutes * 60_000, black_ms: minutes * 60_000, turn_started_at: null,
        rated, rating_type: type, white_rating: profile[ratingField(type)], black_rating: null,
      }).select("*").single();
      if (error || !game) throw new Error("Не удалось создать комнату.");
      return json({ game });
    }
    if (action === "join") {
      const code = String(body.inviteCode ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
      if (code.length < 5) return fail("Введи корректный код приглашения.");
      const name = cleanName(body.username, "Игрок-" + user.id.slice(0, 4));
      const profile = await ensureProfile(user.id, name);
      const { data: waiting, error } = await admin.from("online_games").select("*").eq("invite_code", code).eq("status", "waiting").maybeSingle();
      if (error || !waiting) return fail("Комната не найдена или игра уже началась.", 404);
      if (waiting.white_id === user.id) return fail("Нельзя присоединиться к собственной комнате.");
      const now = new Date().toISOString();
      const { data: game, error: joinError } = await admin.from("online_games")
        .update({ black_id: user.id, black_name: profile.username, black_rating: profile[ratingField(waiting.rating_type)], status: "active", turn_started_at: now, updated_at: now })
        .eq("id", waiting.id).eq("status", "waiting").is("black_id", null).select("*").maybeSingle();
      if (joinError || !game) return fail("Соперник уже занял эту комнату.", 409);
      return json({ game });
    }
    if (action === "get") {
      const game = await participantGame(String(body.gameId ?? ""), user.id);
      return json({ game });
    }
    if (action === "move") {
      const game = await participantGame(String(body.gameId ?? ""), user.id);
      if (game.status !== "active" || !game.black_id) return fail("Партия сейчас не принимает ходы.");
      const chess = new Chess(game.fen);
      const color = chess.turn() as PlayerColor;
      const playerId = color === "w" ? game.white_id : game.black_id;
      if (playerId !== user.id) return fail("Сейчас ход соперника.", 409);
      const nowMs = Date.now();
      const elapsed = game.turn_started_at ? Math.max(0, nowMs - new Date(game.turn_started_at).getTime()) : 0;
      const whiteBefore = color === "w" ? Number(game.white_ms) - elapsed : Number(game.white_ms);
      const blackBefore = color === "b" ? Number(game.black_ms) - elapsed : Number(game.black_ms);
      if (whiteBefore <= 0 || blackBefore <= 0) {
        const result = whiteBefore <= 0 ? "black_win" : "white_win";
        const finished = await finishGame(game, result, "timeout", whiteBefore, blackBefore);
        return json({ game: finished });
      }
      const uci = String(body.uci ?? "");
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return fail("Некорректный формат хода.");
      let played;
      try {
        played = chess.move({ from: uci.slice(0, 2) as never, to: uci.slice(2, 4) as never, promotion: uci[4] as never });
      } catch { return fail("Нелегальный ход."); }
      if (!played) return fail("Нелегальный ход.");
      const nextWhite = color === "w" ? whiteBefore + Number(game.increment_ms) : whiteBefore;
      const nextBlack = color === "b" ? blackBefore + Number(game.increment_ms) : blackBefore;
      const move = { uci, san: played.san, color, at: new Date(nowMs).toISOString() };
      const moves = [...(Array.isArray(game.moves) ? game.moves : []), move];
      const outcome = gameResult(chess);
      if (outcome) {
        const { data, error } = await admin.from("online_games")
          .update({ fen: chess.fen(), moves, white_ms: nextWhite, black_ms: nextBlack, status: "completed", result: outcome.result, reason: outcome.reason, turn_started_at: new Date(nowMs).toISOString(), updated_at: new Date(nowMs).toISOString() })
          .eq("id", game.id).eq("fen", game.fen).eq("status", "active").select("*").maybeSingle();
        if (error || !data) return fail("Партия уже обновлена другим действием.", 409);
        return json({ game: await updateRating(data, outcome.result) });
      }
      const { data, error } = await admin.from("online_games")
        .update({ fen: chess.fen(), moves, white_ms: nextWhite, black_ms: nextBlack, turn_started_at: new Date(nowMs).toISOString(), updated_at: new Date(nowMs).toISOString() })
        .eq("id", game.id).eq("fen", game.fen).eq("status", "active").select("*").maybeSingle();
      if (error || !data) return fail("Позиция уже изменилась. Обнови доску.", 409);
      return json({ game: data });
    }
    if (action === "resign" || action === "timeout") {
      const game = await participantGame(String(body.gameId ?? ""), user.id);
      if (game.status !== "active" || !game.black_id) return fail("Партия уже завершена.");
      const color = game.white_id === user.id ? "w" : "b";
      let result = color === "w" ? "black_win" : "white_win";
      let reason = "resignation";
      let whiteMs = Number(game.white_ms);
      let blackMs = Number(game.black_ms);
      if (action === "timeout") {
        reason = "timeout";
        const elapsed = game.turn_started_at ? Math.max(0, Date.now() - new Date(game.turn_started_at).getTime()) : 0;
        if (new Chess(game.fen).turn() === "w") whiteMs -= elapsed; else blackMs -= elapsed;
        if (whiteMs > 0 && blackMs > 0) return json({ game });
        result = whiteMs <= 0 ? "black_win" : "white_win";
      }
      return json({ game: await finishGame(game, result, reason, whiteMs, blackMs) });
    }
    return fail("Неизвестное действие.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Внутренняя ошибка сервера.", 500);
  }
});