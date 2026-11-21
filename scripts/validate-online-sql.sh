#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=chessmart_test}"
: "${PGPASSWORD:=postgres}"
export PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD

psql -v ON_ERROR_STOP=1 <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create schema storage;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create function auth.uid() returns uuid
language sql stable
as 'select null::uuid';
create publication supabase_realtime;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
SQL

psql -v ON_ERROR_STOP=1 -f supabase/migrations/202611160001_online_chess.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/202611160002_accounts_matchmaking.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/202611170001_account_avatars.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/202611170002_player_progress_sync.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261117150407_fix_matchmaking_pgcrypto_search_path.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/202611200001_puzzle_battles.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/202611200002_puzzle_battle_ratings_seasons.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261120210843_enable_online_game_realtime.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/202611210001_audit_query_indexes_and_rls.sql


psql -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users(id) values
('00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000002'),
('00000000-0000-0000-0000-000000000003'),
('00000000-0000-0000-0000-000000000004'),
('00000000-0000-0000-0000-000000000005'),
('00000000-0000-0000-0000-000000000006');

insert into public.online_profiles(user_id, username) values
('00000000-0000-0000-0000-000000000001', 'alpha'),
('00000000-0000-0000-0000-000000000002', 'bravo'),
('00000000-0000-0000-0000-000000000003', 'charlie'),
('00000000-0000-0000-0000-000000000004', 'delta'),
('00000000-0000-0000-0000-000000000005', 'echo'),
('00000000-0000-0000-0000-000000000006', 'foxtrot');

-- Active online games must be part of the Realtime publication, while RLS remains enabled.
do $online_realtime_test$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'online_games'
  ) then raise exception 'online_games must be published to Supabase Realtime'; end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'online_games' and c.relrowsecurity
  ) then raise exception 'online_games must keep RLS enabled'; end if;
  if not has_table_privilege('authenticated', 'public.online_games', 'SELECT') then
    raise exception 'Authenticated participants need SELECT privilege for Realtime'; end if;
end;
$online_realtime_test$;

-- Avatar schema and public storage bucket must be ready for authenticated uploads.
do $avatar_test$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'online_profiles' and column_name = 'avatar_url') then
    raise exception 'Avatar URL column was not created';
  end if;
  if not exists (select 1 from storage.buckets where id = 'chessmart-avatars' and public = true and file_size_limit = 1048576) then
    raise exception 'Public avatar bucket was not configured';
  end if;
end;
$avatar_test$;

-- The first player waits; the second should be paired immediately at a similar Elo.
do $test$
declare
  paired_count integer;
  game_id uuid;
  white_player uuid;
  black_player uuid;
  white_after integer;
  black_after integer;
begin
  select count(*) into paired_count
  from public.match_online_player('00000000-0000-0000-0000-000000000001', 'blitz', 5, 0, true);
  if paired_count <> 0 then raise exception 'First player should enter the queue'; end if;

  select count(*) into paired_count
  from public.match_online_player('00000000-0000-0000-0000-000000000002', 'blitz', 5, 0, true);
  if paired_count <> 1 then raise exception 'Second player should be paired'; end if;

  select id, white_id, black_id into game_id, white_player, black_player
  from public.online_games where status = 'active';
  if game_id is null or white_player = black_player then raise exception 'Match game was not created correctly'; end if;
  if (select count(*) from public.online_matchmaking_queue) <> 0 then
    raise exception 'Matched users must be removed from the queue';
  end if;

  update public.online_games
    set status = 'completed', result = 'white_win', reason = 'checkmate'
    where id = game_id;

  perform * from public.apply_online_game_rating(game_id);
  select white_rating, black_rating into white_after, black_after
    from public.online_games where id = game_id;
  if white_after <> 1220 or black_after <> 1180 then
    raise exception 'Unexpected Elo values after the first rated game: % / %', white_after, black_after;
  end if;

  -- A retry must not apply the rating twice.
  perform * from public.apply_online_game_rating(game_id);
  if (select bullet_games + blitz_games + rapid_games from public.online_profiles where user_id = white_player) <> 1 then
    raise exception 'Elo was applied more than once';
  end if;
