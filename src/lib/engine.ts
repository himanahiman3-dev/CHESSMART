/**
 * Обёртка над Stockfish 19 (WASM) в Web Worker с UCI-протоколом.
 * Воркер Stockfish.js читает URL .wasm из location.hash, поэтому мы запускаем
 * blob:-воркер из кэшированных файлов:  new Worker(blobJs + "#" + encodeURIComponent(blobWasm)).
 */
import type { EngineLine, Score } from "../types";
import type { EngineBundle } from "./engineFiles";

export interface SearchHandle {
  promise: Promise<EngineLine[]>;
  stop: () => void;
}

export interface SearchOptions {
  fen: string;
  depth: number;
  multipv: number;
  onInfo?: (lines: EngineLine[]) => void;
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

  private constructor(bundle: EngineBundle, threads: number) {
    this.threaded = bundle.set.threaded;
    this.threads = threads;
    this.variant = bundle.set.variant;
    this.worker = new Worker(bundle.jsUrl + "#" + encodeURIComponent(bundle.wasmUrl));
    this.worker.onmessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (typeof data !== "string") return;
      for (const l of Array.from(this.listeners)) l(data);
    };
  }

  static async create(bundle: EngineBundle, hashMb = 128): Promise<StockfishEngine> {
    const hw = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
    const threads = bundle.set.threaded ? Math.max(1, Math.min(8, hw - 1)) : 1;
    const eng = new StockfishEngine(bundle, threads);
    await eng.init(hashMb);
    return eng;
  }

  private send(cmd: string) {
    if (!this.dead) this.worker.postMessage(cmd);
  }

  private waitFor(pred: (l: string) => boolean, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(h);
        reject(new Error("Таймаут ожидания движка"));
      }, timeoutMs);
      const errHandler = (e: ErrorEvent) => {
        clearTimeout(timer);
        this.listeners.delete(h);
        this.worker.removeEventListener("error", errHandler);
        reject(new Error(e.message || "Ошибка воркера движка"));
      };
      const h = (l: string) => {
        if (pred(l)) {
          clearTimeout(timer);
          this.listeners.delete(h);
          this.worker.removeEventListener("error", errHandler);
          resolve(l);
        }
      };
      this.worker.addEventListener("error", errHandler);
      this.listeners.add(h);
    });
  }

  private async init(hashMb: number) {
    const uciok = this.waitFor((l) => l === "uciok", 180000);
    this.send("uci");
    await uciok;
    this.send(`setoption name Threads value ${this.threads}`);
    this.send(`setoption name Hash value ${this.threaded ? hashMb : Math.min(hashMb, 64)}`);
    const ready = this.waitFor((l) => l === "readyok", 120000);
    this.send("isready");
    await ready;
  }

  newGame() {
    this.send("ucinewgame");
  }

  search(opts: SearchOptions): SearchHandle {
    let cancelled = false;
    let active = false;
    const turn = opts.fen.split(" ")[1] === "b" ? "b" : "w";
    const promise = this.tail.then(
      () =>
        new Promise<EngineLine[]>((resolve) => {
          if (cancelled || this.dead) return resolve([]);
          active = true;
          const lines = new Map<number, EngineLine>();
          const sorted = () => Array.from(lines.values()).sort((a, b) => a.multipv - b.multipv);
          const handler = (l: string) => {
            if (l.startsWith("info ")) {
              const parsed = parseInfo(l, turn);
              if (parsed) {
                lines.set(parsed.multipv, parsed);
                opts.onInfo?.(sorted());
              }
            } else if (l.startsWith("bestmove")) {
              this.listeners.delete(handler);
              active = false;
              resolve(sorted());
            }
          };
          this.listeners.add(handler);
          if (this.lastMultiPv !== opts.multipv) {
            this.send(`setoption name MultiPV value ${opts.multipv}`);
            this.lastMultiPv = opts.multipv;
          }
          this.send(`position fen ${opts.fen}`);
          this.send(`go depth ${opts.depth}`);
        })
    );
    this.tail = promise.then(
      () => undefined,
      () => undefined
    );
    return {
      promise,
      stop: () => {
        cancelled = true;
        if (active) this.send("stop");
      },
    };
  }

  terminate() {
    this.dead = true;
    try {
      this.worker.postMessage("quit");
    } catch {
      /* ignore */
    }
    this.worker.terminate();
  }
}

function parseInfo(line: string, turn: "w" | "b"): EngineLine | null {
  if (!line.includes(" score ") || !line.includes(" pv ")) return null;
  if (line.includes(" lowerbound") || line.includes(" upperbound")) return null;
  const tokens = line.split(/\s+/);
  let depth = 0;
  let multipv = 1;
  let score: Score | null = null;
  let pv: string[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "depth") depth = parseInt(tokens[++i], 10);
    else if (t === "multipv") multipv = parseInt(tokens[++i], 10);
    else if (t === "score") {
      const kind = tokens[++i];
      const val = parseInt(tokens[++i], 10);
      const sign = turn === "w" ? 1 : -1;
      if (kind === "cp") score = { cp: val * sign };
      else if (kind === "mate") score = { mate: val * sign };
    } else if (t === "pv") {
      pv = tokens.slice(i + 1);
      break;
    }
  }
  if (!score || !pv.length) return null;
  return { multipv, depth, score, pv };
}
