import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StockfishEngine } from "../lib/engine";
import { verifyReviewWorkerPool } from "../lib/reviewPoolHealth";
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
  /** Creates/reuses independent single-thread Stockfish workers for whole-game review. */
  createReviewPool: (signal?: AbortSignal) => Promise<StockfishEngine[]>;
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
  const reviewPoolRef = useRef<{ variant: EngineVariant; engines: StockfishEngine[] } | null>(null);
  const reviewPoolPromiseRef = useRef<Promise<StockfishEngine[]> | null>(null);
  const isolated = canUseThreads();

  // The engine owns its Worker and Blob URLs; release both when the provider unmounts
  // or replaces the engine instance.
  useEffect(() => () => {
    engine?.terminate();
  }, [engine]);

  useEffect(() => () => {
    reviewPoolRef.current?.engines.forEach((worker) => worker.terminate());
    reviewPoolRef.current = null;
  }, []);

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

  const createReviewPool = useCallback(async (signal?: AbortSignal): Promise<StockfishEngine[]> => {
    if (!engine) throw new Error("Stockfish ещё не готов к анализу.");
    const selectedVariant = info?.variant ?? variant;
    const desiredWorkers = Math.max(1, Math.min(4, computeProfile.reviewWorkers || 1));

    // Phones and low-resource desktops keep the primary engine only.
    if (desiredWorkers <= 1) return [engine];
    if (reviewPoolRef.current?.variant === selectedVariant
      && reviewPoolRef.current.engines.length >= 2
      && reviewPoolRef.current.engines.length <= desiredWorkers) {
      return reviewPoolRef.current.engines;
    }
    if (reviewPoolPromiseRef.current) return reviewPoolPromiseRef.current;

    const creation = (async () => {
      const created: StockfishEngine[] = [];
      try {
        // Single-threaded builds avoid SharedArrayBuffer and do not require COOP/COEP.
        const singleThreadSet = getFileSet(selectedVariant, false);
        for (let index = 0; index < desiredWorkers; index++) {
          if (signal?.aborted) throw new Error("cancelled");
          const bundle = await prepareEngineFiles(singleThreadSet, () => undefined, signal);
          if (signal?.aborted) {
            URL.revokeObjectURL(bundle.jsUrl);
            URL.revokeObjectURL(bundle.wasmUrl);
            throw new Error("cancelled");
          }
          const worker = await StockfishEngine.create(bundle, computeProfile.reviewHashMb, 1);
          if (signal?.aborted) {
            worker.terminate();
            throw new Error("cancelled");
          }
          created.push(worker);
        }
        // UCI readiness alone does not prove that separate WASM instances can
        // search together. Run two concurrent smoke rounds and keep only workers
        // that return a completed PV in both rounds.
        const healthy = await verifyReviewWorkerPool(created, signal);
        if (signal?.aborted) throw new Error("cancelled");
        if (healthy.length < 2) {
          created.forEach((worker) => worker.terminate());
          console.warn("Параллельный Stockfish не прошёл проверку; используем основной движок.");
          return [engine];
        }

        const healthySet = new Set(healthy);
        created.forEach((worker) => {
          if (!healthySet.has(worker)) worker.terminate();
        });
        reviewPoolRef.current?.engines.forEach((worker) => worker.terminate());
        reviewPoolRef.current = { variant: selectedVariant, engines: healthy };
        console.info(`Stockfish review pool verified: ${healthy.length}/${desiredWorkers} workers`);
        return healthy;
      } catch (reason) {
        created.forEach((worker) => worker.terminate());
        if (signal?.aborted) throw reason;
        console.warn("Не удалось создать пул анализа; используем основной Stockfish", reason);
        return [engine];
      }
    })();

    reviewPoolPromiseRef.current = creation;
    try {
      return await creation;
    } finally {
      reviewPoolPromiseRef.current = null;
    }
  }, [engine, info?.variant, variant, computeProfile]);

  const setVariant = useCallback((v: EngineVariant) => {
    if (reviewPoolRef.current && reviewPoolRef.current.variant !== v) {
      reviewPoolRef.current.engines.forEach((worker) => worker.terminate());
      reviewPoolRef.current = null;
    }
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
    () => ({ engine, status, progress, info, error, variant, setVariant, start, isolated, cachedVariants, createVerifier, createReviewPool, computeProfile }),
    [engine, status, progress, info, error, variant, setVariant, start, isolated, cachedVariants, createVerifier, createReviewPool, computeProfile]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEngine(): EngineCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("EngineProvider отсутствует");
  return c;
}
