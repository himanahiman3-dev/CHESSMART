import type { Color, Score } from "../types";

/** Win% (0..100) для БЕЛЫХ. Мат — 100% / 0%. */
export function winPercent(score: Score): number {
  if (score.mate !== undefined) {
    if (score.mate > 0) return 100;
    if (score.mate < 0) return 0;
    return 50;
  }
  const cp = Math.max(-10000, Math.min(10000, score.cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** Win% для заданной стороны. */
export function winFor(score: Score, color: Color): number {
  const w = winPercent(score);
  return color === "w" ? w : 100 - w;
}

/** Оценка в сантипешках с точки зрения стороны (мат → ±100000). */
export function cpFor(score: Score, color: Color): number {
  let v: number;
  if (score.mate !== undefined) v = score.mate > 0 ? 100000 - score.mate : -100000 - score.mate;
  else v = score.cp;
  return color === "w" ? v : -v;
}

/** Точность одного хода по потере Win% (формула chess.com / Lichess). */
export function moveAccuracy(winLoss: number): number {
  const a = 103.1668 * Math.exp(-0.04354 * winLoss) - 3.1669;
  return Math.max(0, Math.min(100, a));
}

function stdDev(arr: number[]): number {
  const m = arr.reduce((s, x) => s + x, 0) / arr.length;
  const v = arr.reduce((s, x) => s + (x - m) * (x - m), 0) / arr.length;
  return Math.sqrt(v);
}

/**
 * CAPS2-подобная итоговая точность.
 * Берётся среднее из: (1) средневзвешенной точности, где вес хода — волатильность
 * позиции (σ Win% в скользящем окне), (2) гармонического среднего.
 */
export function gameAccuracy(
  winSeries: number[],
  accuracies: number[],
  colors: Color[]
): { w: number; b: number } {
  const n = accuracies.length;
  if (n === 0) return { w: 100, b: 100 };
  const ws = Math.max(2, Math.min(8, Math.floor(winSeries.length / 10)));
  const windows: number[][] = [];
  const first = winSeries.slice(0, ws);
  for (let i = 0; i < ws - 2; i++) windows.push(first);
  for (let i = 0; i + ws <= winSeries.length; i++) windows.push(winSeries.slice(i, i + ws));
  const weights: number[] = [];
  for (let i = 0; i < n; i++) {
    const win = windows[Math.min(i, windows.length - 1)] ?? first;
    weights.push(Math.max(0.5, Math.min(12, stdDev(win))));
  }
  const calc = (side: Color) => {
    const idx: number[] = [];
    for (let i = 0; i < n; i++) if (colors[i] === side) idx.push(i);
    if (!idx.length) return 100;
    let wsum = 0;
    let acc = 0;
    let inv = 0;
    for (const i of idx) {
      wsum += weights[i];
      acc += accuracies[i] * weights[i];
      inv += 1 / Math.max(accuracies[i], 1);
    }
    const weighted = acc / wsum;
    const harmonic = idx.length / inv;
    return Math.max(0, Math.min(100, (weighted + harmonic) / 2));
  };
  return { w: calc("w"), b: calc("b") };
}

/** Ожидаемая точность для рейтинга R (эмпирическая кривая). */
function expectedAccuracy(r: number): number {
  return 52 + 44 * (1 - Math.exp(-r / 900));
}

/** Приблизительный «рейтинг партии» по точности и (опционально) Elo из PGN. */
export function estimateGameRating(accuracy: number, baseElo?: number): number {
  const a = Math.max(0, Math.min(accuracy, 99));
  let fromAcc: number;
  if (a <= 52) fromAcc = 100 + (a / 52) * 300;
  else fromAcc = Math.min(3200, -900 * Math.log(1 - Math.min(0.995, (a - 52) / 44)));
  fromAcc = Math.max(100, fromAcc);
  if (!baseElo || baseElo <= 0) return Math.round(fromAcc / 50) * 50;
  const delta = (accuracy - expectedAccuracy(baseElo)) * 90;
  const fromBase = baseElo + Math.max(-700, Math.min(700, delta));
  return Math.max(100, Math.min(3200, Math.round((fromAcc * 0.5 + fromBase * 0.5) / 10) * 10));
}
