import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import readline from "node:readline";

const dir = resolve(process.argv[2] ?? "");
assert.ok(process.argv[2], "Pass Stockfish single-thread JS/WASM directory.");
const childPath = join(dir, "stockfish-19-lite-single.js");
const count = 4;

function start(index) {
  const child = spawn(process.execPath, [childPath], { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
  const lines = readline.createInterface({ input: child.stdout });
  const pending = [];
  let search = null;
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
  lines.on("line", (line) => {
    for (let i = pending.length - 1; i >= 0; i--) {
      if (!pending[i].test(line)) continue;
      const item = pending.splice(i, 1)[0];
      clearTimeout(item.timer);
      item.resolve(line);
    }
    if (!search) return;
    if (line.startsWith("info ") && line.includes(" pv ")) {
      const tokens = line.split(/\s+/);
      const d = tokens.indexOf("depth");
      const p = tokens.indexOf("pv");
      const depth = d >= 0 ? Number(tokens[d + 1]) : 0;
      if (p >= 0 && depth > search.depth) {
        search.depth = depth;
        search.pv = tokens.slice(p + 1);
      }
    }
    if (line.startsWith("bestmove ")) {
      const current = search;
      search = null;
      clearTimeout(current.timer);
      current.resolve({ bestmove: line.split(/\s+/)[1], ...current });
    }
  });
  function wait(test) {
    return new Promise((resolveWait, reject) => {
      const item = {
        test, resolve: resolveWait, reject,
        timer: setTimeout(() => {
          const i = pending.indexOf(item);
          if (i >= 0) pending.splice(i, 1);
          reject(new Error("Worker " + index + " handshake timeout: " + stderr));
        }, 20000),
      };
      pending.push(item);
    });
  }
  async function init() {
    const uci = wait((line) => line === "uciok");
    child.stdin.write("uci\n");
    await uci;
    child.stdin.write("setoption name Threads value 1\nsetoption name Hash value 32\nsetoption name MultiPV value 1\n");
    const ready = wait((line) => line === "readyok");
    child.stdin.write("isready\n");
    await ready;
  }
  function run(fen) {
    return new Promise((resolveSearch, rejectSearch) => {
      const current = {
        depth: 0, pv: [], resolve: resolveSearch,
        timer: setTimeout(() => {
          if (search !== current) return;
          search = null;
          child.kill();
          rejectSearch(new Error("Worker " + index + " concurrent search timeout: " + stderr));
        }, 15000),
      };
      search = current;
      child.stdin.write("position fen " + fen + "\ngo nodes 60000 depth 14\n");
    });
  }
  function close() {
    try { child.stdin.write("quit\n"); } catch {}
    child.kill();
    lines.close();
  }
  return { init, run, close };
}

const pool = Array.from({ length: count }, (_, i) => start(i + 1));
const fens = [
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
];
try {
  await Promise.all(pool.map((worker) => worker.init()));
  for (let round = 0; round < fens.length; round++) {
    const results = await Promise.all(pool.map((worker) => worker.run(fens[round])));
    results.forEach((result, i) => {
      assert.ok(result.bestmove && result.bestmove !== "(none)", "Worker " + (i + 1) + " has no bestmove.");
      assert.ok(result.depth > 0 && result.pv.length > 0, "Worker " + (i + 1) + " has no completed PV.");
    });
    console.log("Real Stockfish concurrent round " + (round + 1) + ": " + results.length + " workers passed.");
  }
  console.log("Four independent Stockfish WASM instances passed two simultaneous search rounds.");
} finally {
  pool.forEach((worker) => worker.close());
}
