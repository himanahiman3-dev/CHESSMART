-- Separate Puzzle Battle rating, monthly season points, and idempotent result settlement.

alter table public.online_profiles
  add column if not exists puzzle_battle_rating integer not null default 1200,
  add column if not exists puzzle_battle_games integer not null default 0,
  add column if not exists puzzle_battle_wins integer not null default 0,
  add column if not exists puzzle_battle_losses integer not null default 0,
  add column if not exists puzzle_battle_draws integer not null default 0,
  add column if not exists puzzle_battle_win_streak integer not null default 0,
  add column if not exists puzzle_battle_best_win_streak integer not null default 0;

do $profile_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.online_profiles'::regclass
      and conname = 'online_profiles_puzzle_battle_rating_check'
  ) then
    alter table public.online_profiles
      add constraint online_profiles_puzzle_battle_rating_check
      check (puzzle_battle_rating between 100 and 4000);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.online_profiles'::regclass
      and conname = 'online_profiles_puzzle_battle_games_check'
  ) then
    alter table public.online_profiles
      add constraint online_profiles_puzzle_battle_games_check
      check (puzzle_battle_games >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.online_profiles'::regclass
      and conname = 'online_profiles_puzzle_battle_records_check'
  ) then
    alter table public.online_profiles
      add constraint online_profiles_puzzle_battle_records_check
      check (
        puzzle_battle_wins >= 0
        and puzzle_battle_losses >= 0
        and puzzle_battle_draws >= 0
        and puzzle_battle_win_streak >= 0
        and puzzle_battle_best_win_streak >= puzzle_battle_win_streak
      );
  end if;
end;
$profile_constraints$;

alter table public.puzzle_battles
  add column if not exists player_one_rating integer,
  add column if not exists player_two_rating integer,
  add column if not exists player_one_rating_after integer,
  add column if not exists player_two_rating_after integer,
  add column if not exists season_points_one integer not null default 0,
  add column if not exists season_points_two integer not null default 0,
  add column if not exists rating_applied boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.puzzle_battle_season_stats (
  user_id uuid not null references auth.users(id) on delete cascade,
  season_start date not null,
  points integer not null default 0 check (points >= 0),
  battles integer not null default 0 check (battles >= 0),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  draws integer not null default 0 check (draws >= 0),
  best_win_streak integer not null default 0 check (best_win_streak >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, season_start),
  check (extract(day from season_start) = 1)
);
create index if not exists puzzle_battle_season_points_idx
  on public.puzzle_battle_season_stats(season_start, points desc, user_id);
create index if not exists puzzle_battle_season_user_idx
  on public.puzzle_battle_season_stats(user_id, season_start desc);

alter table public.puzzle_battle_season_stats enable row level security;
revoke all on public.puzzle_battle_season_stats from anon, authenticated;
grant select on public.puzzle_battle_season_stats to authenticated;
grant all on public.puzzle_battle_season_stats to service_role;

drop policy if exists "authenticated read puzzle battle season leaderboard"
  on public.puzzle_battle_season_stats;
create policy "authenticated read puzzle battle season leaderboard"
  on public.puzzle_battle_season_stats for select to authenticated
  using (true);

create or replace function public.capture_puzzle_battle_ratings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $capture_puzzle_battle_ratings$
declare
  v_one integer;
  v_two integer;
begin
  select puzzle_battle_rating into v_one
    from public.online_profiles where user_id = new.player_one_id;
  select puzzle_battle_rating into v_two
    from public.online_profiles where user_id = new.player_two_id;
  if v_one is null or v_two is null then
    raise exception 'Puzzle Battle player profile is missing';
  end if;
  new.player_one_rating := v_one;
  new.player_two_rating := v_two;
  return new;
end;
$capture_puzzle_battle_ratings$;

drop trigger if exists puzzle_battle_capture_ratings on public.puzzle_battles;
create trigger puzzle_battle_capture_ratings
  before insert on public.puzzle_battles
  for each row execute function public.capture_puzzle_battle_ratings();

create or replace function public.resolve_puzzle_battle_winner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $resolve_puzzle_battle_winner$
declare
  v_winner uuid;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select case
      when p1.score > p2.score then p1.user_id
      when p2.score > p1.score then p2.user_id
      when p1.mistakes < p2.mistakes then p1.user_id
      when p2.mistakes < p1.mistakes then p2.user_id
      else null
    end into v_winner
    from public.puzzle_battle_players p1
    join public.puzzle_battle_players p2
      on p2.battle_id = p1.battle_id and p2.user_id <> p1.user_id
    where p1.battle_id = new.id
      and p1.user_id = new.player_one_id;
    new.winner_id := v_winner;
    new.finished_at := coalesce(new.finished_at, now());
    new.rating_applied := false;
  end if;
  return new;
