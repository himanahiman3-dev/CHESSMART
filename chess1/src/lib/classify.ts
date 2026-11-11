import { Chess } from "chess.js";
import { balance, tryUci, uciToSan } from "./chessutil";
import { buildExplanation } from "./explain";
import type { Classification, GameMove, MoveReview, PositionEval } from "./types";
import { cpToWinRate, lineWinRateFor, moveAccuracy, moverCp } from "./winrate";

/**
 * Chess.com-style move classification based on Win-Rate (WR) transitions.
 *
 *   WR = 1 / (1 + 10^(-CP/400))
 *   ΔWR = WR(best line, mover POV) - WR(after played move, mover POV)
 *
 *   Brilliant   : sacrifice, Top-1/Top-2 line, position stays winning/stable
 *   Great       : Top-1 line AND the best alternative loses >25% WR (or >150cp with a notable WR drop)
 *   Best        : Top-1 line
 *   Excellent   : ΔWR < 2%
 *   Good        : 2% ≤ ΔWR < 5%
 *   Inaccuracy  : 5% ≤ ΔWR < 10%
 *   Mistake     : 10% ≤ ΔWR < 20%
 *   Blunder     : ΔWR ≥ 20%
 *   Pawn-blunder mitigation: a Mistake/Blunder that costs ≤ ~2 pawns but leaves the mover with > +2.50 is
 *   downgraded to Inaccuracy / Good because the practical win probability stays near 100%.
 */

const CP_CAP = 1500;
const clampCp = (v: number) => Math.max(-CP_CAP, Math.min(CP_CAP, v));

function detectSacrifice(move: GameMove, after: PositionEval | null): boolean {
  if (!after || after.terminal || after.lines.length === 0) return false;
  const chess = new Chess(move.fenBefore);
  const base = balance(chess, move.color);
  if (!tryUci(chess, move.uci)) return false;
  const pv = after.lines[0].pv;
  const checkpoints: number[] = [];
  for (let k = 0; k < Math.min(pv.length, 3); k++) {
    if (!tryUci(chess, pv[k])) break;
    // balance measured right after the opponent has moved (k = 0 and k = 2)
    if (k === 0 || k === 2) checkpoints.push(balance(chess, move.color));
  }
  if (checkpoints.length === 0) return false;
  // Material must be down by at least a minor piece for a pawn (2 points) and stay down through the PV.
  return checkpoints.every((b) => b <= base - 2);
}

export function classifyMove(move: GameMove, before: PositionEval, after: PositionEval | null, prev?: GameMove | null): MoveReview {
  const color = move.color;
  const lines = before.lines;
  const best = lines[0];

  // Defensive fallback if the engine returned nothing.
  if (!best) {
    return {
      ply: move.ply,
      san: move.san,
      uci: move.uci,
      from: move.from,
      to: move.to,
      color,
      classification: "good",
      wrBefore: 0.5,
      wrAfter: 0.5,
      deltaWR: 0,
      cpLoss: 0,
      accuracy: 100,
      bestUci: null,
      bestSan: null,
      rank: -1,
      isSacrifice: false,
      mitigated: false,
      explanation: `${move.san} was played.`,
    };
  }

  const bestUci = best.pv[0] ?? null;
  const bestSan = uciToSan(move.fenBefore, bestUci);
  const rank = lines.findIndex((l) => l.pv[0] === move.uci);
  const wrBest = lineWinRateFor(best, color);
  const cpBest = moverCp(best.cp, color);

  // ---- evaluation after the played move (mover POV) ----
  let wrAfter: number;
  let cpAfter: number;
  if (after?.terminal === "checkmate") {
    wrAfter = 1;
    cpAfter = CP_CAP;
  } else if (after?.terminal) {
    wrAfter = 0.5;
    cpAfter = 0;
  } else if (rank >= 0) {
    // The played move is one of the engine's MultiPV lines: compare at identical search depth.
    wrAfter = lineWinRateFor(lines[rank], color);
    cpAfter = moverCp(lines[rank].cp, color);
  } else if (after && after.lines[0]) {
    wrAfter = lineWinRateFor(after.lines[0], color);
    cpAfter = moverCp(after.lines[0].cp, color);
  } else {
    wrAfter = wrBest;
    cpAfter = cpBest;
  }
  if (rank === 0) {
    wrAfter = wrBest;
    cpAfter = cpBest;
  }
  wrAfter = Math.min(wrAfter, wrBest);
  const deltaWR = Math.max(0, wrBest - wrAfter);
  const cpLoss = Math.max(0, clampCp(cpBest) - clampCp(cpAfter));

  // ---- second-best alternative ----
  const second = lines[1];
  const wrSecond = second ? lineWinRateFor(second, color) : null;
  const cpSecond = second ? clampCp(moverCp(second.cp, color)) : null;

  const isMateMove = move.san.endsWith("#");
  let cls: Classification;
  let isSacrifice = false;
  let mitigated = false;

  if (before.legalMoves === 1) {
    cls = "best";
  } else {
    if (rank >= 0 && rank <= 1 && deltaWR <= 0.04) isSacrifice = detectSacrifice(move, after);

    const alreadyWon = rank === 0 && wrSecond !== null && wrSecond > 0.9 && wrAfter > 0.9;
    const brilliant = isSacrifice && !isMateMove && wrAfter >= 0.45 && deltaWR <= 0.04 && !alreadyWon;

    if (brilliant) {
      cls = "brilliant";
    } else if (rank === 0) {
      const wrGap = wrSecond === null ? 0 : wrBest - wrSecond;
      const cpGap = cpSecond === null ? 0 : clampCp(cpBest) - cpSecond;
      const onlyMove = second !== undefined && !isMateMove && (wrGap > 0.25 || (cpGap > 150 && wrGap > 0.08));
      cls = onlyMove ? "great" : "best";
    } else if (deltaWR < 0.02) cls = "excellent";
    else if (deltaWR < 0.05) cls = "good";
    else if (deltaWR < 0.1) cls = "inaccuracy";
    else if (deltaWR < 0.2) cls = "mistake";
    else cls = "blunder";

    // Pawn-blunder mitigation: still completely winning after the move => not a real mistake.
    if ((cls === "mistake" || cls === "blunder") && cpAfter > 250 && cpLoss <= 200) {
      mitigated = true;
      cls = deltaWR >= 0.05 ? "inaccuracy" : "good";
    }
  }

  const explanation = buildExplanation({
    move,
    cls,
    before,
    after,
    wrBest,
    wrAfter,
    wrSecond,
    deltaWR,
    bestUci,
    rank,
    isSacrifice,
    mitigated,
    prev,
  });

  return {
    ply: move.ply,
    san: move.san,
    uci: move.uci,
    from: move.from,
    to: move.to,
    color,
    classification: cls,
    wrBefore: wrBest,
    wrAfter,
    deltaWR,
    cpLoss,
    accuracy: moveAccuracy(wrBest, wrAfter),
    bestUci,
    bestSan,
    rank,
    isSacrifice,
    mitigated,
    explanation,
  };
}

export { cpToWinRate };
