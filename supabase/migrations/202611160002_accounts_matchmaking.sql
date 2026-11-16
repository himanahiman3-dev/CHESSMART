create table if not exists public.online_matchmaking_queue (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rating_type text not null check (rating_type in ('bullet', 'blitz', 'rapid')),
  rating integer not null check (rating between 100 and 4000),
  minutes integer not null check (minutes between 1 and 60),
  increment_seconds integer not null check (increment_seconds between 0 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists online_matchmaking_rating_idx
  on public.online_matchmaking_queue(rating_type, rating, created_at);

create table if not exists public.online_invites (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.online_games(id) on delete cascade,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_user <> to_user)
);
create index if not exists online_invites_inbox_idx
  on public.online_invites(to_user, status, created_at desc);
create unique index if not exists online_invites_pending_pair_idx
  on public.online_invites(from_user, to_user) where status = 'pending';

alter table public.online_matchmaking_queue enable row level security;
alter table public.online_invites enable row level security;
-- No browser policies: only the Edge Function's service-role client can touch queue/invitations.

create or replace function public.match_online_player(
  p_user_id uuid,
  p_rating_type text,
  p_minutes integer,
  p_increment_seconds integer
)
returns setof public.online_games
language plpgsql
security definer
set search_path = public, pg_temp
as $matchmaker$
declare
  me public.online_profiles%rowtype;
  opponent_queue public.online_matchmaking_queue%rowtype;
  opponent public.online_profiles%rowtype;
  existing_game public.online_games%rowtype;
  game_id uuid;
  invite text;
  initial_ms integer;
  allowed_gap integer;
  waited_seconds integer;
  white_id uuid;
  black_id uuid;
begin
  if p_rating_type not in ('bullet', 'blitz', 'rapid') then
    raise exception 'Invalid rating type';
  end if;

  select * into me from public.online_profiles where user_id = p_user_id;
  if me.user_id is null then raise exception 'Player profile not found'; end if;

  delete from public.online_matchmaking_queue
    where created_at < now() - interval '5 minutes';

  -- Return an already-started game if the browser polls again after being paired.
  select * into existing_game
    from public.online_games g
    where g.status = 'active' and (g.white_id = p_user_id or g.black_id = p_user_id)
    order by g.created_at desc
    limit 1;
  if existing_game.id is not null then
    delete from public.online_matchmaking_queue where user_id = p_user_id;
    return query select * from public.online_games where id = existing_game.id;
    return;
  end if;

  waited_seconds := 0;
  select extract(epoch from (now() - created_at))::integer into waited_seconds
    from public.online_matchmaking_queue where user_id = p_user_id;
  waited_seconds := greatest(0, coalesce(waited_seconds, 0));
  allowed_gap := least(700, 120 + waited_seconds * 8);

  select q.* into opponent_queue
    from public.online_matchmaking_queue q
    join public.online_profiles p on p.user_id = q.user_id
    where q.user_id <> p_user_id
      and q.rating_type = p_rating_type
      and q.minutes = p_minutes
      and q.increment_seconds = p_increment_seconds
      and abs(q.rating - case p_rating_type
        when 'bullet' then me.bullet_rating
        when 'blitz' then me.blitz_rating
        else me.rapid_rating end) <= allowed_gap
      and not exists (
        select 1 from public.online_games active_game
        where active_game.status = 'active'
          and (active_game.white_id = q.user_id or active_game.black_id = q.user_id)
      )
    order by abs(q.rating - case p_rating_type
        when 'bullet' then me.bullet_rating
        when 'blitz' then me.blitz_rating
        else me.rapid_rating end),
      q.created_at
    limit 1
    for update of q skip locked;

  if opponent_queue.user_id is null then
    insert into public.online_matchmaking_queue(user_id, rating_type, rating, minutes, increment_seconds, created_at, updated_at)
    values (
      p_user_id,
      p_rating_type,
      case p_rating_type when 'bullet' then me.bullet_rating when 'blitz' then me.blitz_rating else me.rapid_rating end,
      p_minutes,
      p_increment_seconds,
      now(),
      now()
    )
    on conflict (user_id) do update
      set rating_type = excluded.rating_type,
          rating = excluded.rating,
          minutes = excluded.minutes,
          increment_seconds = excluded.increment_seconds,
          updated_at = now();
    return;
  end if;

  select * into opponent from public.online_profiles where user_id = opponent_queue.user_id;
  delete from public.online_matchmaking_queue where user_id in (p_user_id, opponent_queue.user_id);

  if random() < 0.5 then
    white_id := p_user_id;
    black_id := opponent_queue.user_id;
  else
    white_id := opponent_queue.user_id;
    black_id := p_user_id;
  end if;

  invite := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 8));
  initial_ms := greatest(1, p_minutes) * 60000;

  insert into public.online_games(
    invite_code, status, white_id, black_id, white_name, black_name,
    fen, moves, minutes, increment_seconds, increment_ms,
    white_ms, black_ms, turn_started_at, rated, rating_type,
    white_rating, black_rating
  )
  values (
    invite, 'active', white_id, black_id,
    case when white_id = p_user_id then me.username else opponent.username end,
    case when black_id = p_user_id then me.username else opponent.username end,
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    '[]'::jsonb, p_minutes, p_increment_seconds, p_increment_seconds * 1000,
    initial_ms, initial_ms, now(), true, p_rating_type,
    case when white_id = p_user_id then
      case p_rating_type when 'bullet' then me.bullet_rating when 'blitz' then me.blitz_rating else me.rapid_rating end
    else
      case p_rating_type when 'bullet' then opponent.bullet_rating when 'blitz' then opponent.blitz_rating else opponent.rapid_rating end
    end,
    case when black_id = p_user_id then
      case p_rating_type when 'bullet' then me.bullet_rating when 'blitz' then me.blitz_rating else me.rapid_rating end
    else
      case p_rating_type when 'bullet' then opponent.bullet_rating when 'blitz' then opponent.blitz_rating else opponent.rapid_rating end
    end
  )
  returning id into game_id;

  return query select * from public.online_games where id = game_id;
