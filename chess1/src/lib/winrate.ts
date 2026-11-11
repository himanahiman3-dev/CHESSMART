import type { Classification, EngineLine, Side } from "./types";

export const MATE_CP = 10000;

/** Win Rate from centipawns. WR = 1 / (1 + 10^(-CP/400)) */
export function cpToWinRate(cp: number): number {
  return 1 / (1 + Math.pow(10, -cp / 400));
}

/** Map a UCI mate score (moves to mate, signed) to a very large centipawn value, closer mates are larger. */
export function mateToCp(mate: number): number {
  if (mate === 0) return 0;
  const sign = mate > 0 ? 1 : -1;
  return sign * (MATE_CP - Math.min(Math.abs(mate), 200) * 10);
}

export function moverCp(cpWhite: number, color: Side): number {
  return color === "w" ? cpWhite : -cpWhite;
}

export function lineWinRateFor(line: EngineLine, color: Side): number {
  const wr = cpToWinRate(line.cp);
  return color === "w" ? wr : 1 - wr;
}

export function formatEval(cp: number, mate: number | null): string {
  if (mate !== null) {
    if (mate === 0) return cp > 0 ? "1-0" : "0-1";
    return `${mate > 0 ? "+" : "-"}M${Math.abs(mate)}`;
  }
  const v = cp / 100;
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

/** Short version for the evaluation bar ("0.3", "M4"). */
export function formatEvalShort(cp: number, mate: number | null): string {
  if (mate !== null) {
    if (mate === 0) return cp > 0 ? "1-0" : "0-1";
    return `M${Math.abs(mate)}`;
  }
  return Math.abs(cp / 100).toFixed(1);
}

/**
 * Per-move accuracy from the win-rate drop (in percentage points).
 *   accuracy = 103.1668 * exp(-0.04354 * ΔWR%) - 3.1669
 */
export function moveAccuracy(wrBefore: number, wrAfter: number): number {
  const diff = Math.max(0, (wrBefore - wrAfter) * 100);
  const acc = 103.1668 * Math.exp(-0.04354 * diff) - 3.1669 + 1; // +1 uncertainty bonus
  return Math.min(100, Math.max(0, acc));
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Game accuracy for one side: the average of
 *  - a volatility-weighted mean (moves played in sharp, volatile positions count more), and
 *  - the harmonic mean (punishes isolated bad moves).
 * `whiteWrSeries` is the White win-rate (in percent) of every position of the game (length = plies + 1).
 * `plies` are the move indices (0-based) belonging to the side; `accs` the matching move accuracies.
 */
export function gameAccuracy(accs: number[], plies: number[], whiteWrSeries: number[]): number {
  if (accs.length === 0) return 100;
  const n = whiteWrSeries.length;
  const half = Math.min(8, Math.max(2, Math.floor(n / 10)));
  let weightedSum = 0;
  let weightTotal = 0;
  let harmonicInv = 0;
  accs.forEach((acc, i) => {
    const p = plies[i];
    const window = whiteWrSeries.slice(Math.max(0, p - half), Math.min(n, p + half + 2));
    const weight = Math.min(12, Math.max(0.5, stdDev(window)));
    weightedSum += acc * weight;
    weightTotal += weight;
    harmonicInv += 1 / Math.max(acc, 0.5);
  });
  const weighted = weightedSum / weightTotal;
  const harmonic = accs.length / harmonicInv;
  return Math.min(100, Math.max(0, (weighted + harmonic) / 2));
}

export interface ClassMeta {
  key: Classification;
  label: string;
  symbol: string;
  color: string;
  text: string;
}

export const CLASS_META: Record<Classification, ClassMeta> = {
  brilliant: { key: "brilliant", label: "Brilliant", symbol: "!!", color: "#1baca6", text: "#ffffff" },
  great: { key: "great", label: "Great Move", symbol: "!", color: "#5c8bb0", text: "#ffffff" },
  best: { key: "best", label: "Best Move", symbol: "★", color: "#81b64c", text: "#ffffff" },
  excellent: { key: "excellent", label: "Excellent", symbol: "↗", color: "#96bc4b", text: "#ffffff" },
  good: { key: "good", label: "Good", symbol: "○", color: "#a6a6a0", text: "#262421" },
  inaccuracy: { key: "inaccuracy", label: "Inaccuracy", symbol: "?!", color: "#f7c631", text: "#262421" },
  mistake: { key: "mistake", label: "Mistake", symbol: "?", color: "#e58f2a", text: "#ffffff" },
  blunder: { key: "blunder", label: "Blunder", symbol: "??", color: "#ca3431", text: "#ffffff" },
};

export const CLASS_ORDER: Classification[] = [
  "brilliant",
  "great",
  "best",
  "excellent",
  "good",
  "inaccuracy",
  "mistake",
  "blunder",
];
