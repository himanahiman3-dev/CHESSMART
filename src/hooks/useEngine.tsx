import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StockfishEngine } from "../lib/engine";
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
}

const Ctx = createContext<EngineCtx | null>(null);

const LS_KEY = "chess-review:engine-variant";

export function EngineProvider({ children }: { children: ReactNode }) {
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
    return "full";
  });
  const startedRef = useRef(false);
  const isolated = canUseThreads();

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
      const attempt = async (threaded: boolean) => {
        const set = getFileSet(chosen, threaded);
        const bundle = await prepareEngineFiles(set, (p) => setProgress(p));
        const eng = await StockfishEngine.create(bundle, chosen === "full" ? 128 : 64);
        setEngine(eng);
        setInfo({ variant: chosen, threaded, threads: eng.threads, fromCache: bundle.fromCache });
        setStatus("ready");
      };
      try {
        try {
          await attempt(isolated);
        } catch (e) {
          if (!isolated) throw e;
          console.warn("Многопоточный движок не запустился, пробуем однопоточный", e);
          await attempt(false); // автоматический fallback
        }
      } catch (e) {
        startedRef.current = false;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    },
    [variant, isolated, setVariant]
  );

  // Проверяем кэш; если движок уже скачан — поднимаем мгновенно.
  useEffect(() => {
    let alive = true;
    (async () => {
      const full = await isEngineCached(getFileSet("full", isolated));
      const lite = await isEngineCached(getFileSet("lite", isolated));
      if (!alive) return;
      setCachedVariants({ full, lite });
      const preferred = full && variant === "full" ? "full" : lite && variant === "lite" ? "lite" : full ? "full" : lite ? "lite" : null;
      if (preferred) void start(preferred);
      else setStatus("idle");
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<EngineCtx>(
    () => ({ engine, status, progress, info, error, variant, setVariant, start, isolated, cachedVariants }),
    [engine, status, progress, info, error, variant, setVariant, start, isolated, cachedVariants]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEngine(): EngineCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("EngineProvider отсутствует");
  return c;
}
