create extension if not exists pgcrypto;

create table if not exists public.online_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (char_length(username) between 1 and 24),
  bullet_rating integer not null default 1200 check (bullet_rating between 100 and 4000),
  blitz_rating integer not null default 1200 check (blitz_rating between 100 and 4000),
  rapid_rating integer not null default 1200 check (rapid_rating between 100 and 4000),
  bullet_games integer not null default 0,
  blitz_games integer not null default 0,
  rapid_games integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists online_profiles_username_lower_idx on public.online_profiles (lower(username));

create table if not exists public.online_games (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'completed')),
  white_id uuid not null references auth.users(id) on delete cascade,
  black_id uuid references auth.users(id) on delete set null,
  white_name text not null,
  black_name text,
  fen text not null default 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  moves jsonb not null default '[]'::jsonb,
  minutes integer not null check (minutes between 1 and 60),
  increment_seconds integer not null check (increment_seconds between 0 and 60),
  increment_ms bigint not null default 0,
  white_ms bigint not null,
  black_ms bigint not null,
  turn_started_at timestamptz,
  rated boolean not null default true,
  rating_type text not null check (rating_type in ('bullet', 'blitz', 'rapid')),
  result text,
  reason text,
  white_rating integer,
  black_rating integer,
  rating_applied boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (black_id is null or black_id <> white_id)
);

create index if not exists online_games_white_id_idx on public.online_games(white_id, created_at desc);
create index if not exists online_games_black_id_idx on public.online_games(black_id, created_at desc);
create index if not exists online_games_status_created_idx on public.online_games(status, created_at desc);

alter table public.online_profiles enable row level security;
alter table public.online_games enable row level security;

drop policy if exists "public profiles are readable" on public.online_profiles;
create policy "public profiles are readable" on public.online_profiles for select using (true);

-- Elo and game results are writable only by the server Edge Function using the service role.
drop policy if exists "players update own profile" on public.online_profiles;

drop policy if exists "participants read games" on public.online_games;
create policy "participants read games" on public.online_games for select
  using (auth.uid() = white_id or auth.uid() = black_id);

grant select on public.online_profiles to anon, authenticated;
grant select on public.online_games to authenticated;

-- One transaction updates both players and marks the rating as applied exactly once.
create or replace function public.apply_online_game_rating(p_game_id uuid)
returns setof public.online_games
language plpgsql
security definer
set search_path = public, pg_temp
as $chessmart$
declare
  g public.online_games%rowtype;
  white_profile public.online_profiles%rowtype;
  black_profile public.online_profiles%rowtype;
  field_name text;
  expected_white numeric;
  score_white numeric;
  k_white integer;
  k_black integer;
  next_white integer;
  next_black integer;
begin
  select * into g from public.online_games where id = p_game_id for update;
  if not found then
    raise exception 'Game not found';
  end if;

  if g.status <> 'completed' or not g.rated or g.black_id is null or g.rating_applied then
    return query select * from public.online_games where id = p_game_id;
    return;
  end if;

  -- Lock both rows in a stable order to avoid deadlocks when players finish games concurrently.
  perform user_id from public.online_profiles
    where user_id in (g.white_id, g.black_id)
    order by user_id
    for update;
  select * into white_profile from public.online_profiles where user_id = g.white_id;
  select * into black_profile from public.online_profiles where user_id = g.black_id;
  if white_profile.user_id is null or black_profile.user_id is null then
    raise exception 'Player profile not found';
  end if;

  field_name := case g.rating_type
    when 'bullet' then 'bullet_rating'
    when 'blitz' then 'blitz_rating'
    else 'rapid_rating'
  end;
  if field_name = 'bullet_rating' then
    expected_white := 1 / (1 + power(10::numeric, (black_profile.bullet_rating - white_profile.bullet_rating)::numeric / 400));
    k_white := case when white_profile.bullet_games < 30 then 40 else 32 end;
    k_black := case when black_profile.bullet_games < 30 then 40 else 32 end;
  elsif field_name = 'blitz_rating' then
    expected_white := 1 / (1 + power(10::numeric, (black_profile.blitz_rating - white_profile.blitz_rating)::numeric / 400));
    k_white := case when white_profile.blitz_games < 30 then 40 else 32 end;
    k_black := case when black_profile.blitz_games < 30 then 40 else 32 end;
  else
    expected_white := 1 / (1 + power(10::numeric, (black_profile.rapid_rating - white_profile.rapid_rating)::numeric / 400));
    k_white := case when white_profile.rapid_games < 30 then 40 else 32 end;
    k_black := case when black_profile.rapid_games < 30 then 40 else 32 end;
  end if;

  score_white := case g.result when 'white_win' then 1 when 'black_win' then 0 else 0.5 end;
  if field_name = 'bullet_rating' then
    next_white := greatest(100, least(4000, round(white_profile.bullet_rating + k_white * (score_white - expected_white))::integer));
    next_black := greatest(100, least(4000, round(black_profile.bullet_rating + k_black * ((1 - score_white) - (1 - expected_white)))::integer));
    update public.online_profiles set bullet_rating = next_white, bullet_games = bullet_games + 1, updated_at = now() where user_id = g.white_id;
    update public.online_profiles set bullet_rating = next_black, bullet_games = bullet_games + 1, updated_at = now() where user_id = g.black_id;
  elsif field_name = 'blitz_rating' then
    next_white := greatest(100, least(4000, round(white_profile.blitz_rating + k_white * (score_white - expected_white))::integer));
    next_black := greatest(100, least(4000, round(black_profile.blitz_rating + k_black * ((1 - score_white) - (1 - expected_white)))::integer));
    update public.online_profiles set blitz_rating = next_white, blitz_games = blitz_games + 1, updated_at = now() where user_id = g.white_id;
    update public.online_profiles set blitz_rating = next_black, blitz_games = blitz_games + 1, updated_at = now() where user_id = g.black_id;
  else
    next_white := greatest(100, least(4000, round(white_profile.rapid_rating + k_white * (score_white - expected_white))::integer));
    next_black := greatest(100, least(4000, round(black_profile.rapid_rating + k_black * ((1 - score_white) - (1 - expected_white)))::integer));
    update public.online_profiles set rapid_rating = next_white, rapid_games = rapid_games + 1, updated_at = now() where user_id = g.white_id;
    update public.online_profiles set rapid_rating = next_black, rapid_games = rapid_games + 1, updated_at = now() where user_id = g.black_id;
  end if;

  update public.online_games
    set white_rating = next_white, black_rating = next_black, rating_applied = true, updated_at = now()
    where id = p_game_id;

  return query select * from public.online_games where id = p_game_id;
end;
$chessmart$;

revoke all on function public.apply_online_game_rating(uuid) from public;
grant execute on function public.apply_online_game_rating(uuid) to service_role;