end;
$test$;

-- Rated and unrated queues must never be mixed.
do $test$
declare
  paired_count integer;
begin
  select count(*) into paired_count
    from public.match_online_player('00000000-0000-0000-0000-000000000003', 'blitz', 5, 0, false);
  if paired_count <> 0 then raise exception 'Unrated user should wait'; end if;

  select count(*) into paired_count
    from public.match_online_player('00000000-0000-0000-0000-000000000004', 'blitz', 5, 0, true);
  if paired_count <> 0 then raise exception 'Rated and unrated queues were mixed'; end if;

  if (select count(*) from public.online_matchmaking_queue where rating_type = 'blitz') <> 2 then
    raise exception 'Both rated and unrated players should still be queued separately';
  end if;
end;
$test$;

-- A private nickname invitation must create a valid room and activate it for the invited account.
do $test$
declare
  game_id uuid;
  invite_id uuid;
  status_value text;
  invited_player uuid;
begin
  insert into public.online_games(
    invite_code, status, white_id, white_name, fen, moves,
    minutes, increment_seconds, increment_ms, white_ms, black_ms,
    rated, rating_type, white_rating
  ) values (
    'TESTINV1', 'waiting', '00000000-0000-0000-0000-000000000005', 'echo',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', '[]',
    5, 0, 0, 300000, 300000, false, 'blitz', 1200
  ) returning id into game_id;

  insert into public.online_invites(game_id, from_user, to_user)
  values (game_id, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006')
  returning id into invite_id;

  select black_id, status into invited_player, status_value
    from public.accept_online_invite(invite_id, '00000000-0000-0000-0000-000000000006');
  if invited_player <> '00000000-0000-0000-0000-000000000006' or status_value <> 'active' then
    raise exception 'Invitation acceptance failed';
  end if;
end;
$test$;

-- Auth throttling must allow the first two calls and reject the third.
do $test$
begin
  if not public.consume_chessmart_auth_limit('ci-rate-limit-test', 2, 900) then
    raise exception 'First auth request was incorrectly blocked';
  end if;
  if not public.consume_chessmart_auth_limit('ci-rate-limit-test', 2, 900) then
    raise exception 'Second auth request was incorrectly blocked';
  end if;
  if public.consume_chessmart_auth_limit('ci-rate-limit-test', 2, 900) then
    raise exception 'Third auth request was not blocked';
  end if;
end;
$test$;

-- Cloud progress is service-role-only, revisioned, and retains the latest five historical snapshots.
do $progress_sync_test$
declare
  revision_value integer;
  version_count integer;
  oldest_version integer;
  i integer;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'player_progress' and c.relrowsecurity
  ) then raise exception 'player_progress must have RLS enabled'; end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'player_progress_versions' and c.relrowsecurity
  ) then raise exception 'player_progress_versions must have RLS enabled'; end if;
  if has_table_privilege('anon', 'public.player_progress', 'SELECT')
    or has_table_privilege('authenticated', 'public.player_progress', 'SELECT')
    or has_table_privilege('anon', 'public.player_progress_versions', 'SELECT')
    or has_table_privilege('authenticated', 'public.player_progress_versions', 'SELECT') then
    raise exception 'Browser roles must not have direct access to cloud progress tables';
  end if;
  if not has_table_privilege('service_role', 'public.player_progress', 'SELECT')
    or not has_table_privilege('service_role', 'public.player_progress', 'INSERT')
    or not has_table_privilege('service_role', 'public.player_progress', 'UPDATE')
    or not has_table_privilege('service_role', 'public.player_progress_versions', 'SELECT')
    or not has_table_privilege('service_role', 'public.player_progress_versions', 'INSERT')
    or not has_table_privilege('service_role', 'public.player_progress_versions', 'DELETE') then
    raise exception 'service_role must have the privileges required by the Edge Function';
  end if;

  insert into public.player_progress(user_id, revision, payload)
  values ('00000000-0000-0000-0000-000000000001', 1, '{"format":"chess-review-profile","version":1,"profile":{"name":"alpha"}}'::jsonb);

  update public.player_progress
    set revision = 2, payload = '{"format":"test","revision":2}'::jsonb
    where user_id = '00000000-0000-0000-0000-000000000001';

  if not exists (
    select 1 from public.player_progress_versions
    where user_id = '00000000-0000-0000-0000-000000000001' and revision = 1
  ) then raise exception 'The previous cloud snapshot was not archived'; end if;

  for i in 3..9 loop
    update public.player_progress
      set revision = i, payload = jsonb_build_object('revision', i)
      where user_id = '00000000-0000-0000-0000-000000000001';
  end loop;

  select count(*), min(revision) into version_count, oldest_version
    from public.player_progress_versions
    where user_id = '00000000-0000-0000-0000-000000000001';
  select revision into revision_value from public.player_progress
    where user_id = '00000000-0000-0000-0000-000000000001';

  if version_count <> 5 or oldest_version <> 4 or revision_value <> 9 then
    raise exception 'Cloud history retention failed: count %, oldest %, current %', version_count, oldest_version, revision_value;
  end if;