end;
$resolve_puzzle_battle_winner$;

drop trigger if exists puzzle_battle_resolve_winner on public.puzzle_battles;
create trigger puzzle_battle_resolve_winner
  before update of status on public.puzzle_battles
  for each row execute function public.resolve_puzzle_battle_winner();

create or replace function public.apply_puzzle_battle_result(p_battle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $apply_puzzle_battle_result$
declare
  v_battle public.puzzle_battles%rowtype;
  v_one_player public.puzzle_battle_players%rowtype;
  v_two_player public.puzzle_battle_players%rowtype;
  v_one_profile public.online_profiles%rowtype;
  v_two_profile public.online_profiles%rowtype;
  v_one_before integer;
  v_two_before integer;
  v_one_delta integer;
  v_two_delta integer;
  v_one_after integer;
  v_two_after integer;
  v_one_actual numeric;
  v_two_actual numeric;
  v_one_expected numeric;
  v_two_expected numeric;
  v_one_streak integer;
  v_two_streak integer;
  v_one_points integer;
  v_two_points integer;
  v_one_wins integer := 0;
  v_two_wins integer := 0;
  v_one_losses integer := 0;
  v_two_losses integer := 0;
  v_one_draws integer := 0;
  v_two_draws integer := 0;
  v_season_start date := date_trunc('month', now())::date;
begin
  select * into v_battle
    from public.puzzle_battles
    where id = p_battle_id
    for update;
  if v_battle.id is null then
    raise exception 'Puzzle Battle not found';
  end if;
  if v_battle.status <> 'completed' then
    raise exception 'Puzzle Battle is not completed';
  end if;
  if v_battle.rating_applied then
    return jsonb_build_object(
      'applied', true,
      'already_applied', true,
      'winner_id', v_battle.winner_id,
      'player_one_rating_after', v_battle.player_one_rating_after,
      'player_two_rating_after', v_battle.player_two_rating_after,
      'season_points_one', v_battle.season_points_one,
      'season_points_two', v_battle.season_points_two
    );
  end if;

  select * into v_one_player
    from public.puzzle_battle_players
    where battle_id = p_battle_id and user_id = v_battle.player_one_id;
  select * into v_two_player
    from public.puzzle_battle_players
    where battle_id = p_battle_id and user_id = v_battle.player_two_id;
  if v_one_player.user_id is null or v_two_player.user_id is null then
    raise exception 'Puzzle Battle player state is missing';
  end if;

  -- Lock both profiles in UUID order to avoid deadlocks when concurrent battles share players.
  perform 1
    from public.online_profiles
    where user_id in (v_battle.player_one_id, v_battle.player_two_id)
    order by user_id
    for update;

  select * into v_one_profile
    from public.online_profiles
    where user_id = v_battle.player_one_id;
  select * into v_two_profile
    from public.online_profiles
    where user_id = v_battle.player_two_id;
  if v_one_profile.user_id is null or v_two_profile.user_id is null then
    raise exception 'Puzzle Battle profile is missing';
  end if;

  v_one_before := coalesce(v_battle.player_one_rating, v_one_profile.puzzle_battle_rating);
  v_two_before := coalesce(v_battle.player_two_rating, v_two_profile.puzzle_battle_rating);

  if v_battle.winner_id = v_battle.player_one_id then
    v_one_actual := 1;
    v_two_actual := 0;
    v_one_wins := 1;
    v_two_losses := 1;
    v_one_streak := v_one_profile.puzzle_battle_win_streak + 1;
    v_two_streak := 0;
  elsif v_battle.winner_id = v_battle.player_two_id then
    v_one_actual := 0;
    v_two_actual := 1;
    v_two_wins := 1;
    v_one_losses := 1;
    v_one_streak := 0;
    v_two_streak := v_two_profile.puzzle_battle_win_streak + 1;
  else
    v_one_actual := 0.5;
    v_two_actual := 0.5;
    v_one_draws := 1;
    v_two_draws := 1;
    v_one_streak := 0;
    v_two_streak := 0;
  end if;

  v_one_expected := 1 / (1 + power(10::numeric, (v_two_before - v_one_before)::numeric / 400));
  v_two_expected := 1 / (1 + power(10::numeric, (v_one_before - v_two_before)::numeric / 400));
  v_one_delta := round(24 * (v_one_actual - v_one_expected))::integer;
  v_two_delta := round(24 * (v_two_actual - v_two_expected))::integer;
  v_one_after := greatest(100, least(4000, v_one_before + v_one_delta));
  v_two_after := greatest(100, least(4000, v_two_before + v_two_delta));

  v_one_points := v_one_player.score * greatest(1, case when v_battle.winner_id = v_battle.player_one_id then v_one_streak else 1 end);
  v_two_points := v_two_player.score * greatest(1, case when v_battle.winner_id = v_battle.player_two_id then v_two_streak else 1 end);

  update public.online_profiles
    set puzzle_battle_rating = v_one_after,
        puzzle_battle_games = puzzle_battle_games + 1,
        puzzle_battle_wins = puzzle_battle_wins + v_one_wins,
        puzzle_battle_losses = puzzle_battle_losses + v_one_losses,
        puzzle_battle_draws = puzzle_battle_draws + v_one_draws,
        puzzle_battle_win_streak = v_one_streak,
        puzzle_battle_best_win_streak = greatest(puzzle_battle_best_win_streak, v_one_streak),
        updated_at = now()
    where user_id = v_battle.player_one_id;

  update public.online_profiles
    set puzzle_battle_rating = v_two_after,
        puzzle_battle_games = puzzle_battle_games + 1,
        puzzle_battle_wins = puzzle_battle_wins + v_two_wins,
        puzzle_battle_losses = puzzle_battle_losses + v_two_losses,
        puzzle_battle_draws = puzzle_battle_draws + v_two_draws,
        puzzle_battle_win_streak = v_two_streak,
        puzzle_battle_best_win_streak = greatest(puzzle_battle_best_win_streak, v_two_streak),
        updated_at = now()
    where user_id = v_battle.player_two_id;

  insert into public.puzzle_battle_season_stats(
    user_id, season_start, points, battles, wins, losses, draws, best_win_streak
  ) values
    (v_battle.player_one_id, v_season_start, v_one_points, 1, v_one_wins, v_one_losses, v_one_draws, v_one_streak),
    (v_battle.player_two_id, v_season_start, v_two_points, 1, v_two_wins, v_two_losses, v_two_draws, v_two_streak)
  on conflict (user_id, season_start) do update set
    points = puzzle_battle_season_stats.points + excluded.points,
    battles = puzzle_battle_season_stats.battles + excluded.battles,
    wins = puzzle_battle_season_stats.wins + excluded.wins,
    losses = puzzle_battle_season_stats.losses + excluded.losses,
    draws = puzzle_battle_season_stats.draws + excluded.draws,
    best_win_streak = greatest(puzzle_battle_season_stats.best_win_streak, excluded.best_win_streak),
    updated_at = now();

  update public.puzzle_battles
    set player_one_rating_after = v_one_after,
        player_two_rating_after = v_two_after,
        season_points_one = v_one_points,
        season_points_two = v_two_points,
        rating_applied = true,
        updated_at = now()
    where id = p_battle_id;

  return jsonb_build_object(
    'applied', true,
    'winner_id', v_battle.winner_id,
    'player_one_rating_before', v_one_before,
    'player_two_rating_before', v_two_before,
    'player_one_rating_after', v_one_after,
    'player_two_rating_after', v_two_after,
    'player_one_delta', v_one_after - v_one_before,
    'player_two_delta', v_two_after - v_two_before,
    'season_points_one', v_one_points,
    'season_points_two', v_two_points,
    'season_start', v_season_start
  );
end;
$apply_puzzle_battle_result$;

create or replace function public.on_puzzle_battle_completed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $on_puzzle_battle_completed$
begin
  perform public.apply_puzzle_battle_result(new.id);
  return new;
end;
$on_puzzle_battle_completed$;

drop trigger if exists puzzle_battle_apply_result on public.puzzle_battles;
create trigger puzzle_battle_apply_result
  after update of status on public.puzzle_battles
  for each row
  when (old.status is distinct from new.status and new.status = 'completed')
  execute function public.on_puzzle_battle_completed();

revoke all on function public.capture_puzzle_battle_ratings() from public, anon, authenticated;
revoke all on function public.resolve_puzzle_battle_winner() from public, anon, authenticated;
revoke all on function public.apply_puzzle_battle_result(uuid) from public, anon, authenticated;
revoke all on function public.on_puzzle_battle_completed() from public, anon, authenticated;
grant execute on function public.apply_puzzle_battle_result(uuid) to service_role;

