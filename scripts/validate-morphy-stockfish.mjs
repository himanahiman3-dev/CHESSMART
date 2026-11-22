import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import readline from "node:readline";
import { Chess } from "chess.js";
import { detectSacrifice } from "../src/lib/see.ts";
import { qualifiesAsBrilliant } from "../src/lib/brilliant.ts";
import { cpFor, winForRated } from "../src/lib/winprob.ts";

const engineDir = resolve(process.argv[2] ?? "");
assert.ok(process.argv[2], "Pass the directory containing Stockfish 19 Lite JS/WASM.");
const enginePath = join(engineDir, "stockfish-19-lite-single.js");
const child = spawn(process.execPath, [enginePath], {
  cwd: engineDir,
  stdio: ["pipe", "pipe", "pipe"],
});
const output = readline.createInterface({ input: child.stdout });
const waiters = [];
let activeSearch = null;
let stderr = "";

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
output.on("line", (line) => {
  for (let i = waiters.length - 1; i >= 0; i--) {
    const waiter = waiters[i];
    if (waiter.predicate(line)) {
      waiters.splice(i, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(line);
    }
  }
  if (!activeSearch) return;
  if (line.startsWith("info ")) {
    const parsed = parseInfo(line, activeSearch.turn);
    if (parsed) activeSearch.lines.set(parsed.multipv, parsed);
  } else if (line.startsWith("bestmove ")) {
    const search = activeSearch;
    activeSearch = null;
    search.resolve([...search.lines.values()].sort((a, b) => a.multipv - b.multipv));
  }
});

function waitForLine(predicate, timeoutMs = 30_000) {
  return new Promise((resolveWait, reject) => {
    const waiter = {
      predicate,
      resolve: resolveWait,
      timer: setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error("Stockfish handshake timed out. " + stderr));
      }, timeoutMs),
    };
    waiters.push(waiter);
  });
}

function parseInfo(line, turn) {
  if (!line.startsWith("info ") || !line.includes(" score ") || !line.includes(" pv ")) return null;
  const tokens = line.trim().split(/\s+/);
  const at = (name) => tokens.indexOf(name);
  const depthIndex = at("depth");
  const multipvIndex = at("multipv");
  const scoreIndex = at("score");
  const pvIndex = at("pv");
  if (scoreIndex < 0 || pvIndex < 0) return null;
  const depth = depthIndex >= 0 ? Number(tokens[depthIndex + 1]) : 0;
  const multipv = multipvIndex >= 0 ? Number(tokens[multipvIndex + 1]) : 1;
  const kind = tokens[scoreIndex + 1];
  const raw = Number(tokens[scoreIndex + 2]);
  if (!Number.isFinite(raw)) return null;
  const sign = turn === "w" ? 1 : -1;
  const score = kind === "mate"
    ? { mate: raw * sign }
    : kind === "cp"
      ? { cp: raw * sign }
      : null;
  if (!score) return null;
  return { multipv, depth, score, pv: tokens.slice(pvIndex + 1) };
}

async function search(startFen, moves) {
  const turn = moves.length
    ? (new Chess(startFen).turn() === "w" ? "b" : "w")
    : new Chess(startFen).turn();
  const result = new Promise((resolveSearch, rejectSearch) => {
    const timer = setTimeout(() => {
      activeSearch = null;
      rejectSearch(new Error("Stockfish Morphy search timed out. " + stderr));
    }, 60_000);
    activeSearch = {
      turn,
      lines: new Map(),
      resolve: (lines) => {
        clearTimeout(timer);
        resolveSearch(lines);
      },
    };
  });
  child.stdin.write(`position fen ${startFen}${moves.length ? " moves " + moves.join(" ") : ""}\n`);
  child.stdin.write("go nodes 3000000 depth 30\n");
  const lines = await result;
  assert.ok(lines.length >= 2, `Expected MultiPV 2; got ${lines.length} lines`);
  return lines;
}

