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
  hashMb: number;
  timePerMoveMs: number;
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
      hashMb: 64,
      timePerMoveMs: 400,
      depthBonus: 0,
      mainMultiPv: 2,
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
  const maxThreads = Math.min(16, Math.max(1, cores - 1));
  const verifierEnabled = cores >= 6 && (memory === undefined || memory >= 8);

  return {
    device: "desktop",
    defaultVariant: "full",
    maxThreads,
    hashMb: highEndPc ? 512 : memory !== undefined && memory <= 8 ? 128 : 256,
    timePerMoveMs: highEndPc ? 1400 : lowResourcePc ? 650 : 1000,
    depthBonus: highEndPc ? 5 : lowResourcePc ? 2 : 3,
    mainMultiPv: highEndPc ? 4 : lowResourcePc ? 2 : 3,
    verifierEnabled,
    verifierMaxMoves: 2,
    verifierBudgetMs: highEndPc ? 5000 : 3600,
    verifierMoveTimeMs: highEndPc ? 2400 : 1800,
    tacticalExtraBudgetMs: highEndPc ? 6500 : 5000,
  };
}
