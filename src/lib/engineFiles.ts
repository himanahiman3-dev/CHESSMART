/**
 * Загрузка и постоянное кэширование файлов Stockfish 19 (WASM).
 *
 * Бинарники (.js воркер + .wasm) скачиваются ОДИН раз с прогрессом, затем лежат в
 * Cache API (резерв — IndexedDB). Сеть нейросети NNUE в Stockfish.js 19 вшита в .wasm,
 * поэтому отдельного .nnue-файла нет — кэшируется всё вместе.
 */
import { idbGet, idbPut, idbDelete } from "./db";

export type EngineVariant = "full" | "lite";

export interface EngineFileSpec {
  name: string;
  size: number;
  mime: string;
  kind: "js" | "wasm";
}

export interface EngineFileSet {
  variant: EngineVariant;
  threaded: boolean;
  js: EngineFileSpec;
  wasm: EngineFileSpec;
  totalBytes: number;
}

const js = (name: string, size: number): EngineFileSpec => ({
  name: name + ".js",
  size,
  mime: "text/javascript",
  kind: "js",
});
const wasm = (name: string, size: number): EngineFileSpec => ({
  name: name + ".wasm",
  size,
  mime: "application/wasm",
  kind: "wasm",
});

const SETS: Record<EngineVariant, { multi: [EngineFileSpec, EngineFileSpec]; single: [EngineFileSpec, EngineFileSpec] }> = {
  full: {
    multi: [js("stockfish-19", 33326), wasm("stockfish-19", 99076105)],
    single: [js("stockfish-19-single", 28130), wasm("stockfish-19-single", 99169054)],
  },
  lite: {
    multi: [js("stockfish-19-lite", 33426), wasm("stockfish-19-lite", 1697617)],
    single: [js("stockfish-19-lite-single", 28230), wasm("stockfish-19-lite-single", 1845971)],
  },
};

export const ENGINE_VERSION = "19.0.1";
const CACHE_NAME = "stockfish19-engine-v1";

