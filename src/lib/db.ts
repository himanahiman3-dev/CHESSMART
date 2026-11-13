/**
 * Тонкая обёртка над IndexedDB.
 * Хранилища:
 *   positions — кэш анализа позиций (ключ: FEN + глубина + MultiPV)
 *   files     — резервное хранилище бинарников движка (если Cache API недоступен)
 *   meta      — манифест закэшированных файлов движка и настройки
 */
import type { EngineLine, PositionEval } from "../types";
import { fenKey } from "./format";

const DB_NAME = "chess-review-db";
const DB_VERSION = 1;
const STORES = ["positions", "files", "meta"] as const;
type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  try {
    return await wrap<T>(db.transaction(store, "readonly").objectStore(store).get(key));
  } catch {
    return undefined;
  }
}

export async function idbPut(store: StoreName, key: string, value: unknown): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await wrap(db.transaction(store, "readwrite").objectStore(store).delete(key));
}

export async function idbCount(store: StoreName): Promise<number> {
  const db = await openDb();
  if (!db) return 0;
  return (await wrap<number>(db.transaction(store, "readonly").objectStore(store).count())) ?? 0;
}

export async function idbClear(store: StoreName): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await wrap(db.transaction(store, "readwrite").objectStore(store).clear());
}

/* ------------------------- Кэш позиций ------------------------- */

interface StoredPosition {
  lines: EngineLine[];
  depth: number;
  at: number;
}

const memory = new Map<string, StoredPosition>();

export function positionKey(fen: string, depth: number, multipv: number): string {
  return `${fenKey(fen)}|d${depth}|pv${multipv}`;
}

export async function getCachedPosition(
  fen: string,
  depth: number,
  multipv: number
): Promise<PositionEval | undefined> {
  const key = positionKey(fen, depth, multipv);
  let rec = memory.get(key);
  if (!rec) {
    rec = await idbGet<StoredPosition>("positions", key);
    if (rec) memory.set(key, rec);
  }
  if (!rec) return undefined;
  return { fen, depth: rec.depth, lines: rec.lines };
}

export async function putCachedPosition(
  fen: string,
  depth: number,
  multipv: number,
  lines: EngineLine[],
  reachedDepth: number
): Promise<void> {
  if (!lines.length) return;
  const key = positionKey(fen, depth, multipv);
  const rec: StoredPosition = { lines, depth: reachedDepth, at: Date.now() };
  memory.set(key, rec);
  await idbPut("positions", key, rec);
}

export async function clearPositionCache(): Promise<void> {
  memory.clear();
  await idbClear("positions");
}

export async function positionCacheSize(): Promise<number> {
  return idbCount("positions");
}