end;
$progress_sync_test$;

-- Puzzle Battle: server-only answer keys, matchmaking, automatic replies, and score.
do $battle_security_test$
declare
  table_name text;
begin
  foreach table_name in array array[
    'puzzle_battles',
    'puzzle_battle_queue',
    'puzzle_battle_queue_packs',
    'puzzle_battle_rounds',
    'puzzle_battle_solutions',
    'puzzle_battle_players'
  ] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = table_name and c.relrowsecurity
    ) then raise exception 'RLS must be enabled on %', table_name; end if;
  end loop;

  if has_table_privilege('authenticated', 'public.puzzle_battle_solutions', 'SELECT')
    or has_table_privilege('authenticated', 'public.puzzle_battle_queue_packs', 'SELECT')
    or has_table_privilege('anon', 'public.puzzle_battle_solutions', 'SELECT')
    or has_table_privilege('anon', 'public.puzzle_battle_queue_packs', 'SELECT') then
    raise exception 'Browser roles must never read answer keys or queued puzzle packs'; end if;
  if not has_table_privilege('authenticated', 'public.puzzle_battles', 'SELECT')
    or not has_table_privilege('authenticated', 'public.puzzle_battle_rounds', 'SELECT')
    or not has_table_privilege('authenticated', 'public.puzzle_battle_players', 'SELECT') then
    raise exception 'Participants need read access to public battle state'; end if;
  if has_function_privilege('authenticated', 'public.join_puzzle_battle_queue(uuid,integer,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.submit_puzzle_battle_answer(uuid,uuid,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.join_puzzle_battle_queue(uuid,integer,jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.submit_puzzle_battle_answer(uuid,uuid,text)', 'EXECUTE') then
    raise exception 'Battle RPCs must be server-only'; end if;
  if not has_function_privilege('service_role', 'public.join_puzzle_battle_queue(uuid,integer,jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.submit_puzzle_battle_answer(uuid,uuid,text)', 'EXECUTE') then
    raise exception 'service_role needs permission to run battle RPCs'; end if;
end;
$battle_security_test$;

do $battle_flow_test$
declare
  puzzle_pack jsonb;
  first_join jsonb;
  second_join jsonb;
  answer jsonb;
  v_battle_id uuid;
  player_score integer;
  player_mistakes integer;
  player_completed boolean;
  battle_status text;
  winner uuid;
  i integer;
