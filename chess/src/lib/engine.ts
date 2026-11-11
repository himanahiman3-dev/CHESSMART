// Stockfish 19 (полная версия, NNUE встроена) — загрузка, кэш в браузере и UCI-обёртка.

export const SF_VERSION = "19.0.1";
const BASE = `https://unpkg.com/stockfish@${SF_VERSION}/bin/`;
const JS_URL = BASE + "stockfish-19-single.js";
const WASM_URL = BASE + "stockfish-19-single.wasm";
const WASM_SIZE_GUESS = 99169054;
const CACHE_NAME = "stockfish-19-full-v1";

export interface DownloadProgress {
  loaded: number;
  total: number;
  phase: "download" | "cache" | "start";
}

export interface PosResult {
  /** оценка с точки зрения стороны, которая ходит; мат → ±(10000 - n) */
  value: number;
  mate: number | null;
  depth: number;
  pv: string[];
  best: string;
}

async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches === "undefined") return null;
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

export async function isEngineCached(): Promise<boolean> {
  const cache = await openCache();
  if (!cache) return false;
  try {
    const [a, b] = await Promise.all([cache.match(JS_URL), cache.match(WASM_URL)]);
    return !!a && !!b;
  } catch {
    return false;
  }
}

export async function clearEngineCache(): Promise<void> {
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    /* ignore */
  }
}

async function downloadBlob(
  url: string,
  type: string,
  guess: number,
  onBytes: (n: number) => void
): Promise<Blob> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`Не удалось скачать ${url.split("/").pop()} (${res.status})`);
  if (!res.body) {
    const b = await res.blob();
    onBytes(guess);
    return new Blob([b], { type });
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.length;
      onBytes(loaded);
    }
  }
  return new Blob(chunks as BlobPart[], { type });
}

async function getAsset(
  url: string,
  type: string,
  guess: number,
  cache: Cache | null,
  onBytes: (n: number) => void
): Promise<Blob> {
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        const b = await hit.blob();
        if (b.size > 1000) {
          onBytes(guess);
          return new Blob([b], { type });
        }
      }
    } catch {
      /* fallthrough */
    }
  }
  const blob = await downloadBlob(url, type, guess, onBytes);
  if (cache) {
    try {
      await cache.put(url, new Response(blob, { headers: { "Content-Type": type } }));
    } catch {
      /* квота — работаем без кэша */
    }
  }
  return blob;
}

export class Engine {
  private worker: Worker;
  private listeners = new Set<(line: string) => void>();
  private urls: string[];
  busy = false;

  private constructor(worker: Worker, urls: string[]) {
    this.worker = worker;
    this.urls = urls;
    worker.onmessage = (e: MessageEvent) => {
      const line = typeof e.data === "string" ? e.data : null;
      if (line === null) return;
      this.listeners.forEach((l) => l(line));
    };
  }

  static async create(
    onProgress: (p: DownloadProgress) => void,
    hashMb: number
  ): Promise<Engine> {
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* ignore */
    }
    const cache = await openCache();
    let jsLoaded = 0;
    let wasmLoaded = 0;
    const report = () =>
      onProgress({
        loaded: jsLoaded + wasmLoaded,
        total: 30000 + WASM_SIZE_GUESS,
        phase: "download",
      });
    const jsBlob = await getAsset(JS_URL, "text/javascript", 30000, cache, (n) => {
      jsLoaded = n;
      report();
    });
    const wasmBlob = await getAsset(WASM_URL, "application/wasm", WASM_SIZE_GUESS, cache, (n) => {
      wasmLoaded = Math.min(n, WASM_SIZE_GUESS);
      report();
    });
    onProgress({ loaded: 1, total: 1, phase: "start" });
    const jsUrl = URL.createObjectURL(jsBlob);
    const wasmUrl = URL.createObjectURL(wasmBlob);
    const worker = new Worker(`${jsUrl}#${encodeURIComponent(wasmUrl)}`);
    const engine = new Engine(worker, [jsUrl, wasmUrl]);
    await engine.init(hashMb);
    return engine;
  }

  private on(fn: (line: string) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  send(cmd: string) {
    this.worker.postMessage(cmd);
  }

  private waitFor(pred: (line: string) => boolean, timeout = 120000): Promise<string> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        off();
        reject(new Error("Движок не отвечает"));
      }, timeout);
      const off = this.on((line) => {
        if (pred(line)) {
          clearTimeout(t);
          off();
          resolve(line);
        }
      });
    });
  }

  private async init(hashMb: number) {
    const failed = new Promise<never>((_, reject) => {
      this.worker.onerror = (e) => {
        reject(new Error("не удалось запустить движок" + (e.message ? ` (${e.message})` : "")));
      };
    });
    failed.catch(() => {});
    const ok = this.waitFor((l) => l === "uciok", 120000);
    ok.catch(() => {});
    this.send("uci");
    await Promise.race([ok, failed]);
    this.send(`setoption name Hash value ${hashMb}`);
    this.send("setoption name Threads value 1");
    this.send("setoption name UCI_AnalyseMode value true");
    await this.ready();
  }

  async ready() {
    const p = this.waitFor((l) => l === "readyok", 60000);
    this.send("isready");
    await p;
  }

  newGame() {
    this.send("ucinewgame");
  }

  /** Анализ позиции на фиксированное время (мс). */
  analyse(fen: string, movetime: number): Promise<PosResult> {
    return new Promise((resolve) => {
      let depth = 0;
      let cp: number | null = null;
      let mate: number | null = null;
      let pv: string[] = [];
      const off = this.on((line) => {
        if (line.startsWith("info")) {
          if (!line.includes(" score ") || !line.includes(" pv ")) return;
          if (line.includes("lowerbound") || line.includes("upperbound")) return;
          const d = /\sdepth (\d+)/.exec(line);
          const c = /score cp (-?\d+)/.exec(line);
          const m = /score mate (-?\d+)/.exec(line);
          const p = /\spv (.+)$/.exec(line);
          if (d) depth = +d[1];
          if (c) {
            cp = +c[1];
            mate = null;
          }
          if (m) {
            mate = +m[1];
            cp = null;
          }
          if (p) pv = p[1].trim().split(/\s+/);
        } else if (line.startsWith("bestmove")) {
          off();
          const best = line.split(/\s+/)[1] || pv[0] || "";
          const value =
            mate !== null
              ? (mate > 0 ? 1 : -1) * (10000 - Math.min(Math.abs(mate), 9000))
              : cp ?? 0;
          resolve({ value, mate, depth, pv, best: best === "(none)" ? "" : best });
        }
      });
      this.send(`position fen ${fen}`);
      this.send(`go movetime ${Math.max(20, Math.round(movetime))}`);
    });
  }

  stop() {
    this.send("stop");
  }

  terminate() {
    try {
      this.worker.terminate();
    } catch {
      /* ignore */
    }
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.listeners.clear();
  }
}
