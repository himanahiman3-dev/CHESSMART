/**
 * Device-aware limits for local Stockfish Game Review.
 * These are CHESSMART presets, not claims about Chess.com's private settings.
 */
export const REVIEW_TARGET_DEPTH = 22;
export const TIME_PER_MOVE_MS = 1000;
export const DEFAULT_ANALYSIS_TIME_MS = 1000;

export type AnalysisPresetId = "auto" | "fast" | "standard" | "deep";
export type AnalysisLimitMode = "hybrid" | "depth" | "time" | "nodes";

export interface AnalysisConfig {
  preset: AnalysisPresetId;
  limitMode: AnalysisLimitMode;
  depth: number;
  movetimeMs: number;
  nodes: number;
}

export interface AnalysisDeviceProfile {
  device?: "desktop" | "mobile";
  reviewWorkers?: number;
}

export interface ResolvedAnalysisBudget {
  preset: Exclude<AnalysisPresetId, "auto">;
  limitMode: AnalysisLimitMode;
  /** Quality target; a timed/nodes search may stop before this depth. */
  targetDepth: number;
  depthLimit?: number;
  movetimeMs?: number;
  nodes?: number;
  verifierDepth: number;
  verifierMovetimeMs?: number;
  verifierNodes?: number;
}

export const ANALYSIS_PRESETS = [
  { id: "auto", title: "Оптимальный · Авто", desc: "CHESSMART подберёт лимиты под устройство и длину партии", note: "Рекомендуемый режим", level: "AUTO", depth: 22, movetimeMs: 400, nodes: 1_000_000 },
  { id: "fast", title: "Быстрый", desc: "250 тыс. узлов или 180 мс на позицию", note: "Экспресс-обзор", level: "01", depth: 18, movetimeMs: 180, nodes: 250_000 },
  { id: "standard", title: "Стандартный", desc: "1 млн узлов или 400 мс на позицию", note: "Баланс скорости и точности", level: "02", depth: 22, movetimeMs: 400, nodes: 1_000_000 },
  { id: "deep", title: "Глубокий", desc: "5 млн узлов или 1,5 секунды на позицию", note: "Для детальной проверки", level: "03", depth: 26, movetimeMs: 1_500, nodes: 5_000_000 },
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
  limitMode: "hybrid",
  depth: 22,
  movetimeMs: 400,
  nodes: 1_000_000,
};

function defaultsFor(preset: AnalysisPresetId): AnalysisConfig {
  const item = ANALYSIS_PRESETS.find((entry) => entry.id === preset) ?? ANALYSIS_PRESETS[0];
  return {
    preset,
    limitMode: "hybrid",
    depth: item.depth,
    movetimeMs: item.movetimeMs,
    nodes: item.nodes,
  };
}

export function createAnalysisConfig(
  preset: AnalysisPresetId = "auto",
  limitMode: AnalysisLimitMode = "hybrid",
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
  const limitMode = (["hybrid", "depth", "time", "nodes"] as const).includes(value.limitMode)
    ? value.limitMode
    : DEFAULT_ANALYSIS_CONFIG.limitMode;
  return {
    preset,
    limitMode,
    depth: clampInteger(value.depth, 12, 30, DEFAULT_ANALYSIS_CONFIG.depth),
    movetimeMs: clampInteger(value.movetimeMs, 50, 10_000, DEFAULT_ANALYSIS_CONFIG.movetimeMs),
    nodes: clampInteger(value.nodes, 50_000, 20_000_000, DEFAULT_ANALYSIS_CONFIG.nodes),
  };
}

/** Legacy numeric-mode normalizer. */
export function normalizeAnalysisTimeMs(value: number): number {
  return [300, 1000, 3000].includes(value) ? value : DEFAULT_ANALYSIS_TIME_MS;
}

export function resolveAnalysisBudget(
  rawConfig: AnalysisConfig | number,
  profile: AnalysisDeviceProfile = {},
  moveCount = 0,
): ResolvedAnalysisBudget {
  const config = normalizeAnalysisConfig(rawConfig);
  const preset: Exclude<AnalysisPresetId, "auto"> = config.preset === "auto"
    ? (profile.device === "mobile" || moveCount >= 160 ? "fast" : "standard")
    : config.preset;
  const selected = ANALYSIS_PRESETS.find((item) => item.id === preset)!;
  const isAuto = config.preset === "auto";
  const depth = isAuto ? selected.depth : config.depth;
  const movetimeMs = isAuto ? selected.movetimeMs : config.movetimeMs;
  const nodes = isAuto ? selected.nodes : config.nodes;

  return {
    preset,
    limitMode: config.limitMode,
    targetDepth: depth,
    depthLimit: config.limitMode === "hybrid" || config.limitMode === "depth" ? depth : undefined,
    movetimeMs: config.limitMode === "hybrid" || config.limitMode === "time" ? movetimeMs : undefined,
    nodes: config.limitMode === "hybrid" || config.limitMode === "nodes" ? nodes : undefined,
    verifierDepth: Math.min(32, depth + 4),
    verifierMovetimeMs: config.limitMode === "hybrid" || config.limitMode === "time"
      ? Math.min(5_000, Math.max(350, movetimeMs * 2))
      : undefined,
    verifierNodes: config.limitMode === "hybrid" || config.limitMode === "nodes"
      ? Math.min(20_000_000, nodes * 2)
      : undefined,
  };
}

/** Planning estimate only; actual time depends on CPU, cache and position complexity. */
export function estimateParallelBudgetMs(positionCount: number, movetimeMs: number | undefined, workerCount: number): number {
  if (!movetimeMs || movetimeMs <= 0) return 0;
  return Math.ceil(Math.max(0, positionCount) * movetimeMs / Math.max(1, Math.floor(workerCount || 1)));
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
