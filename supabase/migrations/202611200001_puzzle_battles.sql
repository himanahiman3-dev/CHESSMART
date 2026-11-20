create table if not exists public.puzzle_battles (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  player_one_id uuid not null references auth.users(id) on delete cascade,
  player_two_id uuid not null references auth.users(id) on delete cascade,
  duration_seconds integer not null default 180 check (duration_seconds between 60 and 600),
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  finished_at timestamptz,
  winner_id uuid references auth.users(id) on delete set null,
  finish_reason text check (finish_reason in ('score', 'time', 'forfeit')),
  created_at timestamptz not null default now(),
  check (player_one_id <> player_two_id)
);
create index if not exists puzzle_battles_player_one_idx on public.puzzle_battles(player_one_id, created_at desc);
create index if not exists puzzle_battles_player_two_idx on public.puzzle_battles(player_two_id, created_at desc);
create index if not exists puzzle_battles_active_expiry_idx on public.puzzle_battles(status, ends_at);

create table if not exists public.puzzle_battle_queue (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rating integer not null check (rating between 100 and 4000),
  status text not null default 'waiting' check (status in ('waiting', 'matched')),
  battle_id uuid references public.puzzle_battles(id) on delete set null,
  queued_at timestamptz not null default now()
);
create index if not exists puzzle_battle_queue_waiting_idx on public.puzzle_battle_queue(status, rating, queued_at);

-- Challenge packs and answer keys are server-only. Browser roles have no grants or RLS policies.
create table if not exists public.puzzle_battle_queue_packs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  puzzles jsonb not null check (jsonb_typeof(puzzles) = 'array' and jsonb_array_length(puzzles) = 5),
  created_at timestamptz not null default now()
);
create table if not exists public.puzzle_battle_rounds (
  battle_id uuid not null references public.puzzle_battles(id) on delete cascade,
  round_no smallint not null check (round_no between 1 and 5),
  puzzle_id text not null,
  fen text not null check (char_length(fen) between 20 and 120),
  color text not null check (color in ('w', 'b')),
  rating integer not null check (rating between 100 and 4000),
  themes text[] not null default '{}',
  primary key (battle_id, round_no)
);
create table if not exists public.puzzle_battle_solutions (
  battle_id uuid not null references public.puzzle_battles(id) on delete cascade,
  round_no smallint not null,
  moves jsonb not null check (jsonb_typeof(moves) = 'array' and jsonb_array_length(moves) between 1 and 100),
  primary key (battle_id, round_no),
  foreign key (battle_id, round_no) references public.puzzle_battle_rounds(battle_id, round_no) on delete cascade
);
create table if not exists public.puzzle_battle_players (
  battle_id uuid not null references public.puzzle_battles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  score smallint not null default 0 check (score between 0 and 5),
  round_index smallint not null default 0 check (round_index between 0 and 5),
  move_index smallint not null default 0 check (move_index between 0 and 100),
  mistakes smallint not null default 0 check (mistakes between 0 and 3),
  completed boolean not null default false,
  last_active_at timestamptz not null default now(),
  primary key (battle_id, user_id)
);
create index if not exists puzzle_battle_players_user_idx on public.puzzle_battle_players(user_id, battle_id);

alter table public.puzzle_battles enable row level security;
alter table public.puzzle_battle_queue enable row level security;
alter table public.puzzle_battle_queue_packs enable row level security;
alter table public.puzzle_battle_rounds enable row level security;
alter table public.puzzle_battle_solutions enable row level security;
alter table public.puzzle_battle_players enable row level security;

revoke all on public.puzzle_battle_queue, public.puzzle_battle_queue_packs,
  public.puzzle_battle_solutions from anon, authenticated;
revoke all on public.puzzle_battles, public.puzzle_battle_rounds, public.puzzle_battle_players
  from anon, authenticated;
grant select on public.puzzle_battles, public.puzzle_battle_rounds, public.puzzle_battle_players
  to authenticated;
grant select on public.puzzle_battle_queue to authenticated;

create policy "puzzle battle participants read battle"
  on public.puzzle_battles for select to authenticated
  using (auth.uid() = player_one_id or auth.uid() = player_two_id);
create policy "puzzle battle participants read players"
  on public.puzzle_battle_players for select to authenticated
  using (
    exists (
      select 1 from public.puzzle_battles b
      where b.id = puzzle_battle_players.battle_id
        and (auth.uid() = b.player_one_id or auth.uid() = b.player_two_id)
    )
  );
