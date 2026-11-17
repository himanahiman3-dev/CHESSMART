create table if not exists public.player_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision integer not null default 1 check (revision >= 1),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 1500000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.player_progress_versions (
  user_id uuid not null references auth.users(id) on delete cascade,
  revision integer not null check (revision >= 1),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 1500000),
  saved_at timestamptz not null,
  primary key (user_id, revision)
);

create index if not exists player_progress_versions_recent_idx
  on public.player_progress_versions(user_id, revision desc);

alter table public.player_progress enable row level security;
alter table public.player_progress_versions enable row level security;

-- These snapshots are accessible only through the authenticated game-action Edge Function.
revoke all on table public.player_progress, public.player_progress_versions from public, anon, authenticated;
grant select, insert, update, delete on table public.player_progress, public.player_progress_versions to service_role;

create or replace function public.archive_player_progress_version()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $archive$
begin
  insert into public.player_progress_versions(user_id, revision, payload, saved_at)
  values (old.user_id, old.revision, old.payload, old.updated_at)
  on conflict (user_id, revision) do nothing;

  delete from public.player_progress_versions
  where user_id = old.user_id
    and revision not in (
      select revision
      from public.player_progress_versions
      where user_id = old.user_id
      order by revision desc
      limit 5
    );
  return new;
end;
$archive$;

revoke all on function public.archive_player_progress_version() from public, anon, authenticated;
grant execute on function public.archive_player_progress_version() to service_role;

drop trigger if exists player_progress_archive_before_update on public.player_progress;
create trigger player_progress_archive_before_update
  before update on public.player_progress
  for each row execute function public.archive_player_progress_version();
