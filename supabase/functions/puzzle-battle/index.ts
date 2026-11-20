import { createClient } from "npm:@supabase/supabase-js@2";
import { Chess, type Square } from "npm:chess.js@1.4.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { ...CORS, "Content-Type": "application/json" },
});
const fail = (message: string, status = 400) => json({ error: message }, status);

interface Puzzle {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  themes: string[];
  color: "w" | "b";
}
interface BattlePlayer {
  battle_id: string;
  user_id: string;
  score: number;
  round_index: number;
  move_index: number;
  mistakes: number;
  completed: boolean;
}
let cachedPuzzles: Puzzle[] = [];
let cacheTimestamp = 0;

async function authUser(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Нужна авторизация CHESSMART Online.");
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error("Сессия истекла. Войди в аккаунт заново.");
  return data.user;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parsePuzzle(row: Record<string, unknown>): Puzzle | null {
  const id = String(row.PuzzleId ?? "");
  const fen = String(row.FEN ?? "");
  const rawMoves = String(row.Moves ?? "").trim().split(/\s+/).filter(Boolean);
  const rating = Number(row.Rating);
  const themes = Array.isArray(row.Themes) ? row.Themes.map(String) : String(row.Themes ?? "").split(/\s+/).filter(Boolean);
  if (!id || !fen || rawMoves.length < 2 || !Number.isFinite(rating)) return null;
  try {
    const chess = new Chess(fen);
    const first = rawMoves[0];
    chess.move({ from: first.slice(0, 2) as Square, to: first.slice(2, 4) as Square, promotion: first[4] as never });
    const startFen = chess.fen();
    const color = chess.turn();
    const moves = rawMoves.slice(1);
    for (const uci of moves) {
      chess.move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci[4] as never });
    }
    return { id, fen: startFen, moves, rating: Math.round(rating), themes, color };
  } catch {
    return null;
  }
}
async function fetchPuzzlePage(offset: number): Promise<Puzzle[]> {
  const url = new URL("https://datasets-server.huggingface.co/rows");
  url.searchParams.set("dataset", "Lichess/chess-puzzles");
  url.searchParams.set("config", "default");
  url.searchParams.set("split", "train");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("length", "100");
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (response.ok) break;
    if (response.status !== 429 && response.status < 500) throw new Error("База задач вернула HTTP " + response.status);
    await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
  }
  if (!response?.ok) throw new Error("База тактических задач временно недоступна.");
  const payload = await response.json() as { rows?: Array<{ row?: Record<string, unknown> }> };
  return (payload.rows ?? []).map((item) => parsePuzzle(item.row ?? {})).filter((item): item is Puzzle => !!item);
}
function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}
async function createPuzzlePack(): Promise<Puzzle[]> {
  if (cachedPuzzles.length >= 20 && Date.now() - cacheTimestamp < 5 * 60_000) {
    return shuffle(cachedPuzzles).slice(0, 5);
  }
  const start = Math.floor(Math.random() * 240) * 100;
  const pages = await Promise.all([
    fetchPuzzlePage(start),
    fetchPuzzlePage(start + 100),
    fetchPuzzlePage(start + 200),
    fetchPuzzlePage(start + 300),
  ]);
  const unique = new Map<string, Puzzle>();
  for (const page of pages) for (const puzzle of page) {
    if (puzzle.rating >= 500 && puzzle.rating <= 2600 && !unique.has(puzzle.id)) unique.set(puzzle.id, puzzle);
  }
  if (unique.size < 5) throw new Error("Не удалось подготовить пять проверенных задач. Повтори поиск соперника.");
  cachedPuzzles = [...unique.values()];
  cacheTimestamp = Date.now();
  return shuffle(cachedPuzzles).slice(0, 5);
}
async function completeExpiredBattle(battleId: string, players: BattlePlayer[]) {
  const first = players.find((player) => player.score >= 0);
  if (!first) return;
  const second = players.find((player) => player.user_id !== first.user_id);
  if (!second) return;
  const winnerId = first.score > second.score ? first.user_id : second.score > first.score ? second.user_id : null;
  await admin.from("puzzle_battle_players").update({ completed: true }).eq("battle_id", battleId);
  await admin.from("puzzle_battles").update({
    status: "completed",
    finished_at: new Date().toISOString(),
    winner_id: winnerId,
    finish_reason: "time",
  }).eq("id", battleId).eq("status", "active");
}
async function battleState(battleId: string, userId: string) {
  const { data: battle, error: battleError } = await admin.from("puzzle_battles")
    .select("id,status,player_one_id,player_two_id,started_at,ends_at,finished_at,winner_id,finish_reason")
    .eq("id", battleId).maybeSingle();
  if (battleError || !battle) throw new Error("Дуэль не найдена.");
  if (battle.player_one_id !== userId && battle.player_two_id !== userId) throw new Error("Ты не участник этой дуэли.");

  const { data: playerRows, error: playersError } = await admin.from("puzzle_battle_players")
    .select("battle_id,user_id,score,round_index,move_index,mistakes,completed")
    .eq("battle_id", battleId);
  if (playersError || !playerRows || playerRows.length !== 2) throw new Error("Не удалось загрузить счёт дуэли.");
  let players = playerRows as BattlePlayer[];
  if (battle.status === "active" && Date.parse(battle.ends_at) <= Date.now()) {
    await completeExpiredBattle(battleId, players);
    const { data: refreshed } = await admin.from("puzzle_battles")
      .select("id,status,player_one_id,player_two_id,started_at,ends_at,finished_at,winner_id,finish_reason")
      .eq("id", battleId).single();
    if (refreshed) Object.assign(battle, refreshed);
    players = players.map((player) => ({ ...player, completed: true }));
  }

  const ids = players.map((player) => player.user_id);
  const { data: profiles } = await admin.from("online_profiles")
    .select("user_id,username,avatar_url").in("user_id", ids);
  const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
  const publicPlayers = players.map((player) => ({
    user_id: player.user_id,
    username: names.get(player.user_id)?.username ?? "Игрок",
    avatar_url: names.get(player.user_id)?.avatar_url ?? null,
    score: player.score,
    round_index: player.round_index,
    mistakes: player.mistakes,
    completed: player.completed,
  }));
  const me = players.find((player) => player.user_id === userId)!;
  let puzzle: Record<string, unknown> | null = null;
  if (battle.status === "active" && !me.completed && me.round_index < 5) {
    const roundNo = me.round_index + 1;
    const { data: round, error: roundError } = await admin.from("puzzle_battle_rounds")
      .select("round_no,puzzle_id,fen,color,rating,themes")
      .eq("battle_id", battleId).eq("round_no", roundNo).maybeSingle();
    const { data: solution, error: solutionError } = await admin.from("puzzle_battle_solutions")
      .select("moves").eq("battle_id", battleId).eq("round_no", roundNo).maybeSingle();
    if (roundError || solutionError || !round || !solution) throw new Error("Не удалось открыть задачу дуэли.");
    const chess = new Chess(round.fen);
    const moves = Array.isArray(solution.moves) ? solution.moves as string[] : [];
    for (const uci of moves.slice(0, me.move_index)) {
      const applied = chess.move({
        from: uci.slice(0, 2) as Square,
        to: uci.slice(2, 4) as Square,
        promotion: (uci[4] ?? "q") as never,
      });
      if (!applied) throw new Error("Серверная последовательность задачи повреждена.");
    }
    puzzle = { ...round, fen: chess.fen(), round: roundNo };
  }
  return {
    status: battle.status,
    battle,
    players: publicPlayers,
    me: publicPlayers.find((player) => player.user_id === userId) ?? null,
    opponent: publicPlayers.find((player) => player.user_id !== userId) ?? null,
    puzzle,
  };
}
async function getQueueState(userId: string) {
  const { data, error } = await admin.from("puzzle_battle_queue")
    .select("status,battle_id,queued_at").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Не удалось проверить очередь: " + error.message);
  if (!data) return { status: "idle" };

  if (data.status === "waiting" || !data.battle_id) {
    // Retry the atomic match operation while waiting. This closes the race where
    // two queue requests arrive at almost the same time and both initially wait.
    const [{ data: profile, error: profileError }, { data: packRow, error: packError }] = await Promise.all([
      admin.from("online_profiles").select("blitz_rating").eq("user_id", userId).maybeSingle(),
      admin.from("puzzle_battle_queue_packs").select("puzzles").eq("user_id", userId).maybeSingle(),
    ]);
    if (profileError || !profile) throw new Error("Не удалось загрузить рейтинг игрока.");
    if (packError || !Array.isArray(packRow?.puzzles) || packRow.puzzles.length !== 5) {
      await admin.from("puzzle_battle_queue").delete().eq("user_id", userId).eq("status", "waiting");
      await admin.from("puzzle_battle_queue_packs").delete().eq("user_id", userId);
      return { status: "idle" };
    }
    const { data: match, error: matchError } = await admin.rpc("join_puzzle_battle_queue", {
      p_user_id: userId,
      p_rating: profile.blitz_rating,
      p_puzzles: packRow.puzzles,
    });
    if (matchError) throw new Error("Не удалось обновить поиск соперника: " + matchError.message);
    if (match?.queued) return { status: "queued", queued_at: data.queued_at };
    if (typeof match?.battle_id !== "string") throw new Error("Сервер не вернул идентификатор дуэли.");
    return await battleState(match.battle_id, userId);
  }

  return await battleState(data.battle_id, userId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("Используй POST.", 405);
  try {
    const user = await authUser(req);
    const body: unknown = await req.json();
    if (!isRecord(body) || typeof body.action !== "string") return fail("Некорректный запрос.");

    if (body.action === "queue") {
      const existing = await getQueueState(user.id);
      if (existing.status === "queued" || existing.status === "active") return json(existing);

      const { data: profile, error: profileError } = await admin.from("online_profiles")
        .select("blitz_rating").eq("user_id", user.id).maybeSingle();
      if (profileError || !profile) return fail("Сначала создай профиль в CHESSMART Online.", 409);
      const puzzles = await createPuzzlePack();
      const { data, error } = await admin.rpc("join_puzzle_battle_queue", {
        p_user_id: user.id,
        p_rating: profile.blitz_rating,
        p_puzzles: puzzles,
      });
      if (error) throw new Error("Не удалось войти в очередь дуэли: " + error.message);
      if (data?.queued) return json({ status: "queued" });
      const battleId = data?.battle_id;
      if (typeof battleId !== "string") throw new Error("Сервер не вернул идентификатор дуэли.");
      return json(await battleState(battleId, user.id));
    }

    if (body.action === "status") return json(await getQueueState(user.id));

    if (body.action === "cancel") {
      await admin.from("puzzle_battle_queue").delete().eq("user_id", user.id).eq("status", "waiting");
      await admin.from("puzzle_battle_queue_packs").delete().eq("user_id", user.id);
      return json({ status: "idle" });
    }

    if (body.action === "answer") {
      const battleId = String(body.battleId ?? "");
      const uci = String(body.uci ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(battleId) || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
        return fail("Некорректный ход или идентификатор дуэли.");
      }
      const { data: result, error } = await admin.rpc("submit_puzzle_battle_answer", {
        p_battle_id: battleId,
        p_user_id: user.id,
        p_uci: uci,
      });
      if (error) throw new Error(error.message);
      return json({ result, ...(await battleState(battleId, user.id)) });
    }

    if (body.action === "leave") {
      return fail("Эта дуэль остаётся доступна до окончания раунда. Можно просто вернуться позже.", 409);
    }

    return fail("Неизвестное действие.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Внутренняя ошибка дуэли.";
    return fail(message, message.includes("авторизац") || message.includes("Сессия") ? 401 : 400);
  }
});
