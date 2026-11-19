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
  const detectedMobile = signals.mobile ?? (
    /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua) || touchMac
  );
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
      verifierMaxMoves: 2,
      verifierBudgetMs: 900,
      verifierMoveTimeMs: 180,
      tacticalExtraBudgetMs: 2400,
    };
  }

  const lowResourcePc = cores <= 4 || (memory !== undefined && memory <= 4);
  const highEndPc = cores >= 12 && (memory === undefined || memory >= 16);
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
    verifierMaxMoves: highEndPc ? 5 : 3,
    verifierBudgetMs: highEndPc ? 2600 : 1800,
    verifierMoveTimeMs: highEndPc ? 320 : 240,
    tacticalExtraBudgetMs: highEndPc ? 5000 : 3600,
  };
}