export function canUseThreads(): boolean {
  return typeof SharedArrayBuffer !== "undefined" && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

export function getFileSet(variant: EngineVariant, threaded: boolean): EngineFileSet {
  const [j, w] = threaded ? SETS[variant].multi : SETS[variant].single;
  return { variant, threaded, js: j, wasm: w, totalBytes: j.size + w.size };
}

function sources(name: string): string[] {
  const base = (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL || "/";
  return [
    new URL(`${base}engine/${name}`, document.baseURI).href, // локальная копия (если есть)
    `https://unpkg.com/stockfish@${ENGINE_VERSION}/bin/${name}`, // CDN с CORS + CORP
  ];
}

function cacheRequest(name: string): Request {
  return new Request(new URL(`__engine-cache__/${ENGINE_VERSION}/${name}`, location.origin).href);
}

interface MetaRec {
  name: string;
  size: number;
  version: string;
  cachedAt: number;
  store: "cache" | "idb";
}

export interface EngineProgress {
  loaded: number;
  total: number;
  file: string;
  fromCache: boolean;
  phase: "check" | "download" | "ready";
  speed: number; // байт/с
}

async function readCached(spec: EngineFileSpec): Promise<Blob | null> {
  const meta = await idbGet<MetaRec>("meta", `file:${spec.name}`);
  if (!meta || meta.version !== ENGINE_VERSION || meta.size !== spec.size) return null;
  try {
    if (meta.store === "cache" && "caches" in self) {
      const cache = await caches.open(CACHE_NAME);
      const res = await cache.match(cacheRequest(spec.name));
      if (res) {
        const b = await res.blob();
        if (b.size === spec.size) return new Blob([b], { type: spec.mime });
      }
    } else {
      const rec = await idbGet<{ blob: Blob }>("files", spec.name);
      if (rec?.blob && rec.blob.size === spec.size) return new Blob([rec.blob], { type: spec.mime });
    }
  } catch {
    /* упадём в повторную загрузку */
  }
  return null;
}

export async function isEngineCached(set: EngineFileSet): Promise<boolean> {
  for (const spec of [set.js, set.wasm]) {
    const meta = await idbGet<MetaRec>("meta", `file:${spec.name}`);
    if (!meta || meta.version !== ENGINE_VERSION || meta.size !== spec.size) return false;
    if (meta.store === "cache" && "caches" in self) {
      try {
        const cache = await caches.open(CACHE_NAME);
        if (!(await cache.match(cacheRequest(spec.name)))) return false;
      } catch {
        return false;
      }
    }
  }
  return true;
}

async function storeFile(spec: EngineFileSpec, blob: Blob): Promise<void> {
  let store: "cache" | "idb" = "idb";
  try {
    if ("caches" in self) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(
        cacheRequest(spec.name),
        new Response(blob, { headers: { "content-type": spec.mime, "content-length": String(blob.size) } })
      );
      store = "cache";
    }
  } catch {
    store = "idb";
  }
  if (store === "idb") {
    const ok = await idbPut("files", spec.name, { blob });
    if (!ok) return; // не получилось сохранить — просто не кэшируем
  }
  const meta: MetaRec = { name: spec.name, size: spec.size, version: ENGINE_VERSION, cachedAt: Date.now(), store };
  await idbPut("meta", `file:${spec.name}`, meta);
}

async function downloadFile(
  spec: EngineFileSpec,
  onBytes: (delta: number) => void,
  signal?: AbortSignal
): Promise<Blob> {
  let lastErr: unknown = null;
  for (const url of sources(spec.name)) {
    let counted = 0;
    try {
      const res = await fetch(url, { mode: "cors", signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("text/html")) throw new Error(`Неверный тип ответа (${ct}) ${url}`);
      const reader = res.body?.getReader();
      const chunks: BlobPart[] = [];
      let size = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            size += value.byteLength;
            counted += value.byteLength;
            onBytes(value.byteLength);
          }
        }
      } else {
        const buf = await res.arrayBuffer();
        chunks.push(buf);
        size = buf.byteLength;
        counted = size;
        onBytes(size);
      }
      if (size !== spec.size) throw new Error(`Размер ${size} ≠ ожидаемому ${spec.size} (${url})`);
      return new Blob(chunks, { type: spec.mime });
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e;
      onBytes(-counted); // откат прогресса для следующего источника
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Не удалось скачать " + spec.name);
}

export interface EngineBundle {
  set: EngineFileSet;
  jsUrl: string;
  wasmUrl: string;
  fromCache: boolean;
}

/** Возвращает blob-URL файлов движка (из кэша или после скачивания). */
export async function prepareEngineFiles(
  set: EngineFileSet,
  onProgress: (p: EngineProgress) => void,
  signal?: AbortSignal
): Promise<EngineBundle> {
  const total = set.totalBytes;
  let loaded = 0;
  const started = performance.now();
  let allCached = true;
  const emit = (file: string, phase: EngineProgress["phase"], fromCache: boolean) => {
    const dt = Math.max(0.001, (performance.now() - started) / 1000);
    onProgress({ loaded, total, file, phase, fromCache, speed: loaded / dt });
  };

  const blobs: Blob[] = [];
  for (const spec of [set.js, set.wasm]) {
    emit(spec.name, "check", true);
    let blob = await readCached(spec);
    if (blob) {
      loaded += spec.size;
      emit(spec.name, "check", true);
    } else {
      allCached = false;
      await idbDelete("meta", `file:${spec.name}`);
      blob = await downloadFile(
        spec,
        (d) => {
          loaded += d;
          emit(spec.name, "download", false);
        },
        signal
      );
      await storeFile(spec, blob);
    }
    blobs.push(blob);
  }
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* ignore */
  }
  emit("", "ready", allCached);
  return {
    set,
    jsUrl: URL.createObjectURL(blobs[0]),
    wasmUrl: URL.createObjectURL(blobs[1]),
    fromCache: allCached,
  };
}

export async function clearEngineCache(): Promise<void> {
  try {
    if ("caches" in self) await caches.delete(CACHE_NAME);
  } catch {
    /* ignore */
  }
  for (const v of ["full", "lite"] as EngineVariant[])
    for (const t of [true, false]) {
      const set = getFileSet(v, t);
      for (const spec of [set.js, set.wasm]) {
        await idbDelete("meta", `file:${spec.name}`);
        await idbDelete("files", spec.name);
      }
    }
}
