import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import readline from "node:readline";

const engineDir = resolve(process.argv[2] ?? "");
assert.ok(process.argv[2], "Pass the directory containing the release JS/WASM pairs");

const engines = [
  {
    label: "Stockfish 19 Lite threaded",
    js: "stockfish-19-lite.js",
    wasm: "stockfish-19-lite.wasm",
    jsBytes: 33426,
    wasmBytes: 1697617,
    jsSha256: "dac939ff529668e0168b2f615145ec18b029b753deb6963fd7319d788f964333",
    wasmSha256: "ddf06cdaf0b8e35c11b40530e44db96c2a99c9029c8d621dd9fca97e4872770c",
    threads: 2,
  },
  {
    label: "Stockfish 19 Lite single-threaded",
    js: "stockfish-19-lite-single.js",
    wasm: "stockfish-19-lite-single.wasm",
    jsBytes: 28230,
    wasmBytes: 1845971,
    jsSha256: "ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a",
    wasmSha256: "ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de",
    threads: 1,
  },
  {
    label: "Stockfish 19 Full single-threaded",
    js: "stockfish-19-single.js",
    wasm: "stockfish-19-single.wasm",
    jsBytes: 28130,
    wasmBytes: 99169054,
    jsSha256: "8071dee87312f74805a859de933e1a1ef465579ab1a51fbd597388cdce9d444d",
    wasmSha256: "991bede2f253ebb08ff01fcc48270f4b9c8e66b12d5bd5f8d6f52eb3e3b3a740",
    threads: 1,
  },
];

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function verifyAsset(path, bytes, sha256) {
  assert.ok(existsSync(path), `Missing Stockfish runtime asset: ${path}`);
  assert.equal(statSync(path).size, bytes, `Unexpected size for ${path}`);
  assert.equal(digest(path), sha256, `SHA-256 mismatch for ${path}`);
}

async function runUciSmoke(engine) {
  const jsPath = join(engineDir, engine.js);
  const child = spawn(process.execPath, [jsPath], {
    cwd: dirname(jsPath),
    stdio: ["pipe", "pipe", "pipe"],
  });

  let phase = "uci";
  let maxDepth = 0;
  const multipv = new Set();
  let bestMove = "";
  let stderr = "";

  const output = readline.createInterface({ input: child.stdout });
  output.on("line", (line) => {
    if (line === "uciok" && phase === "uci") {
      phase = "ready";
      child.stdin.write("setoption name MultiPV value 2\n");
      if (engine.threads > 1) child.stdin.write(`setoption name Threads value ${engine.threads}\n`);
      child.stdin.write("isready\n");
      return;
    }
    if (line === "readyok" && phase === "ready") {
      phase = "search";
      child.stdin.write("position startpos moves e2e4 e7e5 g1f3\n");
      child.stdin.write("go depth 8\n");
      return;
    }
    if (phase === "search" && line.startsWith("info ")) {
      const depthMatch = line.match(/\bdepth (\d+)/);
      const pvMatch = line.match(/\bmultipv (\d+)/);
      if (depthMatch) maxDepth = Math.max(maxDepth, Number(depthMatch[1]));
      if (pvMatch) multipv.add(Number(pvMatch[1]));
      return;
    }
    if (phase === "search" && line.startsWith("bestmove ")) {
      bestMove = line.split(/\s+/)[1] ?? "";
      phase = "done";
      child.stdin.write("quit\n");
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  child.stdin.write("uci\n");

  await new Promise((resolveRun, rejectRun) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      rejectRun(new Error(`${engine.label}: UCI smoke test timed out\n${stderr}`));
    }, 120_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectRun(new Error(`${engine.label}: failed to start: ${error.message}`));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0 || !bestMove) {
        rejectRun(new Error(`${engine.label}: process exited (code=${code}, signal=${signal}), bestmove=${bestMove || "missing"}\n${stderr}`));
        return;
      }
      try {
        assert.match(bestMove, /^[a-h][1-8][a-h][1-8][qrbn]?$/, "Stockfish must return a legal-shape UCI move");
        assert.ok(maxDepth >= 6, `Expected a completed search, reached depth ${maxDepth}`);
        assert.ok(multipv.has(1) && multipv.has(2), "MultiPV 2 must return both principal lines");
        resolveRun();
      } catch (error) {
        rejectRun(error);
      }
    });
  });

  console.log(`✓ ${engine.label}: UCI handshake, readiness, MultiPV 2, depth ${maxDepth}, bestmove ${bestMove}`);
}

for (const engine of engines) {
  const jsPath = join(engineDir, engine.js);
  const wasmPath = join(engineDir, engine.wasm);
  verifyAsset(jsPath, engine.jsBytes, engine.jsSha256);
  verifyAsset(wasmPath, engine.wasmBytes, engine.wasmSha256);
  await runUciSmoke(engine);
}

console.log("Stockfish runtime smoke tests passed for Full, Lite threaded, and Lite single-threaded builds.");
