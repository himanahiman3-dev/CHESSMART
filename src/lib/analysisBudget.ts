import { Chess } from "chess.js";
/**
 * Device-aware local Stockfish review budgets.
 * Node counts are CHESSMART calibration starting points, not Chess.com settings.
 */
/**
 * Estimate positional complexity from legal move geometry, checks and captures.
 * This only scales the engine's node/time allowance; it never substitutes for
 * Stockfish's score or changes the requested depth ceiling.
 */
export const MIN_POSITION_COMPLEXITY_FACTOR = 0.7;
export const MAX_POSITION_COMPLEXITY_FACTOR = 1.5;

export function positionComplexityFactor(fen: string): number {
  try {
    const chess = new Chess(fen);
    const moves = chess.moves({ verbose: true });
    const legalCount = moves.length;
    const captures = moves.filter((move) => Boolean(move.captured)).length;
    const forcingMoves = moves.filter((move) => move.san.includes("+") || move.san.includes("#")).length;
    const promotions = moves.filter((move) => Boolean(move.promotion)).length;
    const pieces = chess.board().flat().filter(Boolean);
    const queens = pieces.filter((piece) => piece?.type === "q").length;

    let factor = 0.7;
    factor += Math.min(0.28, Math.max(0, legalCount - 8) * 0.012);
    factor += chess.isCheck() ? 0.24 : 0;
    factor += Math.min(0.28, captures * 0.04 + forcingMoves * 0.025);
    factor += queens > 0 ? 0.08 : 0;
    factor += pieces.length <= 10 ? 0.08 : 0;
    factor += promotions > 0 ? 0.15 : 0;
    return Math.max(
      MIN_POSITION_COMPLEXITY_FACTOR,
      Math.min(MAX_POSITION_COMPLEXITY_FACTOR, Number(factor.toFixed(3))),
    );
  } catch {
    // Malformed positions keep the neutral budget; validation happens elsewhere.
    return 1;
  }
}

export function scalePositionLimit(
  base: number | undefined,
  factor: number,
  maximum = 120_000,
): number | undefined {
  if (base === undefined || !Number.isFinite(base) || base <= 0) return undefined;
  const safeFactor = Number.isFinite(factor) ? factor : 1;
  return Math.max(1, Math.min(maximum, Math.round(base * safeFactor)));
}

export const REVIEW_TARGET_DEPTH = 28;
export const TIME_PER_MOVE_MS = 1000;
export const DEFAULT_ANALYSIS_TIME_MS = 1000;

export type AnalysisPresetId = "auto" | "fast" | "standard" | "deep";
export type AnalysisLimitMode = "nodes-first" | "hybrid" | "depth" | "time" | "nodes";

export interface AnalysisConfig {
  preset: AnalysisPresetId;
  limitMode: AnalysisLimitMode;
  depth: number;
  movetimeMs: number;
  nodes: number;
  hardTimeoutMs: number;
}

export interface AnalysisDeviceProfile {
  device?: "desktop" | "mobile";
  reviewWorkers?: number;
}

export interface ResolvedAnalysisBudget {
  preset: Exclude<AnalysisPresetId, "auto">;
  limitMode: AnalysisLimitMode;
  /** Maximum depth; nodes normally stop the search first. */
  targetDepth: number;
  depthLimit?: number;
  /** UCI movetime is used only by explicit time/hybrid modes. */
  movetimeMs?: number;
  nodes?: number;
  /** External stop deadline; never added to the UCI go command. */
  hardTimeoutMs: number;
  verifierDepth: number;
  verifierMovetimeMs?: number;
  verifierNodes?: number;
  verifierHardTimeoutMs: number;
}

