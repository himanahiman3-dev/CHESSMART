import type { EngineInfo, EngineLine, EngineSettings } from "./types";
import { mateToCp } from "./winrate";

export interface AnalysisResult {
  lines: EngineLine[];
  depth: number;
}

type Listener = (msg: string) => void;

export function recommendedSettings(): EngineSettings {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  return {
    variant: "full",
    depth: 20,
    multiPv: 4,
    threads: Math.max(1, cores - 1),
    // The WASM build addresses at most 2 GB of linear memory (32-bit), so the practical hash ceiling is ~1 GB.
    hashMb: 1024,
  };
}

/**
 * Thin UCI wrapper around the Stockfish 19 WebAssembly worker.
 * Engine files are served by /engine/[file] (straight from the `stockfish` npm package).
 */
export class StockfishEngine {
  private worker: Worker | null = null;
  private listeners = new Set<Listener>();
  private chain: Promise<unknown> = Promise.resolve();
  info: EngineInfo | null = null;
  private multiPv = 4;

  static isIsolated(): boolean {
    return typeof crossOriginIsolated !== "undefined" && crossOriginIsolated && typeof SharedArrayBuffer !== "undefined";
  }

  private static pickFile(variant: "full" | "lite", isolated: boolean): string {
    if (variant === "full") return isolated ? "stockfish-19.js" : "stockfish-19-single.js";
    return isolated ? "stockfish-19-lite.js" : "stockfish-19-lite-single.js";
  }

  private send(cmd: string) {
    this.worker?.postMessage(cmd);
  }

  private waitFor(predicate: (msg: string) => boolean, timeoutMs = 120000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error("Engine timed out"));
      }, timeoutMs);
      const listener: Listener = (msg) => {
        if (predicate(msg)) {
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve(msg);
        }
      };
      this.listeners.add(listener);
    });
  }

  private spawn(file: string, onLoadProgress?: (pct: number) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(`/engine/${file}`);
      this.worker = worker;
      worker.onmessage = (ev: MessageEvent) => {
        const data = ev.data as unknown;
        if (typeof data === "string") {
          this.listeners.forEach((l) => l(data));
        } else if (data && typeof data === "object" && "percent" in data && onLoadProgress) {
          onLoadProgress(Number((data as { percent: number }).percent) || 0);
        }
      };
      worker.onerror = (e) => {
        reject(new Error(e.message || `Failed to start ${file}`));
      };
      let name = "Stockfish 19";
      const idListener: Listener = (m) => {
        if (m.startsWith("id name ")) name = m.slice(8).trim();
      };
      this.listeners.add(idListener);
      this.waitFor((m) => m === "uciok")
        .then(() => {
          this.listeners.delete(idListener);
          resolve(name);
        })
        .catch(reject);
      this.send("uci");
    });
  }

  async init(settings: EngineSettings, onStatus?: (msg: string, pct?: number) => void): Promise<EngineInfo> {
    this.dispose();
    const isolated = StockfishEngine.isIsolated();
    let variant = settings.variant;
    let file = StockfishEngine.pickFile(variant, isolated);
    onStatus?.(
      variant === "full" ? "Downloading Stockfish 19 NNUE network (~100 MB, cached after first load)…" : "Loading Stockfish 19 Lite…",
      0,
    );
    let name: string;
    try {
      name = await this.spawn(file, (p) => onStatus?.("Downloading Stockfish 19 NNUE network…", p));
    } catch {
      // Fallback: lite single-threaded engine works everywhere.
      this.dispose();
      variant = "lite";
      file = StockfishEngine.pickFile("lite", false);
      onStatus?.("Full engine unavailable – falling back to Stockfish 19 Lite…");
      name = await this.spawn(file);
    }
    const threads = isolated && file.indexOf("single") === -1 ? settings.threads : 1;
    this.multiPv = settings.multiPv;
    if (threads > 1) this.send(`setoption name Threads value ${threads}`);
    this.send(`setoption name Hash value ${settings.hashMb}`);
    this.send(`setoption name MultiPV value ${settings.multiPv}`);
    this.send("isready");
    await this.waitFor((m) => m === "readyok");
    this.info = { name, file, threads, hashMb: settings.hashMb, isolated, variant };
    return this.info;
  }

  newGame() {
    this.send("ucinewgame");
    this.send("isready");
  }

  /** Parse a UCI "info ... multipv N score cp X|mate Y ... pv ..." line. Scores are normalised to White's POV. */
  static parseInfo(msg: string, whiteToMove: boolean): EngineLine | null {
    if (!msg.startsWith("info ") || !msg.includes(" pv ") || !msg.includes(" score ")) return null;
    const t = msg.split(/\s+/);
    let depth = 0;
    let multipv = 1;
    let cp = 0;
    let mate: number | null = null;
    let pv: string[] = [];
    for (let i = 1; i < t.length; i++) {
      switch (t[i]) {
        case "depth":
          depth = parseInt(t[++i], 10);
          break;
        case "multipv":
          multipv = parseInt(t[++i], 10);
          break;
        case "score": {
          const kind = t[++i];
          const value = parseInt(t[++i], 10);
          if (kind === "cp") cp = value;
          else if (kind === "mate") mate = value;
          if (t[i + 1] === "lowerbound" || t[i + 1] === "upperbound") return null;
          break;
        }
        case "pv":
          pv = t.slice(i + 1);
          i = t.length;
          break;
        default:
          break;
      }
    }
    if (pv.length === 0) return null;
    const sign = whiteToMove ? 1 : -1;
    if (mate !== null) {
      return { multipv, depth, cp: sign * mateToCp(mate), mate: sign * mate, pv };
    }
    return { multipv, depth, cp: sign * cp, mate: null, pv };
  }

  analyze(fen: string, depth: number, onUpdate?: (lines: EngineLine[], depth: number) => void): Promise<AnalysisResult> {
    const run = () =>
      new Promise<AnalysisResult>((resolve, reject) => {
        if (!this.worker) return reject(new Error("Engine not initialised"));
        const whiteToMove = fen.split(" ")[1] !== "b";
        const lines = new Map<number, EngineLine>();
        const snapshot = () =>
          Array.from(lines.values())
            .sort((a, b) => a.multipv - b.multipv)
            .slice(0, this.multiPv);
        const listener: Listener = (msg) => {
          if (msg.startsWith("bestmove")) {
            this.listeners.delete(listener);
            const final = snapshot();
            resolve({ lines: final, depth: final[0]?.depth ?? 0 });
            return;
          }
          const parsed = StockfishEngine.parseInfo(msg, whiteToMove);
          if (parsed) {
            lines.set(parsed.multipv, parsed);
            onUpdate?.(snapshot(), parsed.depth);
          }
        };
        this.listeners.add(listener);
        this.send(`position fen ${fen}`);
        this.send(`go depth ${depth}`);
      });
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  stop() {
    this.send("stop");
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.listeners.clear();
    this.chain = Promise.resolve();
  }
}