end;
$matchmaker$;

create or replace function public.accept_online_invite(p_invite_id uuid, p_user_id uuid)
returns setof public.online_games
language plpgsql
security definer
set search_path = public, pg_temp
as $accept$
declare
  invitation public.online_invites%rowtype;
  g public.online_games%rowtype;
  player public.online_profiles%rowtype;
begin
  select * into invitation from public.online_invites
    where id = p_invite_id and to_user = p_user_id and status = 'pending'
    for update;
  if invitation.id is null then raise exception 'Invitation not found or expired'; end if;

  select * into g from public.online_games where id = invitation.game_id for update;
  if g.status <> 'waiting' or g.black_id is not null then
    update public.online_invites set status = 'expired', responded_at = now() where id = invitation.id;
    raise exception 'Game invitation has already expired';
  end if;
  select * into player from public.online_profiles where user_id = p_user_id;
  if player.user_id is null then raise exception 'Player profile not found'; end if;

  update public.online_games
    set black_id = p_user_id,
        black_name = player.username,
        black_rating = case g.rating_type
          when 'bullet' then player.bullet_rating
          when 'blitz' then player.blitz_rating
          else player.rapid_rating end,
        status = 'active',
        turn_started_at = now(),
        updated_at = now()
    where id = g.id;

  update public.online_invites set status = 'accepted', responded_at = now() where id = invitation.id;
  return query select * from public.online_games where id = g.id;
end;
$accept$;

revoke all on function public.match_online_player(uuid, text, integer, integer) from public;
revoke all on function public.accept_online_invite(uuid, uuid) from public;
grant execute on function public.match_online_player(uuid, text, integer, integer) to service_role;
grant execute on function public.accept_online_invite(uuid, uuid) to service_role;

create table if not exists public.online_auth_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null default now(),
  hits integer not null default 0
);
alter table public.online_auth_rate_limits enable row level security;

create or replace function public.consume_chessmart_auth_limit(
  p_bucket_key text,
  p_max_hits integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $rate_limit$
declare
  hit_count integer;
  window_seconds integer := greatest(60, least(86400, p_window_seconds));
begin
  insert into public.online_auth_rate_limits as existing(bucket_key, window_started_at, hits)
  values (p_bucket_key, now(), 1)
  on conflict (bucket_key) do update
    set window_started_at = case
      when existing.window_started_at <= now() - make_interval(secs => window_seconds) then now()
      else existing.window_started_at
    end,
    hits = case
      when existing.window_started_at <= now() - make_interval(secs => window_seconds) then 1
      else existing.hits + 1
    end
  returning hits into hit_count;
  return hit_count <= greatest(1, p_max_hits);
end;
$rate_limit$;

revoke all on function public.consume_chessmart_auth_limit(text, integer, integer) from public;
grant execute on function public.consume_chessmart_auth_limit(text, integer, integer) to service_role;
