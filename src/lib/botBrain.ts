import type { EngineLine } from "../types";

const RANDOM_MOVE_CHANCE: Array<[number, number]> = [
  [150, 0.48],
  [250, 0.34],
  [350, 0.25],
  [500, 0.14],
  [700, 0.09],
  [900, 0.055],
  [1100, 0.035],
  [1300, 0.02],
  [1600, 0.012],
  [1900, 0.005],
];

function blunderChance(elo: number): number {
  for (const [limit, chance] of RANDOM_MOVE_CHANCE) if (elo <= limit) return chance;
  return 0;
}

function pickWeighted<T>(items: T[], weights: number[], random: () => number): T | null {
  if (!items.length) return null;
  const total = weights.slice(0, items.length).reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return items[0] ?? null;
  let value = random() * total;
  for (let index = 0; index < items.length; index++) {
    value -= Math.max(0, weights[index] ?? 0);
    if (value <= 0) return items[index] ?? null;
  }
  return items[items.length - 1] ?? null;
}

/**
 * Deliberately weak move policy for beginner bots.
 * Stockfish supplies legal candidate lines, while low-rated opponents sometimes
 * choose a random legal move. This is intentional: Skill Level alone stays much
 * too accurate for very low ratings on short searches.
 */
export function chooseBotMove(
  fen: string,
  lines: EngineLine[],
  legalUci: string[],
  elo: number,
  random: () => number = Math.random,
): string | null {
  if (!legalUci.length) return null;
  const legal = new Set(legalUci);
  const candidates = lines
    .map((line) => line.pv[0])
    .filter((uci): uci is string => !!uci && legal.has(uci));

  if (random() < blunderChance(elo)) {
    const randomMoves = legalUci.filter((uci) => !candidates.slice(0, 2).includes(uci));
    const pool = randomMoves.length ? randomMoves : legalUci;
    return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] ?? legalUci[0];
  }

  if (!candidates.length) return legalUci[Math.floor(random() * legalUci.length)] ?? null;
  if (elo <= 250) return pickWeighted(candidates, [0.22, 0.2, 0.2, 0.19, 0.19], random) ?? candidates[0];
  if (elo <= 500) return pickWeighted(candidates, [0.45, 0.24, 0.15, 0.1, 0.06], random) ?? candidates[0];
  if (elo <= 800) return pickWeighted(candidates, [0.62, 0.2, 0.1, 0.05, 0.03], random) ?? candidates[0];
  if (elo <= 1100) return pickWeighted(candidates, [0.76, 0.15, 0.06, 0.02, 0.01], random) ?? candidates[0];
  if (elo <= 1500) return pickWeighted(candidates, [0.88, 0.08, 0.025, 0.01, 0.005], random) ?? candidates[0];
  return candidates[0];
}

export function botMistakeLabel(elo: number): string {
  if (elo <= 250) return "Часто зевает фигуры и пропускает тактику";
  if (elo <= 500) return "Периодически ошибается в простых позициях";
  if (elo <= 800) return "Иногда пропускает вилки и висящие фигуры";
  if (elo <= 1100) return "Может допустить тактическую неточность";
  if (elo <= 1500) return "Редкие ошибки под давлением";
  return "Играет почти без случайных ошибок";
}
