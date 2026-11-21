-- CHESSMART audit: cover missing FK lookups and cache auth.uid() once per statement.
-- Authorization conditions and table grants remain unchanged.

create index if not exists online_invites_game_id_idx
  on public.online_invites(game_id);

create index if not exists puzzle_battle_queue_battle_id_idx
  on public.puzzle_battle_queue(battle_id);

create index if not exists puzzle_battles_winner_id_idx
  on public.puzzle_battles(winner_id);

drop policy if exists "participants read games" on public.online_games;
create policy "participants read games"
  on public.online_games for select
  using (
    (select auth.uid()) = white_id
    or (select auth.uid()) = black_id
  );

drop policy if exists "puzzle battle participants read battle" on public.puzzle_battles;
create policy "puzzle battle participants read battle"
  on public.puzzle_battles for select to authenticated
  using (
    (select auth.uid()) = player_one_id
    or (select auth.uid()) = player_two_id
  );

drop policy if exists "puzzle battle participants read players" on public.puzzle_battle_players;
create policy "puzzle battle participants read players"
  on public.puzzle_battle_players for select to authenticated
  using (
    exists (
      select 1 from public.puzzle_battles b
      where b.id = puzzle_battle_players.battle_id
        and (
          (select auth.uid()) = b.player_one_id
          or (select auth.uid()) = b.player_two_id
        )
    )
  );

drop policy if exists "puzzle battle participants read rounds" on public.puzzle_battle_rounds;
create policy "puzzle battle participants read rounds"
  on public.puzzle_battle_rounds for select to authenticated
  using (
    exists (
      select 1 from public.puzzle_battles b
      where b.id = puzzle_battle_rounds.battle_id
        and (
          (select auth.uid()) = b.player_one_id
          or (select auth.uid()) = b.player_two_id
        )
    )
  );

drop policy if exists "players read own puzzle queue state" on public.puzzle_battle_queue;
create policy "players read own puzzle queue state"
  on public.puzzle_battle_queue for select to authenticated
  using ((select auth.uid()) = user_id);