create policy "puzzle battle participants read rounds"
  on public.puzzle_battle_rounds for select to authenticated
  using (
    exists (
      select 1 from public.puzzle_battles b
      where b.id = puzzle_battle_rounds.battle_id
        and (auth.uid() = b.player_one_id or auth.uid() = b.player_two_id)
    )
  );
create policy "players read own puzzle queue state"
  on public.puzzle_battle_queue for select to authenticated
  using (auth.uid() = user_id);

grant all on public.puzzle_battles, public.puzzle_battle_queue, public.puzzle_battle_queue_packs,
  public.puzzle_battle_rounds, public.puzzle_battle_solutions, public.puzzle_battle_players
  to service_role;

create or replace function public.join_puzzle_battle_queue(
  p_user_id uuid,
  p_rating integer,
  p_puzzles jsonb
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $join_battle$
declare
  v_opponent_id uuid;
  v_opponent_rating integer;
  v_opponent_pack jsonb;
  v_battle_id uuid;
  v_expired_id uuid;
  v_puzzle jsonb;
begin
  if p_user_id is null or p_rating < 100 or p_rating > 4000 then
    raise exception 'Invalid player or rating';
  end if;
  if jsonb_typeof(p_puzzles) <> 'array' or jsonb_array_length(p_puzzles) <> 5 then
    raise exception 'A battle requires exactly five puzzles';
  end if;

  -- Serialize queue changes so simultaneous arrivals cannot both miss each other.
  perform pg_advisory_xact_lock(hashtext('chessmart:puzzle-battle-queue'));

  for v_puzzle in select value from jsonb_array_elements(p_puzzles) as items(value)
  loop
    if coalesce(v_puzzle->>'id', '') = ''
      or coalesce(v_puzzle->>'fen', '') = ''
      or coalesce(jsonb_typeof(v_puzzle->'moves'), '') <> 'array'
      or case when jsonb_typeof(v_puzzle->'moves') = 'array'
        then jsonb_array_length(v_puzzle->'moves') < 1
          or jsonb_array_length(v_puzzle->'moves') > 100
        else true end
      or v_puzzle->>'color' is null
      or v_puzzle->>'color' not in ('w', 'b')
      or case when jsonb_typeof(v_puzzle->'moves') = 'array' then exists (
        select 1 from jsonb_array_elements_text(v_puzzle->'moves') as mv(value)
        where value !~ '^[a-h][1-8][a-h][1-8][qrbn]?
      raise exception 'Invalid puzzle pack';
    end if;
  end loop;

  select id into v_battle_id
    from public.puzzle_battles
    where status = 'active' and ends_at > now()
      and (player_one_id = p_user_id or player_two_id = p_user_id)
    order by created_at desc limit 1;
  if v_battle_id is not null then
    return jsonb_build_object('queued', false, 'battle_id', v_battle_id, 'already_active', true);
  end if;

  delete from public.puzzle_battle_queue where user_id = p_user_id;
  delete from public.puzzle_battle_queue_packs where user_id = p_user_id;

  for v_expired_id in
    select user_id from public.puzzle_battle_queue
    where status = 'waiting' and queued_at < now() - interval '5 minutes'
  loop
    delete from public.puzzle_battle_queue_packs where user_id = v_expired_id;
    delete from public.puzzle_battle_queue where user_id = v_expired_id;
  end loop;

  select q.user_id, q.rating into v_opponent_id, v_opponent_rating
    from public.puzzle_battle_queue q
    where q.status = 'waiting'
      and q.user_id <> p_user_id
      and abs(q.rating - p_rating) <= 600
    order by abs(q.rating - p_rating), q.queued_at
    limit 1
    for update skip locked;

  if v_opponent_id is null then
    insert into public.puzzle_battle_queue(user_id, rating, status, queued_at)
      values (p_user_id, p_rating, 'waiting', now());
    insert into public.puzzle_battle_queue_packs(user_id, puzzles)
      values (p_user_id, p_puzzles);
    return jsonb_build_object('queued', true, 'battle_id', null);
  end if;

  select puzzles into v_opponent_pack
    from public.puzzle_battle_queue_packs
    where user_id = v_opponent_id
    for update;
  if v_opponent_pack is null or jsonb_array_length(v_opponent_pack) <> 5 then
    delete from public.puzzle_battle_queue_packs where user_id = v_opponent_id;
    delete from public.puzzle_battle_queue where user_id = v_opponent_id;
    insert into public.puzzle_battle_queue(user_id, rating, status, queued_at)
      values (p_user_id, p_rating, 'waiting', now());
    insert into public.puzzle_battle_queue_packs(user_id, puzzles)
      values (p_user_id, p_puzzles);
    return jsonb_build_object('queued', true, 'battle_id', null);
  end if;

  insert into public.puzzle_battles(
    player_one_id, player_two_id, status, duration_seconds, started_at, ends_at
  ) values (
    v_opponent_id, p_user_id, 'active', 180, now(), now() + interval '180 seconds'
  ) returning id into v_battle_id;

  insert into public.puzzle_battle_rounds(battle_id, round_no, puzzle_id, fen, color, rating, themes)
  select v_battle_id,
    ordinality::smallint,
    value->>'id',
    value->>'fen',
    value->>'color',
    greatest(100, least(4000, coalesce((value->>'rating')::integer, 1200))),
    array(select jsonb_array_elements_text(coalesce(value->'themes', '[]'::jsonb)))
  from jsonb_array_elements(v_opponent_pack) with ordinality as puzzles(value, ordinality);

  insert into public.puzzle_battle_solutions(battle_id, round_no, moves)
  select v_battle_id, ordinality::smallint, value->'moves'
  from jsonb_array_elements(v_opponent_pack) with ordinality as puzzles(value, ordinality);

  insert into public.puzzle_battle_players(battle_id, user_id)
  values (v_battle_id, v_opponent_id), (v_battle_id, p_user_id);

  update public.puzzle_battle_queue
    set status = 'matched', battle_id = v_battle_id
    where user_id = v_opponent_id;
  insert into public.puzzle_battle_queue(user_id, rating, status, battle_id, queued_at)
    values (p_user_id, p_rating, 'matched', v_battle_id, now());
  delete from public.puzzle_battle_queue_packs where user_id in (v_opponent_id, p_user_id);

  return jsonb_build_object('queued', false, 'battle_id', v_battle_id, 'already_active', false);
end;
$join_battle$;

create or replace function public.submit_puzzle_battle_answer(
  p_battle_id uuid,
  p_user_id uuid,
  p_uci text
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $submit_battle$
declare
  v_battle public.puzzle_battles%rowtype;
  v_player public.puzzle_battle_players%rowtype;
  v_moves jsonb;
  v_expected text;
  v_reply text;
  v_next_index integer;
  v_new_round smallint;
  v_new_score smallint;
  v_new_mistakes smallint;
  v_new_completed boolean;
  v_puzzle_completed boolean := false;
  v_all_done boolean;
  v_winner uuid;
begin
  if p_uci !~ '^[a-h][1-8][a-h][1-8][qrbn]?$' then
    raise exception 'Invalid move format';
  end if;
  select * into v_battle from public.puzzle_battles where id = p_battle_id for update;
  if v_battle.id is null then raise exception 'Battle not found'; end if;
  if v_battle.status <> 'active' then
    return jsonb_build_object('correct', false, 'finished', true, 'reason', v_battle.finish_reason);
  end if;
  if v_battle.ends_at <= now() then
    select case when p1.score > p2.score then p1.user_id when p2.score > p1.score then p2.user_id else null end
      into v_winner
      from public.puzzle_battle_players p1
      join public.puzzle_battle_players p2 on p2.battle_id = p1.battle_id and p2.user_id <> p1.user_id
      where p1.battle_id = p_battle_id and p1.user_id = v_battle.player_one_id;
    update public.puzzle_battles set status = 'completed', finished_at = now(),
      winner_id = v_winner, finish_reason = 'time' where id = p_battle_id;
    return jsonb_build_object('correct', false, 'finished', true, 'reason', 'time');
  end if;

  select * into v_player from public.puzzle_battle_players
    where battle_id = p_battle_id and user_id = p_user_id for update;
  if v_player.user_id is null then raise exception 'You are not a participant in this battle'; end if;
  if v_player.completed then
    return jsonb_build_object('correct', false, 'finished', true, 'reason', 'player_completed');
  end if;
  if v_player.round_index >= 5 then
    update public.puzzle_battle_players set completed = true
      where battle_id = p_battle_id and user_id = p_user_id;
    return jsonb_build_object('correct', false, 'finished', true, 'reason', 'all_puzzles_solved');
  end if;

  select moves into v_moves from public.puzzle_battle_solutions
    where battle_id = p_battle_id and round_no = v_player.round_index + 1;
  if v_moves is null then raise exception 'Puzzle solution is missing'; end if;
  v_expected := v_moves ->> v_player.move_index;
  if v_expected is null then raise exception 'Puzzle is already complete'; end if;

  if p_uci <> v_expected then
    v_new_mistakes := v_player.mistakes + 1;
    v_new_completed := v_new_mistakes >= 3;
    v_puzzle_completed := false;
    update public.puzzle_battle_players set mistakes = v_new_mistakes,
      completed = v_new_completed, last_active_at = now()
      where battle_id = p_battle_id and user_id = p_user_id;
  else
    v_reply := v_moves ->> (v_player.move_index + 1);
    v_next_index := v_player.move_index + 2;
    v_new_round := v_player.round_index;
    v_new_score := v_player.score;
    v_new_completed := false;
    if v_next_index >= jsonb_array_length(v_moves) then
      v_new_round := v_player.round_index + 1;
      v_new_score := v_player.score + 1;
      v_next_index := 0;
      v_new_completed := v_new_round >= 5;
      v_puzzle_completed := true;
    end if;
    update public.puzzle_battle_players set
      score = v_new_score,
      round_index = v_new_round,
      move_index = v_next_index,
      completed = v_new_completed,
      last_active_at = now()
      where battle_id = p_battle_id and user_id = p_user_id;
  end if;

  select not exists (
    select 1 from public.puzzle_battle_players
    where battle_id = p_battle_id and not completed
  ) into v_all_done;
  if v_all_done then
    select case when p1.score > p2.score then p1.user_id when p2.score > p1.score then p2.user_id else null end
      into v_winner
      from public.puzzle_battle_players p1
      join public.puzzle_battle_players p2 on p2.battle_id = p1.battle_id and p2.user_id <> p1.user_id
      where p1.battle_id = p_battle_id and p1.user_id = v_battle.player_one_id;
    update public.puzzle_battles set status = 'completed', finished_at = now(),
      winner_id = v_winner, finish_reason = 'score' where id = p_battle_id;
  end if;

  select * into v_player from public.puzzle_battle_players
    where battle_id = p_battle_id and user_id = p_user_id;
  return jsonb_build_object(
    'correct', p_uci = v_expected,
    'opponent_reply', case when p_uci = v_expected then v_reply else null end,
    'puzzle_completed', v_puzzle_completed,
    'score', v_player.score,
    'round_index', v_player.round_index,
    'mistakes', v_player.mistakes,
    'completed', v_player.completed,
    'battle_finished', v_all_done
  );
end;
$submit_battle$;

revoke all on function public.join_puzzle_battle_queue(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.submit_puzzle_battle_answer(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.join_puzzle_battle_queue(uuid, integer, jsonb) to service_role;
grant execute on function public.submit_puzzle_battle_answer(uuid, uuid, text) to service_role;

do $publication$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'puzzle_battles') then
      alter publication supabase_realtime add table public.puzzle_battles;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'puzzle_battle_players') then
      alter publication supabase_realtime add table public.puzzle_battle_players;
    end if;
  end if;
end;
$publication$;


      ) else true end then
      raise exception 'Invalid puzzle pack';
    end if;
  end loop;

  select id into v_battle_id
    from public.puzzle_battles
    where status = 'active' and ends_at > now()
      and (player_one_id = p_user_id or player_two_id = p_user_id)
    order by created_at desc limit 1;
  if v_battle_id is not null then
    return jsonb_build_object('queued', false, 'battle_id', v_battle_id, 'already_active', true);
  end if;

  delete from public.puzzle_battle_queue where user_id = p_user_id;
  delete from public.puzzle_battle_queue_packs where user_id = p_user_id;

  for v_expired_id in
    select user_id from public.puzzle_battle_queue
    where status = 'waiting' and queued_at < now() - interval '5 minutes'
  loop
    delete from public.puzzle_battle_queue_packs where user_id = v_expired_id;
    delete from public.puzzle_battle_queue where user_id = v_expired_id;
  end loop;

  select q.user_id, q.rating into v_opponent_id, v_opponent_rating
    from public.puzzle_battle_queue q
    where q.status = 'waiting'
      and q.user_id <> p_user_id
      and abs(q.rating - p_rating) <= 600
    order by abs(q.rating - p_rating), q.queued_at
    limit 1
    for update skip locked;

  if v_opponent_id is null then
    insert into public.puzzle_battle_queue(user_id, rating, status, queued_at)
      values (p_user_id, p_rating, 'waiting', now());
    insert into public.puzzle_battle_queue_packs(user_id, puzzles)
      values (p_user_id, p_puzzles);
    return jsonb_build_object('queued', true, 'battle_id', null);
  end if;

  select puzzles into v_opponent_pack
    from public.puzzle_battle_queue_packs
    where user_id = v_opponent_id
    for update;
  if v_opponent_pack is null or jsonb_array_length(v_opponent_pack) <> 5 then
    delete from public.puzzle_battle_queue_packs where user_id = v_opponent_id;
    delete from public.puzzle_battle_queue where user_id = v_opponent_id;
    insert into public.puzzle_battle_queue(user_id, rating, status, queued_at)
      values (p_user_id, p_rating, 'waiting', now());
    insert into public.puzzle_battle_queue_packs(user_id, puzzles)
      values (p_user_id, p_puzzles);
    return jsonb_build_object('queued', true, 'battle_id', null);
  end if;

  insert into public.puzzle_battles(
    player_one_id, player_two_id, status, duration_seconds, started_at, ends_at
  ) values (
    v_opponent_id, p_user_id, 'active', 180, now(), now() + interval '180 seconds'
  ) returning id into v_battle_id;

  insert into public.puzzle_battle_rounds(battle_id, round_no, puzzle_id, fen, color, rating, themes)
  select v_battle_id,
    ordinality::smallint,
    value->>'id',
    value->>'fen',
    value->>'color',
    greatest(100, least(4000, coalesce((value->>'rating')::integer, 1200))),
    array(select jsonb_array_elements_text(coalesce(value->'themes', '[]'::jsonb)))
  from jsonb_array_elements(v_opponent_pack) with ordinality as puzzles(value, ordinality);

  insert into public.puzzle_battle_solutions(battle_id, round_no, moves)
  select v_battle_id, ordinality::smallint, value->'moves'
  from jsonb_array_elements(v_opponent_pack) with ordinality as puzzles(value, ordinality);

  insert into public.puzzle_battle_players(battle_id, user_id)
  values (v_battle_id, v_opponent_id), (v_battle_id, p_user_id);

  update public.puzzle_battle_queue
    set status = 'matched', battle_id = v_battle_id
    where user_id = v_opponent_id;
  insert into public.puzzle_battle_queue(user_id, rating, status, battle_id, queued_at)
    values (p_user_id, p_rating, 'matched', v_battle_id, now());
  delete from public.puzzle_battle_queue_packs where user_id in (v_opponent_id, p_user_id);

  return jsonb_build_object('queued', false, 'battle_id', v_battle_id, 'already_active', false);
end;
$join_battle$;

create or replace function public.submit_puzzle_battle_answer(
  p_battle_id uuid,
  p_user_id uuid,
  p_uci text
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $submit_battle$
declare
  v_battle public.puzzle_battles%rowtype;
  v_player public.puzzle_battle_players%rowtype;
  v_moves jsonb;
  v_expected text;
  v_reply text;
  v_next_index integer;
  v_new_round smallint;
  v_new_score smallint;
  v_new_mistakes smallint;
  v_new_completed boolean;
  v_puzzle_completed boolean := false;
  v_all_done boolean;
  v_winner uuid;
begin
  if p_uci !~ '^[a-h][1-8][a-h][1-8][qrbn]?$' then
    raise exception 'Invalid move format';
  end if;
  select * into v_battle from public.puzzle_battles where id = p_battle_id for update;
  if v_battle.id is null then raise exception 'Battle not found'; end if;
  if v_battle.status <> 'active' then
    return jsonb_build_object('correct', false, 'finished', true, 'reason', v_battle.finish_reason);
  end if;
  if v_battle.ends_at <= now() then
    select case when p1.score > p2.score then p1.user_id when p2.score > p1.score then p2.user_id else null end
      into v_winner
      from public.puzzle_battle_players p1
      join public.puzzle_battle_players p2 on p2.battle_id = p1.battle_id and p2.user_id <> p1.user_id
      where p1.battle_id = p_battle_id and p1.user_id = v_battle.player_one_id;
    update public.puzzle_battles set status = 'completed', finished_at = now(),
      winner_id = v_winner, finish_reason = 'time' where id = p_battle_id;
    return jsonb_build_object('correct', false, 'finished', true, 'reason', 'time');
  end if;

  select * into v_player from public.puzzle_battle_players
    where battle_id = p_battle_id and user_id = p_user_id for update;
  if v_player.user_id is null then raise exception 'You are not a participant in this battle'; end if;
  if v_player.completed then
    return jsonb_build_object('correct', false, 'finished', true, 'reason', 'player_completed');
  end if;
  if v_player.round_index >= 5 then
    update public.puzzle_battle_players set completed = true
      where battle_id = p_battle_id and user_id = p_user_id;
    return jsonb_build_object('correct', false, 'finished', true, 'reason', 'all_puzzles_solved');
  end if;

  select moves into v_moves from public.puzzle_battle_solutions
    where battle_id = p_battle_id and round_no = v_player.round_index + 1;
  if v_moves is null then raise exception 'Puzzle solution is missing'; end if;
  v_expected := v_moves ->> v_player.move_index;
  if v_expected is null then raise exception 'Puzzle is already complete'; end if;

  if p_uci <> v_expected then
    v_new_mistakes := v_player.mistakes + 1;
    v_new_completed := v_new_mistakes >= 3;
    v_puzzle_completed := false;
    update public.puzzle_battle_players set mistakes = v_new_mistakes,
      completed = v_new_completed, last_active_at = now()
      where battle_id = p_battle_id and user_id = p_user_id;
  else
    v_reply := v_moves ->> (v_player.move_index + 1);
    v_next_index := v_player.move_index + 2;
    v_new_round := v_player.round_index;
    v_new_score := v_player.score;
    v_new_completed := false;
    if v_next_index >= jsonb_array_length(v_moves) then
      v_new_round := v_player.round_index + 1;
      v_new_score := v_player.score + 1;
      v_next_index := 0;
      v_new_completed := v_new_round >= 5;
      v_puzzle_completed := true;
    end if;
    update public.puzzle_battle_players set
      score = v_new_score,
      round_index = v_new_round,
      move_index = v_next_index,
      completed = v_new_completed,
      last_active_at = now()
      where battle_id = p_battle_id and user_id = p_user_id;
  end if;

  select not exists (
    select 1 from public.puzzle_battle_players
    where battle_id = p_battle_id and not completed
  ) into v_all_done;
  if v_all_done then
    select case when p1.score > p2.score then p1.user_id when p2.score > p1.score then p2.user_id else null end
      into v_winner
      from public.puzzle_battle_players p1
      join public.puzzle_battle_players p2 on p2.battle_id = p1.battle_id and p2.user_id <> p1.user_id
      where p1.battle_id = p_battle_id and p1.user_id = v_battle.player_one_id;
    update public.puzzle_battles set status = 'completed', finished_at = now(),
      winner_id = v_winner, finish_reason = 'score' where id = p_battle_id;
  end if;

  select * into v_player from public.puzzle_battle_players
    where battle_id = p_battle_id and user_id = p_user_id;
  return jsonb_build_object(
    'correct', p_uci = v_expected,
    'opponent_reply', case when p_uci = v_expected then v_reply else null end,
    'puzzle_completed', v_puzzle_completed,
    'score', v_player.score,
    'round_index', v_player.round_index,
    'mistakes', v_player.mistakes,
    'completed', v_player.completed,
    'battle_finished', v_all_done
  );
end;
$submit_battle$;

revoke all on function public.join_puzzle_battle_queue(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.submit_puzzle_battle_answer(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.join_puzzle_battle_queue(uuid, integer, jsonb) to service_role;
grant execute on function public.submit_puzzle_battle_answer(uuid, uuid, text) to service_role;

do $publication$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'puzzle_battles') then
      alter publication supabase_realtime add table public.puzzle_battles;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'puzzle_battle_players') then
      alter publication supabase_realtime add table public.puzzle_battle_players;
    end if;
  end if;
end;
$publication$;