begin
  puzzle_pack := jsonb_build_array(
    jsonb_build_object('id','ci-puzzle-1','fen','rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1','color','w','rating',1200,'themes',jsonb_build_array('fork'),'moves',jsonb_build_array('e2e4','e7e5','g1f3')),
    jsonb_build_object('id','ci-puzzle-2','fen','rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1','color','w','rating',1200,'themes',jsonb_build_array('fork'),'moves',jsonb_build_array('e2e4','e7e5','g1f3')),
    jsonb_build_object('id','ci-puzzle-3','fen','rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1','color','w','rating',1200,'themes',jsonb_build_array('fork'),'moves',jsonb_build_array('e2e4','e7e5','g1f3')),
    jsonb_build_object('id','ci-puzzle-4','fen','rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1','color','w','rating',1200,'themes',jsonb_build_array('fork'),'moves',jsonb_build_array('e2e4','e7e5','g1f3')),
    jsonb_build_object('id','ci-puzzle-5','fen','rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1','color','w','rating',1200,'themes',jsonb_build_array('fork'),'moves',jsonb_build_array('e2e4','e7e5','g1f3'))
  );

  select public.join_puzzle_battle_queue('00000000-0000-0000-0000-000000000001', 1200, puzzle_pack) into first_join;
  if first_join->>'queued' <> 'true' then raise exception 'First battle player should wait in queue'; end if;

  select public.join_puzzle_battle_queue('00000000-0000-0000-0000-000000000002', 1200, puzzle_pack) into second_join;
  if second_join->>'queued' <> 'false' then raise exception 'Second battle player should be matched immediately'; end if;
  v_battle_id := (second_join->>'battle_id')::uuid;

  if (select count(*) from public.puzzle_battle_rounds where puzzle_battle_rounds.battle_id = v_battle_id) <> 5 then
    raise exception 'Battle must contain exactly five rounds'; end if;
  if (select count(*) from public.puzzle_battle_solutions where puzzle_battle_solutions.battle_id = v_battle_id) <> 5 then
    raise exception 'Server must retain five hidden answer keys'; end if;
  if (select count(*) from public.puzzle_battle_players where puzzle_battle_players.battle_id = v_battle_id) <> 2 then
    raise exception 'Battle must have two player state rows'; end if;

  select public.submit_puzzle_battle_answer(v_battle_id, '00000000-0000-0000-0000-000000000001', 'e2e4') into answer;
  if answer->>'correct' <> 'true' or answer->>'opponent_reply' <> 'e7e5' or answer->>'puzzle_completed' <> 'false' then
    raise exception 'Correct answer must return the automatic opponent reply'; end if;
  select public.submit_puzzle_battle_answer(v_battle_id, '00000000-0000-0000-0000-000000000001', 'g1f3') into answer;
  if answer->>'correct' <> 'true' or answer->>'puzzle_completed' <> 'true' or (answer->>'score')::integer <> 1 then
    raise exception 'Completing a puzzle must award exactly one point'; end if;

  for i in 1..3 loop
    select public.submit_puzzle_battle_answer(v_battle_id, '00000000-0000-0000-0000-000000000002', 'a2a3') into answer;
  end loop;
  if answer->>'correct' <> 'false' or answer->>'completed' <> 'true' then
    raise exception 'Three incorrect answers must end the player series'; end if;
  select mistakes, completed into player_mistakes, player_completed
    from public.puzzle_battle_players
    where puzzle_battle_players.battle_id = v_battle_id
      and user_id = '00000000-0000-0000-0000-000000000002';
  if player_mistakes <> 3 or not player_completed then
    raise exception 'Three strikes must be persisted server-side'; end if;

  for i in 2..5 loop
    select public.submit_puzzle_battle_answer(v_battle_id, '00000000-0000-0000-0000-000000000001', 'e2e4') into answer;
    if answer->>'correct' <> 'true' then raise exception 'Correct puzzle opener rejected on round %', i; end if;
    select public.submit_puzzle_battle_answer(v_battle_id, '00000000-0000-0000-0000-000000000001', 'g1f3') into answer;
    if answer->>'correct' <> 'true' or answer->>'puzzle_completed' <> 'true' then
      raise exception 'Final puzzle move failed on round %', i; end if;
  end loop;

  select status, winner_id into battle_status, winner from public.puzzle_battles where id = v_battle_id;
  select score, completed into player_score, player_completed
    from public.puzzle_battle_players
    where puzzle_battle_players.battle_id = v_battle_id
      and user_id = '00000000-0000-0000-0000-000000000001';
  if battle_status <> 'completed'
    or winner <> '00000000-0000-0000-0000-000000000001'
    or player_score <> 5
    or not player_completed then
    raise exception 'Final server result is wrong: status %, winner %, score %, completed %',
      battle_status, winner, player_score, player_completed;
  end if;
end;
$battle_flow_test$;

