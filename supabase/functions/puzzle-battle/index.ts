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
interface PublicBattleLeader {
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
    .select("id,status,player_one_id,player_two_id,started_at,ends_at,finished_at,winner_id,finish_reason,player_one_rating,player_two_rating,player_one_rating_after,player_two_rating_after,season_points_one,season_points_two,rating_applied")
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
      .select("id,status,player_one_id,player_two_id,started_at,ends_at,finished_at,winner_id,finish_reason,player_one_rating,player_two_rating,player_one_rating_after,player_two_rating_after,season_points_one,season_points_two,rating_applied")
      .eq("id", battleId).single();
    if (refreshed) Object.assign(battle, refreshed);
    players = players.map((player) => ({ ...player, completed: true }));
  }

  const ids = players.map((player) => player.user_id);
  const [{ data: profiles }, { data: seasonRows }] = await Promise.all([
    admin.from("online_profiles")
      .select("user_id,username,avatar_url,puzzle_battle_rating,puzzle_battle_games,puzzle_battle_wins,puzzle_battle_losses,puzzle_battle_draws,puzzle_battle_win_streak,puzzle_battle_best_win_streak")
      .in("user_id", ids),
    admin.from("puzzle_battle_season_stats")
      .select("user_id,points,wins,losses,draws,best_win_streak")
      .eq("season_start", new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10))
      .in("user_id", ids),
  ]);
  const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
  const seasonByUser = new Map((seasonRows ?? []).map((row) => [row.user_id, row]));
  const publicPlayers = players.map((player) => ({
    user_id: player.user_id,
    username: names.get(player.user_id)?.username ?? "Игрок",
    avatar_url: names.get(player.user_id)?.avatar_url ?? null,
    score: player.score,
    round_index: player.round_index,
    mistakes: player.mistakes,
    completed: player.completed,
    puzzle_battle_rating: names.get(player.user_id)?.puzzle_battle_rating ?? 1200,
    puzzle_battle_games: names.get(player.user_id)?.puzzle_battle_games ?? 0,
    puzzle_battle_wins: names.get(player.user_id)?.puzzle_battle_wins ?? 0,
    puzzle_battle_losses: names.get(player.user_id)?.puzzle_battle_losses ?? 0,
    puzzle_battle_draws: names.get(player.user_id)?.puzzle_battle_draws ?? 0,
    puzzle_battle_win_streak: names.get(player.user_id)?.puzzle_battle_win_streak ?? 0,
    puzzle_battle_best_win_streak: names.get(player.user_id)?.puzzle_battle_best_win_streak ?? 0,
    season_points: seasonByUser.get(player.user_id)?.points ?? 0,
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
async function getPuzzleBattleLeaderboard(sort: "points" | "rating", userId: string) {
  const seasonStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
    .toISOString().slice(0, 10);
  let leaders: PublicBattleLeader[] = [];

  if (sort === "rating") {
    const { data: profiles, error } = await admin.from("online_profiles")
      .select("user_id,username,avatar_url,puzzle_battle_rating,puzzle_battle_games,puzzle_battle_wins,puzzle_battle_losses,puzzle_battle_draws,puzzle_battle_best_win_streak")
      .gt("puzzle_battle_games", 0)
      .order("puzzle_battle_rating", { ascending: false })
      .order("puzzle_battle_games", { ascending: false })
      .limit(50);
    if (error) throw new Error("Не удалось загрузить рейтинг Puzzle Battle: " + error.message);
    leaders = (profiles ?? []).map((profile) => ({
      user_id: profile.user_id,
      username: profile.username,
      avatar_url: profile.avatar_url,
      puzzle_battle_rating: profile.puzzle_battle_rating ?? 1200,
      puzzle_battle_games: profile.puzzle_battle_games ?? 0,
      season_points: 0,
      wins: profile.puzzle_battle_wins ?? 0,
      losses: profile.puzzle_battle_losses ?? 0,
      draws: profile.puzzle_battle_draws ?? 0,
      best_win_streak: profile.puzzle_battle_best_win_streak ?? 0,
    }));
  } else {
    const { data: rows, error } = await admin.from("puzzle_battle_season_stats")
      .select("user_id,points,wins,losses,draws,best_win_streak")
      .eq("season_start", seasonStart)
      .order("points", { ascending: false })
      .order("wins", { ascending: false })
      .limit(50);
    if (error) throw new Error("Не удалось загрузить сезонную таблицу: " + error.message);
    const ids = (rows ?? []).map((row) => row.user_id);
    const { data: profiles, error: profileError } = ids.length
      ? await admin.from("online_profiles")
        .select("user_id,username,avatar_url,puzzle_battle_rating,puzzle_battle_games")
        .in("user_id", ids)
      : { data: [], error: null };
    if (profileError) throw new Error("Не удалось загрузить игроков таблицы лидеров.");
    const profileMap = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
    leaders = (rows ?? []).map((row) => ({
      user_id: row.user_id,
      username: profileMap.get(row.user_id)?.username ?? "Игрок",
      avatar_url: profileMap.get(row.user_id)?.avatar_url ?? null,
      puzzle_battle_rating: profileMap.get(row.user_id)?.puzzle_battle_rating ?? 1200,
      puzzle_battle_games: profileMap.get(row.user_id)?.puzzle_battle_games ?? 0,
      season_points: row.points,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      best_win_streak: row.best_win_streak,
    }));
  }

  return {
    sort,
    season_start: seasonStart,
    leaders,
    my_rank: leaders.findIndex((leader) => leader.user_id === userId) + 1 || null,
  };
}

async function getPuzzleBattleHistory(userId: string) {
  const seasonStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
    .toISOString().slice(0, 10);

  const [profileResult, seasonResult, battlesResult] = await Promise.all([
    admin.from("online_profiles")
      .select("user_id,username,avatar_url,puzzle_battle_rating,puzzle_battle_games,puzzle_battle_wins,puzzle_battle_losses,puzzle_battle_draws,puzzle_battle_win_streak,puzzle_battle_best_win_streak")
      .eq("user_id", userId).maybeSingle(),
    admin.from("puzzle_battle_season_stats")
      .select("points,battles,wins,losses,draws,best_win_streak")
      .eq("user_id", userId).eq("season_start", seasonStart).maybeSingle(),
    admin.from("puzzle_battles")
      .select("id,player_one_id,player_two_id,status,created_at,finished_at,winner_id,finish_reason,player_one_rating,player_two_rating,player_one_rating_after,player_two_rating_after,season_points_one,season_points_two")
      .or("player_one_id.eq." + userId + ",player_two_id.eq." + userId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (profileResult.error || !profileResult.data) {
    throw new Error("Не удалось загрузить профиль Puzzle Battle.");
  }
  if (seasonResult.error) throw new Error("Не удалось загрузить сезонную статистику.");
  if (battlesResult.error) throw new Error("Не удалось загрузить историю дуэлей.");

  const battles = battlesResult.data ?? [];
  const battleIds = battles.map((battle) => battle.id);
  const opponentIds = [...new Set(battles.map((battle) =>
    battle.player_one_id === userId ? battle.player_two_id : battle.player_one_id
  ))];

  const [{ data: playerRows, error: playersError }, { data: opponentProfiles, error: opponentsError }] =
    battleIds.length
      ? await Promise.all([
        admin.from("puzzle_battle_players")
          .select("battle_id,user_id,score,mistakes")
          .in("battle_id", battleIds),
        admin.from("online_profiles")
          .select("user_id,username,avatar_url,puzzle_battle_rating,puzzle_battle_games,puzzle_battle_wins,puzzle_battle_losses,puzzle_battle_draws,puzzle_battle_best_win_streak")
          .in("user_id", opponentIds),
      ])
      : [{ data: [], error: null }, { data: [], error: null }];

  if (playersError || opponentsError) throw new Error("Не удалось загрузить подробности завершённых дуэлей.");

  const playerMap = new Map<string, Map<string, { score: number; mistakes: number }>>();
  for (const row of playerRows ?? []) {
    let matchPlayers = playerMap.get(row.battle_id);
    if (!matchPlayers) {
      matchPlayers = new Map();
      playerMap.set(row.battle_id, matchPlayers);
    }
    matchPlayers.set(row.user_id, { score: row.score, mistakes: row.mistakes });
  }
  const opponentMap = new Map((opponentProfiles ?? []).map((profile) => [profile.user_id, profile]));
  const profile = profileResult.data;

  const history = battles.map((battle) => {
    const opponentId = battle.player_one_id === userId ? battle.player_two_id : battle.player_one_id;
    const mineIsOne = battle.player_one_id === userId;
    const matchPlayers = playerMap.get(battle.id);
    const mine = matchPlayers?.get(userId);
    const theirs = matchPlayers?.get(opponentId);
    const opponent = opponentMap.get(opponentId);
    const ratingBefore = (mineIsOne ? battle.player_one_rating : battle.player_two_rating)
      ?? profile.puzzle_battle_rating;
    const ratingAfter = (mineIsOne ? battle.player_one_rating_after : battle.player_two_rating_after)
      ?? ratingBefore;

    return {
      id: battle.id,
      result: battle.winner_id === null ? "draw" : battle.winner_id === userId ? "win" : "loss",
      opponent: {
        user_id: opponentId,
        username: opponent?.username ?? "Игрок",
        avatar_url: opponent?.avatar_url ?? null,
        puzzle_battle_rating: opponent?.puzzle_battle_rating ?? 1200,
        puzzle_battle_games: opponent?.puzzle_battle_games ?? 0,
        puzzle_battle_wins: opponent?.puzzle_battle_wins ?? 0,
        puzzle_battle_losses: opponent?.puzzle_battle_losses ?? 0,
        puzzle_battle_draws: opponent?.puzzle_battle_draws ?? 0,
        puzzle_battle_best_win_streak: opponent?.puzzle_battle_best_win_streak ?? 0,
      },
      my_score: mine?.score ?? 0,
      opponent_score: theirs?.score ?? 0,
      my_mistakes: mine?.mistakes ?? 0,
      opponent_mistakes: theirs?.mistakes ?? 0,
      finished_at: battle.finished_at ?? battle.created_at,
      finish_reason: battle.finish_reason,
      rating_before: ratingBefore,
      rating_after: ratingAfter,
      rating_delta: ratingAfter - ratingBefore,
      season_points: mineIsOne ? battle.season_points_one : battle.season_points_two,
    };
  });

  return {
    profile: {
      username: profile.username,
      avatar_url: profile.avatar_url,
      puzzle_battle_rating: profile.puzzle_battle_rating,
      games: profile.puzzle_battle_games,
      wins: profile.puzzle_battle_wins,
      losses: profile.puzzle_battle_losses,
      draws: profile.puzzle_battle_draws,
      win_streak: profile.puzzle_battle_win_streak,
      best_win_streak: profile.puzzle_battle_best_win_streak,
    },
    season: {
      season_start: seasonStart,
      points: seasonResult.data?.points ?? 0,
      battles: seasonResult.data?.battles ?? 0,
      wins: seasonResult.data?.wins ?? 0,
      losses: seasonResult.data?.losses ?? 0,
      draws: seasonResult.data?.draws ?? 0,
      best_win_streak: seasonResult.data?.best_win_streak ?? 0,
    },
    history,
  };
}

async function getQueueState(userId: string) {
  const { data, error } = await admin.from("puzzle_battle_queue")
    .select("status,battle_id,queued_at").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Не удалось проверить очередь: " + error.message);
  if (!data) return { status: "idle" };

  if (data.status === "waiting" || !data.battle_id) {
    // The player who joins next performs matchmaking under the DB advisory lock.
    // Polling only reads the queue; it must not delete/reinsert the same row.
    return { status: "queued", queued_at: data.queued_at };
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
        .select("puzzle_battle_rating").eq("user_id", user.id).maybeSingle();
      if (profileError || !profile) return fail("Сначала создай профиль в CHESSMART Online.", 409);
      const puzzles = await createPuzzlePack();
      const { data, error } = await admin.rpc("join_puzzle_battle_queue", {
        p_user_id: user.id,
        p_rating: profile.puzzle_battle_rating,
        p_puzzles: puzzles,
      });
      if (error) throw new Error("Не удалось войти в очередь дуэли: " + error.message);
      if (data?.queued) return json({ status: "queued" });
      const battleId = data?.battle_id;
      if (typeof battleId !== "string") throw new Error("Сервер не вернул идентификатор дуэли.");
      return json(await battleState(battleId, user.id));
    }

    if (body.action === "leaderboard") {
      const sort = body.sort === "rating" ? "rating" : "points";
      return json(await getPuzzleBattleLeaderboard(sort, user.id));
    }

    if (body.action === "history") {
      return json(await getPuzzleBattleHistory(user.id));
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
