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
