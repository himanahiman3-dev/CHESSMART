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
      if (this.mode === "info-burst") {
        for (let depth = 8; depth <= 19; depth++) {
          this.line(`info depth ${depth} multipv 1 score cp ${depth * 2} pv e2e4 e7e5`);
        }
        this.line("bestmove e2e4");
      } else if (this.mode === "timed-partial") {
        queueMicrotask(() => this.line("info depth 16 multipv 1 score cp 31 pv e2e4 e7e5"));
        setTimeout(() => this.line("bestmove e2e4"), 10);
      } else if (this.mode === "timed-watchdog") {
        queueMicrotask(() => this.line("info depth 14 multipv 1 score cp 29 pv d2d4 d7d5"));
      } else {
        queueMicrotask(() => {
          this.line("info depth 8 multipv 1 score cp 42 pv e2e4 e7e5");
          if (this.mode === "search-crash") this.emit("error", { message: "simulated search crash" });
          else this.line("bestmove e2e4");
        });
      }
    } else if (command === "stop" && this.mode === "timed-watchdog") {
      queueMicrotask(() => this.line("bestmove d2d4"));
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
  successEngine.newGame();
  const result = await successEngine.search({
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    depth: 8,
    multipv: 1,
  }).promise;
  assert.ok(workers.at(-1).commands.includes("ucinewgame")
    && workers.at(-1).commands.includes("isready"),
    "A new review must wait for Stockfish's ready handshake after ucinewgame.");
  assert.equal(result[0]?.pv[0], "e2e4", "A healthy worker must return its bestmove.");
  assert.equal(result[0]?.score.cp, 42, "A healthy worker must return its parsed score.");
  successEngine.terminate();
  assert.ok(workers.at(-1).terminated, "Terminating the engine must terminate its Worker.");
  assert.ok(revoked.has(successBundle.jsUrl) && revoked.has(successBundle.wasmUrl),
    "Terminating the engine must revoke both Blob URLs.");

  nextMode = "info-burst";
  const burstBundle = makeBundle();
  const burstEngine = await StockfishEngine.create(burstBundle, 64);
  let infoNotifications = 0;
  const burstResult = await burstEngine.search({
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    depth: 24,
    multipv: 1,
    onInfo: () => { infoNotifications += 1; },
  }).promise;
  assert.ok(infoNotifications <= 2,
    `A burst of UCI updates must be coalesced for the UI; got ${infoNotifications} callbacks.`);
  assert.equal(burstResult[0]?.depth, 19,
    "Coalescing UI notifications must not discard the latest engine evaluation.");
  burstEngine.terminate();

  nextMode = "timed-partial";
  const timedBundle = makeBundle();
  const timedEngine = await StockfishEngine.create(timedBundle, 64);
  const timedWorker = workers.at(-1);
  const timedResult = await timedEngine.search({
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    depth: 22,
    multipv: 1,
    movetimeMs: 10,
  }).promise;
  assert.ok(timedWorker.commands.includes("go depth 22 movetime 10"),
    "The main review must use a timed UCI search with a depth-22 ceiling.");
  assert.equal(timedResult[0]?.depth, 16,
    "When movetime ends before depth 22, the latest completed depth must be returned.");
  assert.equal(timedResult[0]?.score.cp, 31,
    "The last completed evaluation must be retained after the timed stop.");
  timedEngine.terminate();

  nextMode = "timed-watchdog";
  const watchdogBundle = makeBundle();
  const watchdogEngine = await StockfishEngine.create(watchdogBundle, 64);
  const watchdogWorker = workers.at(-1);
  const watchdogResult = await watchdogEngine.search({
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    depth: 22,
    multipv: 1,
    movetimeMs: 5,
  }).promise;
  assert.ok(watchdogWorker.commands.includes("go depth 22 movetime 5"),
    "The time watchdog must still use UCI movetime as the primary limit.");
  assert.ok(watchdogWorker.commands.includes("stop"),
    "A stalled worker must be stopped by the safety watchdog.");
  assert.equal(watchdogResult[0]?.depth, 14,
    "The safety watchdog must resolve with the last info line, not discard the partial search.");
  watchdogEngine.terminate();

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

  console.log("Stockfish worker lifecycle validated: timed depth-22 search, depth-16 timeout fallback, safety stop, crash handling, and Blob URL cleanup.");
} finally {
  URL.revokeObjectURL = nativeRevoke;
}
