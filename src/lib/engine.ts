/**
 * Обёртка над Stockfish 19 (WASM) в Web Worker с UCI-протоколом.
 * Воркер Stockfish.js читает URL .wasm из location.hash, поэтому мы запускаем
 * blob:-воркер из кэшированных файлов: new Worker(blobJs + "#" + encodeURIComponent(blobWasm)).
 */
import type { EngineLine, Score } from "../types";
import type { EngineBundle } from "./engineFiles";

export interface SearchHandle {
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

export interface SearchOptions {
  fen: string;
  depth: number;
  multipv: number;
  /** Жёсткий лимит времени поиска (мс). */
  movetimeMs?: number;
  onInfo?: (lines: EngineLine[]) => void;
  /** Если не задано, движок сбрасывается на максимальную силу. */
  strength?: EngineStrength;
}

const WATCHDOG_GRACE_MS = 1500;

export class StockfishEngine {
  readonly threaded: boolean;
  readonly threads: number;
  readonly variant: string;
  private worker: Worker;
  private listeners = new Set<(line: string) => void>();
  private tail: Promise<void> = Promise.resolve();
  private lastMultiPv = 0;
  private dead = false;

  private constructor(bundle: EngineBundle, threads: number) {
    this.threaded = bundle.set.threaded;
    this.threads = threads;
    this.variant = bundle.set.variant;
    this.worker = new Worker(bundle.jsUrl + "#" + encodeURIComponent(bundle.wasmUrl));
    this.worker.onmessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (typeof data !== "string") return;
      for (const listener of Array.from(this.listeners)) listener(data);
    };
    const crash = () => this.failAll();
    this.worker.addEventListener("error", crash);
    this.worker.addEventListener("messageerror", crash);
  }

  private failAll() {
    if (this.dead) return;
    this.dead = true;
    for (const listener of Array.from(this.listeners)) listener("bestmove (none)");
  }

  static async create(bundle: EngineBundle, hashMb = 128): Promise<StockfishEngine> {
    const hw = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
    const threads = bundle.set.threaded ? Math.max(1, Math.min(8, hw - 1)) : 1;
    const engine = new StockfishEngine(bundle, threads);
    await engine.init(hashMb);
    return engine;
  }

  private send(command: string) {
    if (!this.dead) this.worker.postMessage(command);
  }

  private waitFor(predicate: (line: string) => boolean, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(handler);
        this.worker.removeEventListener("error", errorHandler);
        reject(new Error("Таймаут ожидания движка"));
      }, timeoutMs);
      const errorHandler = (event: ErrorEvent) => {
        clearTimeout(timer);
        this.listeners.delete(handler);
        this.worker.removeEventListener("error", errorHandler);
        reject(new Error(event.message || "Ошибка воркера движка"));
      };
      const handler = (line: string) => {
        if (predicate(line)) {
          clearTimeout(timer);
          this.listeners.delete(handler);
          this.worker.removeEventListener("error", errorHandler);
          resolve(line);
        }
      };
      this.worker.addEventListener("error", errorHandler);
      this.listeners.add(handler);
    });
  }

  private async init(hashMb: number) {
    const uciok = this.waitFor((line) => line === "uciok", 180000);
    this.send("uci");
    await uciok;
    this.send(`setoption name Threads value ${this.threads}`);
    this.send(`setoption name Hash value ${this.threaded ? hashMb : Math.min(hashMb, 64)}`);
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
        new Promise<EngineLine[]>((resolve) => {
          if (cancelled || this.dead) return resolve([]);
          active = true;
          const lines = new Map<number, EngineLine>();
          const sorted = () => Array.from(lines.values()).sort((a, b) => a.multipv - b.multipv);
          const handler = (line: string) => {
            if (line.startsWith("info ")) {
              const parsed = parseInfo(line, turn);
              if (parsed) {
                lines.set(parsed.multipv, parsed);
                options.onInfo?.(sorted());
              } else {
                const bound = parseInfo(line, turn, true);
                if (bound && !lines.has(bound.multipv)) lines.set(bound.multipv, bound);
              }
            } else if (line.startsWith("bestmove")) {
              this.listeners.delete(handler);
              active = false;
              if (watchdog) clearTimeout(watchdog);
              resolve(sorted());
            }
          };
          this.listeners.add(handler);
          this.applyStrength(options.strength);
          if (this.lastMultiPv !== options.multipv) {
            this.send(`setoption name MultiPV value ${options.multipv}`);
            this.lastMultiPv = options.multipv;
          }
          this.send(`position fen ${options.fen}`);
          const limit = options.movetimeMs && options.movetimeMs > 0 ? Math.round(options.movetimeMs) : 0;
          this.send(limit ? `go depth ${options.depth} movetime ${limit}` : `go depth ${options.depth}`);
          if (limit) {
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
    this.failAll();
    this.dead = true;
    try {
      this.worker.postMessage("quit");
    } catch {
      // ignore
    }
    this.worker.terminate();
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