export const ANALYSIS_PRESETS = [
  { id: "auto", title: "Оптимальный · Авто", desc: "Обычно 1 млн узлов; Fast для мобильных, блица и длинных партий", note: "Рекомендуемый режим", level: "AUTO", depth: 28, movetimeMs: 400, nodes: 1_000_000, hardTimeoutMs: 15_000 },
  { id: "fast", title: "Быстрый", desc: "350 тыс. узлов · глубина до 24 · таймаут 6 с", note: "Экспресс-обзор", level: "01", depth: 24, movetimeMs: 180, nodes: 350_000, hardTimeoutMs: 6_000 },
  { id: "standard", title: "Стандартный", desc: "1 млн узлов · глубина до 28 · таймаут 15 с", note: "Баланс скорости и точности", level: "02", depth: 28, movetimeMs: 400, nodes: 1_000_000, hardTimeoutMs: 15_000 },
  { id: "deep", title: "Глубокий", desc: "3 млн узлов · глубина до 30 · таймаут 45 с", note: "Для детальной проверки", level: "03", depth: 30, movetimeMs: 1_500, nodes: 3_000_000, hardTimeoutMs: 45_000 },
] as const;

export type AnalysisTimeModeId = "fast" | "optimal" | "deep";

/** Legacy export retained for older settings readers and tests. */
export const ANALYSIS_TIME_MODES = [
  { id: "fast", timeMs: 300, title: "Быстрый", desc: "Экспресс-обзор", note: "Быстрый обзор партии", level: "01" },
  { id: "optimal", timeMs: 1000, title: "Стандартный", desc: "Рекомендуемый баланс", note: "Рекомендуемый баланс", level: "02" },
  { id: "deep", timeMs: 3000, title: "Глубокий", desc: "Больше времени на сложные варианты", note: "Больше времени на сложные варианты", level: "03" },
] as const;

export const DEFAULT_ANALYSIS_CONFIG: AnalysisConfig = {
  preset: "auto",
  limitMode: "nodes-first",
  depth: 28,
  movetimeMs: 400,
  nodes: 1_000_000,
  hardTimeoutMs: 15_000,
};

function defaultsFor(preset: AnalysisPresetId): AnalysisConfig {
  const item = ANALYSIS_PRESETS.find((entry) => entry.id === preset) ?? ANALYSIS_PRESETS[0];
  return {
    preset,
    limitMode: "nodes-first",
    depth: item.depth,
    movetimeMs: item.movetimeMs,
    nodes: item.nodes,
    hardTimeoutMs: item.hardTimeoutMs,
  };
}