-- Puzzle Battle uses a separate Elo, monthly points, streak multiplier and a mistake tie-break.
do $battle_ratings_test$
declare
  v_first_battle uuid;
  v_tiebreak_battle uuid;
  v_rating integer;
  v_games integer;
  v_wins integer;
  v_losses integer;
  v_streak integer;
  v_points integer;
  v_battles integer;
  v_winner uuid;
  v_rating_applied boolean;
  v_rating_one_after integer;
  v_rating_two_after integer;
begin
  select id into v_first_battle
    from public.puzzle_battles
    where player_one_id = '00000000-0000-0000-0000-000000000001'
      and player_two_id = '00000000-0000-0000-0000-000000000002'
      and status = 'completed'
    order by created_at desc
    limit 1;
  if v_first_battle is null then raise exception 'The main battle test did not create a completed battle'; end if;

  select puzzle_battle_rating, puzzle_battle_games, puzzle_battle_wins,
         puzzle_battle_losses, puzzle_battle_win_streak
    into v_rating, v_games, v_wins, v_losses, v_streak
    from public.online_profiles
    where user_id = '00000000-0000-0000-0000-000000000001';
  if v_rating <> 1212 or v_games <> 1 or v_wins <> 1 or v_losses <> 0 or v_streak <> 1 then
    raise exception 'Puzzle Battle winner rating/stats mismatch: rating %, games %, wins %, losses %, streak %',
      v_rating, v_games, v_wins, v_losses, v_streak;
  end if;

  select points, battles into v_points, v_battles
    from public.puzzle_battle_season_stats
    where user_id = '00000000-0000-0000-0000-000000000001'
      and season_start = date_trunc('month', now())::date;
  if v_points <> 5 or v_battles <> 1 then
    raise exception 'First-win season points mismatch: points %, battles %', v_points, v_battles;
  end if;

  -- Applying the same completed result again must not award Elo or season points twice.
  perform public.apply_puzzle_battle_result(v_first_battle);
  select puzzle_battle_rating, puzzle_battle_games into v_rating, v_games
    from public.online_profiles
    where user_id = '00000000-0000-0000-0000-000000000001';
  if v_rating <> 1212 or v_games <> 1 then
    raise exception 'Puzzle Battle result settlement was not idempotent'; end if;

  -- Equal scores are decided by fewer mistakes, even when the timeout is what ends the battle.
  insert into public.puzzle_battles(
    player_one_id, player_two_id, duration_seconds, started_at, ends_at
  ) values (
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004',
    180, now(), now() + interval '180 seconds'
  ) returning id into v_tiebreak_battle;

  insert into public.puzzle_battle_players(
    battle_id, user_id, score, round_index, mistakes, completed
  ) values
    (v_tiebreak_battle, '00000000-0000-0000-0000-000000000003', 1, 1, 2, true),
    (v_tiebreak_battle, '00000000-0000-0000-0000-000000000004', 1, 1, 1, true);

  update public.puzzle_battles
    set status = 'completed', finish_reason = 'time'
    where id = v_tiebreak_battle;

  select winner_id, player_one_rating_after, player_two_rating_after, rating_applied
    into v_winner, v_rating_one_after, v_rating_two_after, v_rating_applied
    from public.puzzle_battles
    where id = v_tiebreak_battle;
  if v_winner <> '00000000-0000-0000-0000-000000000004'
    or v_rating_one_after <> 1188
    or v_rating_two_after <> 1212
    or not v_rating_applied then
    raise exception 'Puzzle Battle tie-break/rating settlement failed: winner %, ratings % / %, applied %',
      v_winner, v_rating_one_after, v_rating_two_after, v_rating_applied;
  end if;

  select points, battles into v_points, v_battles
    from public.puzzle_battle_season_stats
    where user_id = '00000000-0000-0000-0000-000000000004'
      and season_start = date_trunc('month', now())::date;
  if v_points <> 1 or v_battles <> 1 then
    raise exception 'Tie-break winner season points mismatch'; end if;

  select puzzle_battle_rating, puzzle_battle_wins, puzzle_battle_win_streak
    into v_rating, v_wins, v_streak
    from public.online_profiles
    where user_id = '00000000-0000-0000-0000-000000000004';
  if v_rating <> 1212 or v_wins <> 1 or v_streak <> 1 then
    raise exception 'Tie-break winner profile record mismatch'; end if;

  if not has_table_privilege('authenticated', 'public.puzzle_battle_season_stats', 'SELECT')
    or has_table_privilege('authenticated', 'public.puzzle_battle_season_stats', 'INSERT')
    or has_table_privilege('authenticated', 'public.puzzle_battle_season_stats', 'UPDATE')
    or has_table_privilege('anon', 'public.puzzle_battle_season_stats', 'SELECT') then
    raise exception 'Season leaderboard must be readable only to authenticated users'; end if;

  -- A second consecutive win increases the monthly points multiplier to x2.
  insert into public.puzzle_battles(
    player_one_id, player_two_id, duration_seconds, started_at, ends_at
  ) values (
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000005',
    180, now(), now() + interval '180 seconds'
  ) returning id into v_tiebreak_battle;

  insert into public.puzzle_battle_players(
    battle_id, user_id, score, round_index, mistakes, completed
  ) values
    (v_tiebreak_battle, '00000000-0000-0000-0000-000000000004', 1, 1, 0, true),
    (v_tiebreak_battle, '00000000-0000-0000-0000-000000000005', 0, 0, 3, true);

  update public.puzzle_battles
    set status = 'completed', finish_reason = 'score'
    where id = v_tiebreak_battle;

  select points, battles into v_points, v_battles
    from public.puzzle_battle_season_stats
    where user_id = '00000000-0000-0000-0000-000000000004'
      and season_start = date_trunc('month', now())::date;
  if v_points <> 3 or v_battles <> 2 then
    raise exception 'Second consecutive win must award two season points: points %, battles %',
      v_points, v_battles;
  end if;

  select puzzle_battle_rating, puzzle_battle_win_streak, puzzle_battle_best_win_streak
    into v_rating, v_streak, v_games
    from public.online_profiles
    where user_id = '00000000-0000-0000-0000-000000000004';
  if v_streak <> 2 or v_games <> 2 then
    raise exception 'Consecutive win streak did not increase to two: current %, best %', v_streak, v_games;
  end if;
