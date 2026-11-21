-- Deliver committed online-game snapshots over private Realtime Broadcast channels.
-- Postgres Changes remains enabled as an independent fallback.
create or replace function public.broadcast_online_game_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $chessmart$
begin
  perform realtime.send(
    jsonb_build_object(
      'record', jsonb_build_object(
        'id', new.id,
        'invite_code', new.invite_code,
        'status', new.status,
        'white_id', new.white_id,
        'black_id', new.black_id,
        'white_name', new.white_name,
        'black_name', new.black_name,
        'fen', new.fen,
        'moves', new.moves,
        'minutes', new.minutes,
        'increment_seconds', new.increment_seconds,
        'increment_ms', new.increment_ms,
        'white_ms', new.white_ms,
        'black_ms', new.black_ms,
        'turn_started_at', new.turn_started_at,
        'rated', new.rated,
        'rating_type', new.rating_type,
        'result', new.result,
        'reason', new.reason,
        'white_rating', new.white_rating,
        'black_rating', new.black_rating,
        'updated_at', new.updated_at
      )
    ),
    'game_update',
    'topic:' || new.id::text,
    true
  );
  return new;
end;
$chessmart$;

revoke all on function public.broadcast_online_game_update() from public, anon, authenticated;

drop trigger if exists online_games_broadcast_update on public.online_games;
create trigger online_games_broadcast_update
after update on public.online_games
for each row
when (old.updated_at is distinct from new.updated_at)
execute function public.broadcast_online_game_update();

-- Only authenticated participants in a game may subscribe to that game's private topic.
do $chessmart$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'realtime'
      and tablename = 'messages'
      and policyname = 'online game participants receive private broadcasts'
  ) then
    create policy "online game participants receive private broadcasts"
      on realtime.messages
      for select
      to authenticated
      using (
        extension = 'broadcast'
        and private is true
        and exists (
          select 1
          from public.online_games g
          where g.id::text = split_part((select realtime.topic()), ':', 2)
            and (
              g.white_id = (select auth.uid())
              or g.black_id = (select auth.uid())
            )
        )
      );
  end if;
end;
$chessmart$;
