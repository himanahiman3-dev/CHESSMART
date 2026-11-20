/**
 * Обёртка над Stockfish 19 (WASM) в Web Worker с UCI-протоколом.
 * Воркер Stockfish.js читает URL .wasm из location.hash, поэтому мы запускаем
 * blob:-воркер из кэшированных файлов: new Worker(blobJs + "#" + encodeURIComponent(blobWasm)).
 */
import type { EngineLine, Score } from "../types";
import type { EngineBundle } from "./engineFiles";

export interface SearchHandle {
  /** Rejects when the worker crashes; partial info lines are never treated as a final result. */
  promise: Promise<EngineLine[]>;
  stop: () => void;
}

export interface EngineStrength {
  /** Stockfish Skill Level: 0 (самый слабый) … 20 (максимальный). */
  skillLevel: number;
  /** Использовать ограничение силы UCI_Elo. */
  limitStrength?: boolean;
  /** UCI_Elo поддерживает 1320…3190. */
  elo?: number;
}

export interface PositionHistory {
  startFen: string;
  moves: readonly string[];
}

export interface SearchOptions {
  fen: string;
  /** Original game path to preserve repetition and draw context. */
  history?: PositionHistory;
  depth: number;
  multipv: number;
  /** UCI wall-clock search budget for this position (ms). */
  movetimeMs?: number;
  onInfo?: (lines: EngineLine[]) => void;
  /** Если не задано, движок сбрасывается на максимальную силу. */
  strength?: EngineStrength;
}

export function buildPositionCommand(fen: string, history?: PositionHistory): string {
  if (!history) return `position fen ${fen}`;
  const moves = history.moves.length ? ` moves ${history.moves.join(" ")}` : "";
  return `position fen ${history.startFen}${moves}`;
}

const WATCHDOG_GRACE_MS = 250;
const ENGINE_ERROR_PREFIX = "\u0000stockfish-error:";

function releaseBundleUrls(bundle: EngineBundle): void {
  for (const url of [bundle.jsUrl, bundle.wasmUrl]) {
    if (!url.startsWith("blob:")) continue;
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Revoking an already-released object URL is harmless.
    }
  }
}

export class StockfishEngine {
  readonly threaded: boolean;
  readonly threads: number;
  readonly variant: string;
  private worker: Worker;
  private listeners = new Set<(line: string) => void>();
  private tail: Promise<void> = Promise.resolve();
  private lastMultiPv = 0;
  private dead = false;
  private resourcesReleased = false;
  private bundle: EngineBundle;