const pgn = `[Event "Paris Opera"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[White "Paul Morphy"]
[Black "Duke of Brunswick & Count Isouard"]
[Result "1-0"]
[WhiteElo "2690"]
[BlackElo "2100"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5
6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5
11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6
15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;
const game = new Chess();
game.loadPgn(pgn);
const history = game.history({ verbose: true });
const startFen = history[0].before;
const targets = [
  { san: "Nxb5", index: history.findIndex((move) => move.san === "Nxb5"), elo: 2690 },
  { san: "Rxd7", index: history.findIndex((move) => move.san === "Rxd7"), elo: 2690 },
  { san: "Qb8+", index: history.findIndex((move) => move.san === "Qb8+"), elo: 2690 },
];

try {
  const uci = waitForLine((line) => line === "uciok");
  child.stdin.write("uci\n");
  await uci;
  child.stdin.write("setoption name Threads value 1\n");
  child.stdin.write("setoption name Hash value 64\n");
  child.stdin.write("setoption name MultiPV value 2\n");
  const ready = waitForLine((line) => line === "readyok");
  child.stdin.write("isready\n");
  await ready;

  for (const target of targets) {
    assert.ok(target.index >= 0, `Missing Morphy move ${target.san}`);
    const move = history[target.index];
    const prefix = history.slice(0, target.index).map((entry) =>
      entry.from + entry.to + (entry.promotion ?? "")
    );
    const beforeLines = await search(startFen, prefix);
    const afterPrefix = [...prefix, move.from + move.to + (move.promotion ?? "")];
    const afterLines = await search(startFen, afterPrefix);
    const best = beforeLines[0];
    const second = beforeLines[1];
    const playedIsBest = best.pv[0] === move.from + move.to + (move.promotion ?? "");
    const playedSecond = !playedIsBest && second.pv[0] === move.from + move.to + (move.promotion ?? "");
    const playedScore = playedIsBest ? best.score : playedSecond ? second.score : afterLines[0].score;
    const winBefore = winForRated(best.score, move.color, target.elo);
    const winAfter = playedIsBest ? winBefore : winForRated(playedScore, move.color, target.elo);
    const winLoss = Math.max(0, winBefore - winAfter);
    const alternativeWin = playedIsBest
      ? winForRated(second.score, move.color, target.elo)
      : winBefore;
    const scoreAfter = afterLines[0].score;
    const mateBefore = best.score.mate !== undefined && cpFor(best.score, move.color) > 0;
    const mateAfter = scoreAfter.mate !== undefined && cpFor(scoreAfter, move.color) > 0;
    const lostMate = mateBefore && !mateAfter;
    const allowedMate = scoreAfter.mate !== undefined
      && cpFor(scoreAfter, move.color) < 0
      && !(best.score.mate !== undefined && cpFor(best.score, move.color) < 0);
    const sacrifice = detectSacrifice(move.before, move.from + move.to + (move.promotion ?? ""), target.elo);
    const legalMoves = new Chess(move.before).moves().length;
    const brilliant = qualifiesAsBrilliant({
      sacrifice: sacrifice.sacrifice,
      legalMoves,
      alternativeWin,
      winLoss,
      winAfter,
      lostMate,
      allowedMate,
      elo: target.elo,
    });
    console.log(`${target.san}: best=${playedIsBest}, nearBestLoss=${winLoss.toFixed(2)}pp, alternative=${alternativeWin.toFixed(2)}%, after=${winAfter.toFixed(2)}%, sacrifice=${sacrifice.sacrifice}, Brilliant=${brilliant}`);
    assert.equal(brilliant, true, `Real Stockfish 19 must classify Morphy's ${target.san} as Brilliant.`);
  }
  console.log("Real Stockfish 19 Morphy Brilliant regression passed for all three target moves.");
} finally {
  child.stdin.write("quit\n");
  child.kill();
}