end;
$battle_ratings_test$;

select 'Online SQL migrations, matchmaking, cloud progress, Puzzle Battle ratings and season tests passed.' as result;
SQL


-- Audit migration: preserve private tables while making participant policies and FK lookups efficient.
do $audit_indexes_rls_test$
declare
  policy_row record;
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'online_invites_game_id_idx') then
    raise exception 'Missing online_invites.game_id foreign key index';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'puzzle_battle_queue_battle_id_idx') then
    raise exception 'Missing puzzle_battle_queue.battle_id foreign key index';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'puzzle_battles_winner_id_idx') then
    raise exception 'Missing puzzle_battles.winner_id foreign key index';
  end if;

  for policy_row in
    select tablename, policyname, qual
    from pg_policies
    where schemaname = 'public'
      and policyname in (
        'participants read games',
        'puzzle battle participants read battle',
        'puzzle battle participants read players',
        'puzzle battle participants read rounds',
        'players read own puzzle queue state'
      )
  loop
    if policy_row.qual not ilike '%select auth.uid()%' then
      raise exception 'Policy %.% does not cache auth.uid(): %', policy_row.tablename, policy_row.policyname, policy_row.qual;
    end if;
  end loop;

  if (select count(*) from pg_policies
      where schemaname = 'public'
        and policyname in (
          'participants read games',
          'puzzle battle participants read battle',
          'puzzle battle participants read players',
          'puzzle battle participants read rounds',
          'players read own puzzle queue state'
        )) <> 5 then
    raise exception 'Expected all five participant policies to remain installed';
  end if;

  if has_table_privilege('authenticated', 'public.puzzle_battle_solutions', 'SELECT')
    or has_table_privilege('authenticated', 'public.puzzle_battle_queue_packs', 'SELECT')
    or has_table_privilege('anon', 'public.online_auth_rate_limits', 'SELECT') then
    raise exception 'Audit migration must not expose private server-only tables';
  end if;
end;
$audit_indexes_rls_test$;
