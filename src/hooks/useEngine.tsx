import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StockfishEngine } from "../lib/engine";
import { getDeviceAnalysisProfile, type DeviceAnalysisProfile } from "../lib/computeProfile";
import {
  canUseThreads,
  getFileSet,
  isEngineCached,
  prepareEngineFiles,
  type EngineProgress,
  type EngineVariant,
} from "../lib/engineFiles";

export type EngineStatus = "idle" | "checking" | "loading" | "ready" | "error";

export interface EngineInfo {
  variant: EngineVariant;
  threaded: boolean;
  threads: number;
  fromCache: boolean;
  device: DeviceAnalysisProfile["device"];
  hashMb: number;
}

interface EngineCtx {
  engine: StockfishEngine | null;
  status: EngineStatus;
  progress: EngineProgress | null;
  info: EngineInfo | null;
  error: string | null;
  variant: EngineVariant;
  setVariant: (v: EngineVariant) => void;
  start: (v?: EngineVariant) => Promise<void>;
  isolated: boolean;
  cachedVariants: Record<EngineVariant, boolean>;
  createVerifier: (signal?: AbortSignal) => Promise<StockfishEngine | null>;
  computeProfile: DeviceAnalysisProfile;
}

const Ctx = createContext<EngineCtx | null>(null);

const LS_KEY = "chess-review:engine-variant:v2";

export function EngineProvider({ children }: { children: ReactNode }) {
  const computeProfile = useMemo(() => {
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    const extended = nav as (Navigator & {
      deviceMemory?: number;
      userAgentData?: { mobile?: boolean };
    }) | undefined;
    return getDeviceAnalysisProfile({
      userAgent: nav?.userAgent,
      mobile: extended?.userAgentData?.mobile,
      maxTouchPoints: nav?.maxTouchPoints,
      hardwareConcurrency: nav?.hardwareConcurrency,
      deviceMemory: extended?.deviceMemory,
    });
  }, []);
  const [engine, setEngine] = useState<StockfishEngine | null>(null);
  const [status, setStatus] = useState<EngineStatus>("checking");
  const [progress, setProgress] = useState<EngineProgress | null>(null);
  const [info, setInfo] = useState<EngineInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cachedVariants, setCachedVariants] = useState<Record<EngineVariant, boolean>>({ full: false, lite: false });
  const [variant, setVariantState] = useState<EngineVariant>(() => {
    try {
      const v = localStorage.getItem(LS_KEY);
      if (v === "full" || v === "lite") return v;
    } catch {
      /* ignore */
    }
    return computeProfile.defaultVariant;
  });
  const startedRef = useRef(false);
  const isolated = canUseThreads();

  // The engine owns its Worker and Blob URLs; release both when the provider unmounts
  // or replaces the engine instance.
  useEffect(() => () => {
    engine?.terminate();
  }, [engine]);

  const createVerifier = useCallback(async (signal?: AbortSignal): Promise<StockfishEngine | null> => {
    const selectedVariant = info?.variant ?? variant;
    // Secondary verification is enabled only on devices with enough spare compute and memory.
    if (!computeProfile.verifierEnabled) return null;

    const verifierThreaded = isolated && computeProfile.device === "desktop" && computeProfile.maxThreads > 1;
    const bundle = await prepareEngineFiles(getFileSet(selectedVariant, verifierThreaded), () => undefined, signal);
    if (signal?.aborted) {
      URL.revokeObjectURL(bundle.jsUrl);
      URL.revokeObjectURL(bundle.wasmUrl);
      throw new Error("cancelled");
    }
    const verifier = await StockfishEngine.create(bundle, Math.min(128, computeProfile.hashMb), 1);
    if (signal?.aborted) {
      verifier.terminate();
      throw new Error("cancelled");
    }
    return verifier;
  }, [info?.variant, variant, computeProfile, isolated]);

  const setVariant = useCallback((v: EngineVariant) => {
    setVariantState(v);
    try {
      localStorage.setItem(LS_KEY, v);
    } catch {
      /* ignore */
    }
  }, []);

  const start = useCallback(
    async (v?: EngineVariant) => {
      if (startedRef.current) return;
      startedRef.current = true;
      const chosen = v ?? variant;
      setVariant(chosen);
      setError(null);
      setStatus("loading");
      const threadedAllowed = isolated && computeProfile.device === "desktop" && computeProfile.maxThreads > 1;
      const attempt = async (threaded: boolean) => {
        const set = getFileSet(chosen, threaded);
        const bundle = await prepareEngineFiles(set, (p) => setProgress(p));
        const configuredHashMb = threaded
          ? computeProfile.hashMb
          : Math.min(computeProfile.hashMb, chosen === "full" ? 512 : 64);
        const eng = await StockfishEngine.create(bundle, configuredHashMb, computeProfile.maxThreads);
        setEngine(eng);
        setInfo({
          variant: chosen,
          threaded,
          threads: eng.threads,
          fromCache: bundle.fromCache,
          device: computeProfile.device,
          hashMb: configuredHashMb,
        });
        setStatus("ready");
      };
      try {
        try {
          await attempt(threadedAllowed);
        } catch (e) {
          if (!threadedAllowed) throw e;
          console.warn("Многопоточный движок не запустился, пробуем однопоточный", e);
          await attempt(false); // automatic fallback, keep desktop hash budget
        }
      } catch (e) {
        startedRef.current = false;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    },
    [variant, isolated, setVariant, computeProfile]
  );

  // Проверяем кэш; если движок уже скачан — поднимаем мгновенно.
  useEffect(() => {
    let alive = true;
    (async () => {
      const threadedCache = isolated && computeProfile.device === "desktop" && computeProfile.maxThreads > 1;
      const full = await isEngineCached(getFileSet("full", threadedCache));
      const lite = await isEngineCached(getFileSet("lite", threadedCache));
      if (!alive) return;
      setCachedVariants({ full, lite });
      const preferred = variant === "full" ? (full ? "full" : null) : (lite ? "lite" : null);
      if (preferred) void start(preferred);
      else setStatus("idle");
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<EngineCtx>(
    () => ({ engine, status, progress, info, error, variant, setVariant, start, isolated, cachedVariants, createVerifier, computeProfile }),
    [engine, status, progress, info, error, variant, setVariant, start, isolated, cachedVariants, createVerifier, computeProfile]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEngine(): EngineCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("EngineProvider отсутствует");
  return c;
}
