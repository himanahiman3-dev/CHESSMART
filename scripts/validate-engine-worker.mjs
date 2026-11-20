import assert from "node:assert/strict";
import { StockfishEngine } from "../src/lib/engine.ts";

let nextMode = "success";
const workers = [];

class FakeWorker {
  constructor() {
    this.mode = nextMode;
    this.onmessage = null;
    this.listeners = new Map();
    this.terminated = false;
    this.commands = [];
    workers.push(this);
    nextMode = "success";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type, values = {}) {
    const event = new Event(type);
    for (const [key, value] of Object.entries(values)) {
      Object.defineProperty(event, key, { value, configurable: true });
    }
    for (const listener of Array.from(this.listeners.get(type) ?? [])) listener(event);
  }

  line(data) {
    this.onmessage?.({ data });
  }

  postMessage(command) {
    this.commands.push(command);
    if (command === "uci") {
      queueMicrotask(() => {
        if (this.mode === "init-crash") this.emit("error", { message: "simulated init crash" });
        else this.line("uciok");
      });
    } else if (command === "isready") {
      queueMicrotask(() => this.line("readyok"));
    } else if (command.startsWith("go ")) {
      if (this.mode === "minimum-depth") {
        setTimeout(() => this.line("info depth 40 multipv 1 score cp 40 pv e2e4 e7e5"), 0);
        setTimeout(() => this.line("info depth 41 multipv 1 score cp 41 pv e2e4 e7e5"), 5);
      } else {
        queueMicrotask(() => {
          this.line("info depth 8 multipv 1 score cp 42 pv e2e4 e7e5");
          if (this.mode === "search-crash") this.emit("error", { message: "simulated search crash" });
          else this.line("bestmove e2e4");
        });
      }
    } else if (command === "stop" && this.mode === "minimum-depth") {
      queueMicrotask(() => this.line("bestmove e2e4"));
    }
  }

  terminate() {
    this.terminated = true;
  }
}

globalThis.Worker = FakeWorker;

const revoked = new Set();
const nativeRevoke = URL.revokeObjectURL.bind(URL);
URL.revokeObjectURL = (url) => {
  revoked.add(url);
  nativeRevoke(url);
};

function makeBundle() {
  return {
    set: { threaded: false, variant: "lite" },
    jsUrl: URL.createObjectURL(new Blob(["fake worker"])),
    wasmUrl: URL.createObjectURL(new Blob(["fake wasm"])),
    fromCache: false,
  };
}

try {
  const successBundle = makeBundle();
  const successEngine = await StockfishEngine.create(successBundle, 64);
  const result = await successEngine.search({
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    depth: 8,
    multipv: 1,
  }).promise;
  assert.equal(result[0]?.pv[0], "e2e4", "A healthy worker must return its bestmove.");
  assert.equal(result[0]?.score.cp, 42, "A healthy worker must return its parsed score.");
  successEngine.terminate();
  assert.ok(workers.at(-1).terminated, "Terminating the engine must terminate its Worker.");
  assert.ok(revoked.has(successBundle.jsUrl) && revoked.has(successBundle.wasmUrl),
    "Terminating the engine must revoke both Blob URLs.");

  nextMode = "minimum-depth";
  const minimumBundle = makeBundle();
  const minimumEngine = await StockfishEngine.create(minimumBundle, 64);
  const minimumWorker = workers.at(-1);
  const minimumResult = await minimumEngine.search({
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    depth: 245,
    multipv: 1,
    minimumDepth: 41,
    movetimeAfterMinimumDepthMs: 20,
  }).promise;
  assert.ok(minimumWorker.commands.includes("go depth 245"),
    "A minimum-depth search must request the selected target depth without a UCI movetime cap.");
  assert.ok(!minimumWorker.commands.some((command) => command.startsWith("go depth 245 movetime")),
    "The time budget must not expire before the mandatory depth is reached.");
  assert.ok(minimumWorker.commands.includes("stop"),
    "The deferred time budget must stop the search only after the minimum depth.");
  assert.equal(minimumResult[0]?.depth, 41,
    "A search must return the depth-41 result before advancing to the next position.");
  minimumEngine.terminate();

  nextMode = "search-crash";
  const crashBundle = makeBundle();
  const crashEngine = await StockfishEngine.create(crashBundle, 64);
  const crashedSearch = crashEngine.search({
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    depth: 8,
    multipv: 1,
  });
  await assert.rejects(crashedSearch.promise, /simulated search crash/,
    "A worker crash after partial info must reject instead of returning a partial evaluation.");
  assert.ok(workers.at(-1).terminated, "A crashed worker must be terminated.");
  assert.ok(revoked.has(crashBundle.jsUrl) && revoked.has(crashBundle.wasmUrl),
    "A crashed worker must release both Blob URLs.");

  nextMode = "init-crash";
  const initBundle = makeBundle();
  await assert.rejects(StockfishEngine.create(initBundle, 64), /simulated init crash/,
    "An initialization crash must reject promptly.");
  assert.ok(workers.at(-1).terminated, "An initialization failure must terminate its Worker.");
  assert.ok(revoked.has(initBundle.jsUrl) && revoked.has(initBundle.wasmUrl),
    "An initialization failure must release both Blob URLs.");

  console.log("Stockfish worker lifecycle validated: success, mandatory depth 41, crash after partial info, init failure, and Blob URL cleanup.");
} finally {
  URL.revokeObjectURL = nativeRevoke;
}
