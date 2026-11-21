export interface PuzzleBattleResultStanding {
  user_id: string;
  score: number;
  mistakes: number;
}

/** Score wins first; fewer mistakes break a score tie; equal records draw. */
export function determinePuzzleBattleWinner(
  players: readonly PuzzleBattleResultStanding[],
): string | null {
  if (players.length !== 2) return null;
  const [first, second] = players;
  if (
    !first.user_id || !second.user_id || first.user_id === second.user_id
    || !Number.isFinite(first.score) || !Number.isFinite(second.score)
    || !Number.isFinite(first.mistakes) || !Number.isFinite(second.mistakes)
  ) return null;

  if (first.score !== second.score) return first.score > second.score ? first.user_id : second.user_id;
  if (first.mistakes !== second.mistakes) return first.mistakes < second.mistakes ? first.user_id : second.user_id;
  return null;
}