export function createAnalysisConfig(
  preset: AnalysisPresetId = "auto",
  limitMode: AnalysisLimitMode = "nodes-first",
): AnalysisConfig {
  return { ...defaultsFor(preset), limitMode };
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function normalizeAnalysisConfig(value: AnalysisConfig | number | null | undefined): AnalysisConfig {
  if (typeof value === "number") {
    const preset: AnalysisPresetId = value === 300 ? "fast" : value === 3000 ? "deep" : "standard";
    return defaultsFor(preset);
  }
  if (!value || typeof value !== "object") return { ...DEFAULT_ANALYSIS_CONFIG };
  const preset = (["auto", "fast", "standard", "deep"] as const).includes(value.preset)
    ? value.preset
    : DEFAULT_ANALYSIS_CONFIG.preset;
  const limitMode = (["nodes-first", "hybrid", "depth", "time", "nodes"] as const).includes(value.limitMode)
    ? value.limitMode
    : DEFAULT_ANALYSIS_CONFIG.limitMode;
  const presetDefaults = defaultsFor(preset);
  return {
    preset,
    limitMode,
    depth: clampInteger(value.depth, 12, 30, presetDefaults.depth),
    movetimeMs: clampInteger(value.movetimeMs, 50, 10_000, presetDefaults.movetimeMs),
    nodes: clampInteger(value.nodes, 50_000, 20_000_000, presetDefaults.nodes),
    hardTimeoutMs: clampInteger(value.hardTimeoutMs, 1_000, 120_000, presetDefaults.hardTimeoutMs),
  };
}

/** Legacy numeric-mode normalizer. */
export function normalizeAnalysisTimeMs(value: number): number {
  return [300, 1000, 3000].includes(value) ? value : DEFAULT_ANALYSIS_TIME_MS;
}

function isFastTimeControl(timeControl?: string): boolean {
  if (!timeControl) return false;
  const match = timeControl.trim().match(/^(\d+)(?:\+(\d+))?$/);
  if (!match) return false;
  const initialSeconds = Number(match[1]);
  const incrementSeconds = Number(match[2] ?? 0);
  if (!Number.isFinite(initialSeconds) || !Number.isFinite(incrementSeconds)) return false;
  // Approximate 40-move clock budget: bullet/blitz is at most 10 minutes.
  return initialSeconds + incrementSeconds * 40 <= 600;
}

export function resolveAnalysisBudget(
  rawConfig: AnalysisConfig | number,
  profile: AnalysisDeviceProfile = {},
  moveCount = 0,
  timeControl?: string,
): ResolvedAnalysisBudget {
  const config = normalizeAnalysisConfig(rawConfig);
  const autoFast = profile.device === "mobile" || moveCount >= 160 || isFastTimeControl(timeControl);
  const preset: Exclude<AnalysisPresetId, "auto"> = config.preset === "auto"
    ? (autoFast ? "fast" : "standard")
    : config.preset;
  const selected = ANALYSIS_PRESETS.find((item) => item.id === preset)!;
  const isAuto = config.preset === "auto";
  const depth = isAuto ? selected.depth : config.depth;
  const movetimeMs = isAuto ? selected.movetimeMs : config.movetimeMs;
  const nodes = isAuto ? selected.nodes : config.nodes;
  const hardTimeoutMs = isAuto ? selected.hardTimeoutMs : config.hardTimeoutMs;
  const usesDepth = config.limitMode === "nodes-first" || config.limitMode === "hybrid" || config.limitMode === "depth";
  const usesNodes = config.limitMode === "nodes-first" || config.limitMode === "hybrid" || config.limitMode === "nodes";
  const usesUciTime = config.limitMode === "hybrid" || config.limitMode === "time";

  return {
    preset,
    limitMode: config.limitMode,
    targetDepth: depth,
    depthLimit: usesDepth ? depth : undefined,
    movetimeMs: usesUciTime ? movetimeMs : undefined,
    nodes: usesNodes ? nodes : undefined,
    hardTimeoutMs,
    verifierDepth: Math.min(32, depth + 2),
    verifierMovetimeMs: usesUciTime ? Math.min(5_000, Math.max(350, movetimeMs * 2)) : undefined,
    verifierNodes: usesNodes ? Math.min(20_000_000, nodes * 2) : undefined,
    verifierHardTimeoutMs: Math.min(120_000, Math.round(hardTimeoutMs * 1.5)),
  };
}

/** Planning ceiling only; nodes are the normal stop condition, so real time is usually lower. */
export function estimateParallelBudgetMs(positionCount: number, perPositionTimeoutMs: number | undefined, workerCount: number): number {
  if (!perPositionTimeoutMs || perPositionTimeoutMs <= 0) return 0;
  return Math.ceil(Math.max(0, positionCount) * perPositionTimeoutMs / Math.max(1, Math.floor(workerCount || 1)));
}

/** Legacy serial estimate retained for older call sites. */
export function gameBudgetMs(moveCount: number, timePerPositionMs = TIME_PER_MOVE_MS): number {
  const plies = Math.max(0, Math.floor(moveCount));
  const positions = plies + 1;
  const perPosition = Math.max(1, Math.floor(Number.isFinite(timePerPositionMs) ? timePerPositionMs : TIME_PER_MOVE_MS));
  return positions * perPosition;
}

export function slotForPosition(budgetMs: number, elapsedMs: number, positionsLeft: number): number {
  const remaining = Math.max(0, Math.floor(budgetMs - elapsedMs));
  if (remaining <= 0) return 1;
  const fairShare = Math.round(remaining / Math.max(1, positionsLeft));
  return Math.max(1, Math.min(remaining, fairShare));
}
