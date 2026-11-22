import type { EngineLine } from "../types";

const REVIEW_POOL_PROBE_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const REVIEW_POOL_PROBE_NODES = 30_000;
const REVIEW_POOL_PROBE_DEPTH = 10;
const REVIEW_POOL_PROBE_TIMEOUT_MS = 8_000;

export interface ReviewPoolProbeWorker {
  search(options: {
    fen: string;
    depth: number;
    multipv: number;
    nodes: number;
    hardTimeoutMs: number;
  }): {
    promise: Promise<EngineLine[]>;
    stop: () => void;
  };
  terminate: () => void;
}

/**
 * A successful UCI handshake is not enough: some browsers only expose problems
 * when multiple independent WASM instances start searching at the same time.
 *
 * Require two consecutive simultaneous smoke searches. Any worker that fails is
 * terminated and removed; the remaining workers are stress-tested again. The
 * caller falls back to its already-running primary engine when fewer than two
 * independent workers survive.
 */
export async function verifyReviewWorkerPool<T extends ReviewPoolProbeWorker>(
  workers: readonly T[],
  signal?: AbortSignal,
): Promise<T[]> {
  let candidates = [...workers];
  let consecutivePasses = 0;

  while (candidates.length >= 2 && consecutivePasses < 2) {
    if (signal?.aborted) throw new Error("cancelled");

    const handles = candidates.map((worker) => worker.search({
      fen: REVIEW_POOL_PROBE_FEN,
      depth: REVIEW_POOL_PROBE_DEPTH,
      multipv: 1,
      nodes: REVIEW_POOL_PROBE_NODES,
      hardTimeoutMs: REVIEW_POOL_PROBE_TIMEOUT_MS,
    }));
    const stopAll = () => handles.forEach((handle) => handle.stop());
    signal?.addEventListener("abort", stopAll, { once: true });

    let results: PromiseSettledResult<EngineLine[]>[];
    try {
      results = await Promise.allSettled(handles.map((handle) => handle.promise));
    } finally {
      signal?.removeEventListener("abort", stopAll);
    }

    if (signal?.aborted) throw new Error("cancelled");

    const healthy: T[] = [];
    results.forEach((result, index) => {
      const hasUsableSearch = result.status === "fulfilled"
        && result.value.some((line) => line.depth > 0 && line.pv.length > 0);
      if (hasUsableSearch) {
        healthy.push(candidates[index]);
      } else {
        candidates[index].terminate();
      }
    });

    if (healthy.length !== candidates.length) {
      candidates = healthy;
      consecutivePasses = 0;
      continue;
    }

    consecutivePasses++;
  }

  if (candidates.length < 2 || consecutivePasses < 2) {
    candidates.forEach((worker) => worker.terminate());
    return [];
  }

  return candidates;
}
