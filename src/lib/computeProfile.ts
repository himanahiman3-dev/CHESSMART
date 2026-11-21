export type DeviceClass = "desktop" | "mobile";
export type EngineVariantPreference = "full" | "lite";

export interface DeviceSignals {
  userAgent?: string;
  mobile?: boolean;
  maxTouchPoints?: number;
  hardwareConcurrency?: number;
  deviceMemory?: number;
}

export interface DeviceAnalysisProfile {
  device: DeviceClass;
  defaultVariant: EngineVariantPreference;
  maxThreads: number;
  /** Number of independent single-threaded WASM workers used for full-game review. */
  reviewWorkers: number;
  reviewHashMb: number;
  hashMb: number;
  timePerMoveMs: number;
  /** Per-ply ceiling used only when the user selects a high target depth. */
  maxTimePerMoveMs: number;
  depthBonus: number;
  mainMultiPv: number;
  verifierEnabled: boolean;
  verifierMaxMoves: number;
  verifierBudgetMs: number;
  verifierMoveTimeMs: number;
  tacticalExtraBudgetMs: number;
}

export function getDeviceAnalysisProfile(signals: DeviceSignals): DeviceAnalysisProfile {
  const ua = signals.userAgent ?? "";
  const touchMac = /Macintosh/i.test(ua) && (signals.maxTouchPoints ?? 0) > 1;
  const detectedMobile = signals.mobile === true
    || /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua)
    || touchMac;
  const cores = Math.max(1, Math.floor(signals.hardwareConcurrency || 2));
  const memory = Number.isFinite(signals.deviceMemory) ? signals.deviceMemory! : undefined;

  if (detectedMobile) {
    const verifierEnabled = cores >= 6 && (memory === undefined || memory >= 6);
    return {
      device: "mobile",
      defaultVariant: "lite",
      maxThreads: 1,
      reviewWorkers: 1,
      reviewHashMb: 32,
      hashMb: 64,
      timePerMoveMs: 400,
      maxTimePerMoveMs: 1100,
      depthBonus: 0,
      mainMultiPv: 1,
      verifierEnabled,
      verifierMaxMoves: 1,
      verifierBudgetMs: 900,
      verifierMoveTimeMs: 800,
      tacticalExtraBudgetMs: 2600,
    };
  }

  const lowResourcePc = cores <= 4 || (memory !== undefined && memory <= 4);
  // Chromium reports deviceMemory in coarse buckets capped at 8 GB, so 8 is the top observable value.
  const highEndPc = cores >= 12 && (memory === undefined || memory >= 8);
  // Leave CPU headroom for the browser compositor, React and the operating system.
  // Stockfish remains multi-threaded, but must not occupy every logical core on large PCs.
  const renderReserve = cores <= 2 ? 1 : Math.max(2, Math.ceil(cores * 0.25));
  const maxThreads = Math.min(10, Math.max(1, cores - renderReserve));
  // Keep whole-game review on the already initialized engine until concurrent
  // WASM workers have passed real-browser stress tests. This avoids a regression
  // where multiple Stockfish instances can stall the first search on some devices.
  const reviewWorkers = 1;
  const verifierEnabled = cores >= 6 && (memory === undefined || memory >= 8);

  return {
    device: "desktop",
    defaultVariant: "full",
    maxThreads,
    reviewWorkers,
    reviewHashMb: 64,
    hashMb: highEndPc ? 512 : memory !== undefined && memory <= 8 ? 128 : 256,
    timePerMoveMs: highEndPc ? 1400 : lowResourcePc ? 650 : 1000,
    maxTimePerMoveMs: lowResourcePc ? 2600 : 4750,
    depthBonus: highEndPc ? 5 : lowResourcePc ? 2 : 3,
    mainMultiPv: 1,
    verifierEnabled,
    verifierMaxMoves: highEndPc ? 6 : 4,
    verifierBudgetMs: highEndPc ? 5000 : 3600,
    verifierMoveTimeMs: highEndPc ? 2400 : 1800,
    tacticalExtraBudgetMs: highEndPc ? 6500 : 5000,
  };
}
