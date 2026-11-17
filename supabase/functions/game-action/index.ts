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
function normalizeUsername(value: unknown): string {
  const username = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9_]{3,18}$/.test(username)) {
    throw new Error("Ник: 3–18 символов, только латинские буквы, цифры и _.");
  }
  return username;
}
function accountEmail(username: string): string {
  return username + "@accounts.chessmart.invalid";
}
async function publicAuthClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
}
async function authUser(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Нужна авторизация.");
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error("Сетевая сессия истекла. Перезагрузи страницу.");
  return data.user;
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
    const body = await req.json() as Record<string, unknown>;
    const action = String(body.action ?? "");

    // Nickname + password accounts. The synthetic email is private and used only by Supabase Auth.
    if (action === "register" || action === "login") {
      const remoteAddress = req.headers.get("cf-connecting-ip")
        ?? req.headers.get("x-real-ip")
        ?? req.headers.get("x-forwarded-for")?.split(",").pop()?.trim()
        ?? "unknown";
      const rateInput = new TextEncoder().encode(action + ":" + remoteAddress);
      const rateDigest = await crypto.subtle.digest("SHA-256", rateInput);
      const rateBucket = Array.from(new Uint8Array(rateDigest), (value) => value.toString(16).padStart(2, "0")).join("");
      const { data: allowed, error: rateError } = await admin.rpc("consume_chessmart_auth_limit", {
        p_bucket_key: rateBucket,
        p_max_hits: action === "register" ? 8 : 30,
        p_window_seconds: action === "register" ? 3600 : 900,
      });
      if (rateError) throw new Error("Сервис авторизации временно недоступен.");
      if (allowed !== true) return fail("Слишком много попыток. Попробуй позже.", 429);

      const username = normalizeUsername(body.username);
      const password = String(body.password ?? "");
      if (password.length < 8 || password.length > 128) return fail("Пароль должен содержать от 8 до 128 символов.");
      const client = await publicAuthClient();

      if (action === "register") {
        const { data: existing } = await admin.from("online_profiles").select("user_id").eq("username", username).maybeSingle();
        if (existing) return fail("Этот ник уже занят. Выбери другой.");

        const email = accountEmail(username);
        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { chessmart_username: username },
        });
        if (createError || !created.user) {
          const message = createError?.message ?? "";
          if (/already|registered|exists/i.test(message)) return fail("Этот ник или адрес почты уже используется.");
          return fail("Не удалось создать аккаунт. Проверь пароль и попробуй ещё раз.");
        }
        const { data: profile, error: profileError } = await admin.from("online_profiles").insert({
          user_id: created.user.id,
          username,
        }).select("*").single();
        if (profileError || !profile) {
          await admin.auth.admin.deleteUser(created.user.id);
          if (profileError?.code === "23505") return fail("Этот ник уже занят.");
          throw new Error("Не удалось создать профиль игрока.");
        }
        const { data: signed, error: signError } = await client.auth.signInWithPassword({ email, password });
        if (signError || !signed.session || !signed.user) {
          await admin.auth.admin.deleteUser(created.user.id);
          throw new Error("Аккаунт создан, но вход не удался. Попробуй войти с тем же ником.");
        }
        return json({ session: signed.session, profile });
      }

      const { data: profile } = await admin.from("online_profiles").select("*").eq("username", username).maybeSingle();
      if (!profile) return fail("Неверный ник или пароль.", 401);
      const { data: account, error: accountError } = await admin.auth.admin.getUserById(profile.user_id);
      const email = account?.user?.email;
      if (accountError || !email) return fail("Не удалось найти аккаунт. Обратись к администратору.", 401);
      const { data: signed, error: signError } = await client.auth.signInWithPassword({ email, password });
      if (signError || !signed.session || !signed.user) return fail("Неверный ник или пароль.", 401);
      return json({ session: signed.session, profile });
    }

    const user = await authUser(req);
    if (action === "update_avatar") {
      const encoded = String(body.avatarData ?? "");
      const contentType = String(body.contentType ?? "").toLowerCase();
      const allowedTypes = new Set(["image/webp", "image/png", "image/jpeg"]);
      if (!allowedTypes.has(contentType) || !encoded || encoded.length > 1_500_000) {
        return fail("Выбери изображение WebP, PNG или JPEG размером до 1 МБ.");
      }
      let binary: string;
      try { binary = atob(encoded); } catch { return fail("Файл аватара повреждён."); }
      if (!binary.length || binary.length > 1_048_576) return fail("Аватар должен быть меньше 1 МБ после обработки.");
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      const isWebp = bytes.length >= 12
        && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
        && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
      if ((contentType === "image/png" && !isPng)
        || (contentType === "image/jpeg" && !isJpeg)
        || (contentType === "image/webp" && !isWebp)) {
        return fail("Формат изображения не совпадает с содержимым файла.");
      }
      const extension = contentType === "image/png" ? "png" : contentType === "image/jpeg" ? "jpg" : "webp";
      const path = user.id + "/avatar." + extension;
      const { error: uploadError } = await admin.storage.from("chessmart-avatars").upload(path, bytes, {
        contentType,
        cacheControl: "3600",
        upsert: true,
      });
      if (uploadError) throw new Error("Не удалось сохранить аватар. Проверь, что миграция хранилища применена.");
      const { data: publicData } = admin.storage.from("chessmart-avatars").getPublicUrl(path);
      const avatarUrl = publicData.publicUrl + "?v=" + Date.now();
      const { data: profile, error: profileError } = await admin.from("online_profiles")
        .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
        .eq("user_id", user.id).select("*").single();
      if (profileError || !profile) throw new Error("Аватар загружен, но профиль не удалось обновить.");
      return json({ profile });
    }
    if (action === "profile") {
      const { data: profile, error } = await admin.from("online_profiles").select("*").eq("user_id", user.id).maybeSingle();
      if (error || !profile) return fail("Профиль игрока не найден.", 404);
      const { data: game } = await admin.from("online_games").select("*").eq("status", "active")
        .or("white_id.eq." + user.id + ",black_id.eq." + user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (game) await admin.from("online_matchmaking_queue").delete().eq("user_id", user.id);
      return json({ profile, game: game ?? undefined });
    }
    if (action === "lookup_player") {
      const username = normalizeUsername(body.username);
      const { data: target } = await admin.from("online_profiles")
        .select("username,bullet_rating,blitz_rating,rapid_rating,bullet_games,blitz_games,rapid_games")
        .eq("username", username).maybeSingle();
      if (!target) return fail("Игрок с таким ником не найден.", 404);
      return json({ player: target });
    }
    if (action === "find_match") {
      const minutes = Math.max(1, Math.min(60, Math.floor(Number(body.minutes) || 5)));
      const increment = Math.max(0, Math.min(60, Math.floor(Number(body.increment) || 0)));
      const type = ratingType(minutes, increment);
      const { data, error } = await admin.rpc("match_online_player", {
        p_user_id: user.id,
        p_rating_type: type,
        p_minutes: minutes,
        p_increment_seconds: increment,
        p_rated: body.rated !== false,
      });
      if (error) throw new Error("Ошибка поиска соперника: " + error.message);
      const game = Array.isArray(data) ? data[0] : data;
      return json(game ? { game, queued: false } : { queued: true, ratingType: type });
    }
    if (action === "cancel_match") {
      const { data: activeGame } = await admin.from("online_games").select("*").eq("status", "active")
        .or("white_id.eq." + user.id + ",black_id.eq." + user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (activeGame) {
        await admin.from("online_matchmaking_queue").delete().eq("user_id", user.id);
        return json({ game: activeGame, cancelled: false });
      }
      const { error } = await admin.from("online_matchmaking_queue").delete().eq("user_id", user.id);
      if (error) throw new Error("Не удалось остановить поиск соперника.");
      return json({ cancelled: true });
    }
    if (action === "challenge_player") {
      const username = normalizeUsername(body.username);
      const { data: inviter, error: inviterError } = await admin.from("online_profiles").select("*").eq("user_id", user.id).maybeSingle();
      if (inviterError || !inviter) return fail("Сетевой профиль не найден.", 401);
      if (username === inviter.username) return fail("Нельзя отправить вызов самому себе.");
      const { data: target } = await admin.from("online_profiles").select("*").eq("username", username).maybeSingle();
      if (!target) return fail("Игрок с таким ником не найден.", 404);
      const { data: inviterGame } = await admin.from("online_games").select("id").eq("status", "active").or("white_id.eq." + user.id + ",black_id.eq." + user.id).limit(1).maybeSingle();
      if (inviterGame) return fail("Сначала заверши текущую партию.");
      const { data: targetGame } = await admin.from("online_games").select("id").eq("status", "active").or("white_id.eq." + target.user_id + ",black_id.eq." + target.user_id).limit(1).maybeSingle();
      if (targetGame) return fail("Этот игрок уже играет партию.");
      const { data: duplicate } = await admin.from("online_invites").select("id")
        .eq("from_user", user.id).eq("to_user", target.user_id).eq("status", "pending").maybeSingle();
      if (duplicate) return fail("Приглашение этому игроку уже отправлено.");
      await admin.from("online_matchmaking_queue").delete().eq("user_id", user.id);
      await admin.from("online_matchmaking_queue").delete().eq("user_id", target.user_id);
      const minutes = Math.max(1, Math.min(60, Math.floor(Number(body.minutes) || 5)));
      const increment = Math.max(0, Math.min(60, Math.floor(Number(body.increment) || 0)));
      const type = ratingType(minutes, increment);
      const code = makeCode();
      const { data: game, error: gameError } = await admin.from("online_games").insert({
        invite_code: code, status: "waiting", white_id: user.id, black_id: null,
        white_name: inviter.username, black_name: null, fen: START_FEN, moves: [],
        minutes, increment_seconds: increment, increment_ms: increment * 1000,
        white_ms: minutes * 60_000, black_ms: minutes * 60_000, turn_started_at: null,
        rated: body.rated !== false, rating_type: type,
        white_rating: type === "bullet" ? inviter.bullet_rating : type === "blitz" ? inviter.blitz_rating : inviter.rapid_rating,
        black_rating: null,
      }).select("*").single();
      if (gameError || !game) throw new Error("Не удалось создать приглашение.");
      const { error: invitationError } = await admin.from("online_invites").insert({
        game_id: game.id, from_user: user.id, to_user: target.user_id,
      });
      if (invitationError) {
        await admin.from("online_games").delete().eq("id", game.id);
        if (invitationError.code === "23505") return fail("Приглашение уже ожидает ответа.");
        throw new Error("Не удалось отправить приглашение.");
      }
      return json({ sent: true, username: target.username, game });
    }
    if (action === "list_invitations") {
      const { data, error } = await admin.from("online_invites")
        .select("id,from_user,created_at,game:online_games(id,white_name,rating_type,minutes,increment_seconds)")
        .eq("to_user", user.id).eq("status", "pending").order("created_at", { ascending: false }).limit(20);
      if (error) throw new Error("Не удалось загрузить приглашения.");
      return json({ invitations: data ?? [] });
    }
    if (action === "accept_invitation") {
      const inviteId = String(body.inviteId ?? "");
      const { data, error } = await admin.rpc("accept_online_invite", { p_invite_id: inviteId, p_user_id: user.id });
      if (error) return fail(error.message.includes("expired") ? "Приглашение уже недействительно." : "Не удалось принять приглашение.");
      const game = Array.isArray(data) ? data[0] : data;
      return json({ game });
    }
    if (action === "decline_invitation") {
      const inviteId = String(body.inviteId ?? "");
      const { error } = await admin.from("online_invites")
        .update({ status: "declined", responded_at: new Date().toISOString() })
        .eq("id", inviteId).eq("to_user", user.id).eq("status", "pending");
      if (error) throw new Error("Не удалось отклонить приглашение.");
      return json({ declined: true });
    }

    if (action === "create") {
      const minutes = Math.max(1, Math.min(60, Math.floor(Number(body.minutes) || 5)));
      const increment = Math.max(0, Math.min(60, Math.floor(Number(body.increment) || 0)));
      const { data: profile, error: profileError } = await admin.from("online_profiles").select("*").eq("user_id", user.id).maybeSingle();
      if (profileError || !profile) return fail("Сетевой профиль не найден. Выйди и войди в аккаунт снова.", 401);
      const { data: activeGame } = await admin.from("online_games").select("id").eq("status", "active").or("white_id.eq." + user.id + ",black_id.eq." + user.id).limit(1).maybeSingle();
      if (activeGame) return fail("Сначала заверши текущую партию.");
      const { data: queued } = await admin.from("online_matchmaking_queue").select("user_id").eq("user_id", user.id).maybeSingle();
      if (queued) return fail("Сначала отмени поиск соперника.");
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
      const { data: profile, error: profileError } = await admin.from("online_profiles").select("*").eq("user_id", user.id).maybeSingle();
      if (profileError || !profile) return fail("Сетевой профиль не найден. Выйди и войди в аккаунт снова.", 401);
      const { data: waiting, error } = await admin.from("online_games").select("*").eq("invite_code", code).eq("status", "waiting").maybeSingle();
      if (error || !waiting) return fail("Комната не найдена или игра уже началась.", 404);
      if (waiting.white_id === user.id) return fail("Нельзя присоединиться к собственной комнате.");
      const { data: activeGame } = await admin.from("online_games").select("id").eq("status", "active").or("white_id.eq." + user.id + ",black_id.eq." + user.id).limit(1).maybeSingle();
      if (activeGame) return fail("Сначала заверши текущую партию.");
      const { data: queued } = await admin.from("online_matchmaking_queue").select("user_id").eq("user_id", user.id).maybeSingle();
      if (queued) return fail("Сначала отмени поиск соперника.");
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