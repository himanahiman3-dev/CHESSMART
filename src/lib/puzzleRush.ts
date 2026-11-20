export interface RushPuzzleCandidate {
  id: string;
  rating: number;
}

export function getRushTargetRating(score: number): number {
  const safeScore = Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0;
  return Math.min(2400, 1000 + Math.floor(safeScore / 2) * 100);
}

export function selectRushPuzzle<T extends RushPuzzleCandidate>(
  bank: T[],
  score: number,
  seenIds: readonly string[] = [],
  random: () => number = Math.random,
): T | null {
  if (!bank.length) return null;
  const seen = new Set(seenIds);
  const available = bank.filter((puzzle) => !seen.has(puzzle.id));
  if (!available.length) return null;

  const target = getRushTargetRating(score);
  const closest = [...available].sort(
    (left, right) => Math.abs(left.rating - target) - Math.abs(right.rating - target),
  );
  const inBand = closest.filter((puzzle) => Math.abs(puzzle.rating - target) <= 300);
  const pool = (inBand.length ? inBand : closest).slice(0, Math.min(40, inBand.length || closest.length));
  const rawIndex = random();
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(rawIndex * pool.length)));
  return pool[index] ?? null;
}

export interface PuzzleRushAttempt {
  id: string;
  mode: "3m" | "5m" | "survival";
  playedAt: string;
  score: number;
  mistakes: number;
  maxPuzzleRating: number;
}