  private constructor(bundle: EngineBundle, threads: number) {
    this.bundle = bundle;
    this.threaded = bundle.set.threaded;
    this.threads = threads;
    this.variant = bundle.set.variant;
    this.worker = new Worker(bundle.jsUrl + "#" + encodeURIComponent(bundle.wasmUrl));
    this.worker.onmessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (typeof data !== "string") return;
      for (const listener of Array.from(this.listeners)) listener(data);
    };
    const crash = (event: Event) => {
      const detail = "message" in event && typeof (event as ErrorEvent).message === "string"
        ? (event as ErrorEvent).message
        : "Неизвестная ошибка Worker Stockfish";
      this.failAll(new Error(detail));
    };
    this.worker.addEventListener("error", crash);
    this.worker.addEventListener("messageerror", crash);
  }

  private releaseResources() {
    if (this.resourcesReleased) return;
    this.resourcesReleased = true;
    try {
      this.worker.terminate();
    } catch {
      // The worker may already have crashed or been terminated.
    }
    releaseBundleUrls(this.bundle);
  }

  private failAll(reason: unknown) {
    if (this.dead) return;
    this.dead = true;
    const detail = reason instanceof Error ? reason.message : String(reason);
    const failure = ENGINE_ERROR_PREFIX + detail;
    for (const listener of Array.from(this.listeners)) listener(failure);
    this.releaseResources();
  }

  static async create(bundle: EngineBundle, hashMb = 128, maxThreads = 8): Promise<StockfishEngine> {
    const hw = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
    const threadCap = Math.max(1, Math.min(16, Math.floor(maxThreads) || 1));
    const threads = bundle.set.threaded ? Math.max(1, Math.min(threadCap, hw - 1)) : 1;
    let engine: StockfishEngine | null = null;
    try {
      engine = new StockfishEngine(bundle, threads);
      await engine.init(hashMb);
      return engine;
    } catch (error) {
      if (engine) engine.terminate();
      else releaseBundleUrls(bundle);
      throw error;
    }
  }

  private send(command: string) {
    if (this.dead) return;
    try {
      this.worker.postMessage(command);
    } catch (error) {
      this.failAll(error);
    }
  }

  private waitFor(predicate: (line: string) => boolean, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.dead) {
        reject(new Error("Движок Stockfish завершён или недоступен"));
        return;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        this.listeners.delete(handler);
        this.worker.removeEventListener("error", errorHandler);
      };
      const errorHandler = (event: ErrorEvent) => {
        cleanup();
        reject(new Error(event.message || "Ошибка воркера движка"));
      };
      const handler = (line: string) => {
        if (line.startsWith(ENGINE_ERROR_PREFIX)) {
          cleanup();
          reject(new Error(line.slice(ENGINE_ERROR_PREFIX.length) || "Ошибка воркера Stockfish"));
          return;
        }
        if (predicate(line)) {
          cleanup();
          resolve(line);
        }
      };
      timer = setTimeout(() => {
        cleanup();
        reject(new Error("Таймаут ожидания движка"));
      }, timeoutMs);
      this.worker.addEventListener("error", errorHandler);
      this.listeners.add(handler);
    });
  }

  private async init(hashMb: number) {
    const uciok = this.waitFor((line) => line === "uciok", 180000);
    this.send("uci");
    await uciok;
    this.send(`setoption name Threads value ${this.threads}`);
    const safeHashMb = this.threaded ? hashMb : Math.min(hashMb, this.variant === "full" ? 512 : 64);
    this.send(`setoption name Hash value ${safeHashMb}`);
    const ready = this.waitFor((line) => line === "readyok", 120000);
    this.send("isready");
    await ready;
  }

  newGame() {
    this.tail = this.tail.then(() => this.send("ucinewgame"));
  }

  private applyStrength(strength?: EngineStrength) {
    const skillLevel = Math.max(0, Math.min(20, Math.round(strength?.skillLevel ?? 20)));
    const limited = !!strength?.limitStrength && Number.isFinite(strength.elo);
    this.send(`setoption name Skill Level value ${skillLevel}`);
    this.send(`setoption name UCI_LimitStrength value ${limited ? "true" : "false"}`);
    if (limited) {
      const elo = Math.max(1320, Math.min(3190, Math.round(strength!.elo!)));
      this.send(`setoption name UCI_Elo value ${elo}`);
    }
  }

  search(options: SearchOptions): SearchHandle {
    let cancelled = false;
    let active = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const turn = options.fen.split(" ")[1] === "b" ? "b" : "w";
    const promise = this.tail.then(
      () =>
        new Promise<EngineLine[]>((resolve, reject) => {
          if (cancelled) return resolve([]);
          if (this.dead) return reject(new Error("Движок Stockfish завершён или недоступен"));
          active = true;
          const lines = new Map<number, EngineLine>();
          const sorted = () => Array.from(lines.values()).sort((a, b) => a.multipv - b.multipv);
          const cleanup = () => {
            this.listeners.delete(handler);
            active = false;
            if (watchdog) clearTimeout(watchdog);
          };
          const handler = (line: string) => {
            if (line.startsWith(ENGINE_ERROR_PREFIX)) {
              cleanup();
              reject(new Error(line.slice(ENGINE_ERROR_PREFIX.length) || "Ошибка воркера Stockfish"));
              return;
            }
            if (line.startsWith("info ")) {
              const parsed = parseInfo(line, turn);
              if (parsed) {
                lines.set(parsed.multipv, parsed);
                const currentLines = sorted();
                options.onInfo?.(currentLines);

                // Preserve the latest completed info line for every MultiPV index.
                // If UCI movetime expires mid-iteration, the last completed line remains usable.
              } else {
                const bound = parseInfo(line, turn, true);
                if (bound && !lines.has(bound.multipv)) lines.set(bound.multipv, bound);
              }
            } else if (line.startsWith("bestmove")) {
              cleanup();
              resolve(sorted());
            }
          };
          this.listeners.add(handler);
          this.applyStrength(options.strength);
          if (this.lastMultiPv !== options.multipv) {
            this.send(`setoption name MultiPV value ${options.multipv}`);
            this.lastMultiPv = options.multipv;
          }
          this.send(buildPositionCommand(options.fen, options.history));
          const limit = options.movetimeMs && options.movetimeMs > 0
            ? Math.max(1, Math.round(options.movetimeMs))
            : 0;
          const requestedDepth = Math.max(1, Math.floor(options.depth));
          // UCI stops when either depth or movetime is reached, whichever comes first.
          this.send(limit
            ? `go depth ${requestedDepth} movetime ${limit}`
            : `go depth ${requestedDepth}`);
          if (this.dead) return;
          if (limit) {
            // UCI movetime normally sends bestmove itself. This is a safety watchdog
            // in case a worker stalls; all info lines already received remain cached.
            watchdog = setTimeout(() => {
              if (active) this.send("stop");
            }, limit + WATCHDOG_GRACE_MS);
          }
        })
    );
    this.tail = promise.then(() => undefined, () => undefined);
    return {
      promise,
      stop: () => {
        cancelled = true;
        if (active) this.send("stop");
      },
    };
  }

  terminate() {
    if (!this.dead) this.failAll(new Error("Движок Stockfish остановлен"));
    else this.releaseResources();
  }
}

function parseInfo(line: string, turn: "w" | "b", allowBound = false): EngineLine | null {
  if (!line.includes(" score ") || !line.includes(" pv ")) return null;
  const isBound = line.includes(" lowerbound") || line.includes(" upperbound");
  if (isBound !== allowBound) return null;
  const tokens = line.split(/\s+/);
  let depth = 0;
  let multipv = 1;
  let score: Score | null = null;
  let pv: string[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "depth") depth = parseInt(tokens[++i], 10);
    else if (token === "multipv") multipv = parseInt(tokens[++i], 10);
    else if (token === "score") {
      const kind = tokens[++i];
      const value = parseInt(tokens[++i], 10);
      const sign = turn === "w" ? 1 : -1;
      if (kind === "cp") score = { cp: value * sign };
      else if (kind === "mate") score = { mate: value * sign };
    } else if (token === "pv") {
      pv = tokens.slice(i + 1);
      break;
    }
  }
  if (!score || !pv.length) return null;
  return { multipv, depth, score, pv };
}
