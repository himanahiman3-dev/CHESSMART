import { Chess, type Square } from "chess.js";
import { PIECE_NAME, PIECE_VALUE, balance, opposite, threatenedPieces, tryUci } from "./chessutil";
import type { Classification, GameMove, PositionEval } from "./types";

/**
 * Coach explanation generator.
 * The returned text contains placeholders that the UI resolves depending on whose perspective is reviewed:
 *   {S} = "You" / "White" / "Black"      {P} = "your" / "White's" / "Black's"      {Op} = "your opponent's" / "your" / ...
 */

export interface ExplainContext {
  move: GameMove;
  cls: Classification;
  before: PositionEval;
  after: PositionEval | null;
  wrBest: number;
  wrAfter: number;
  wrSecond: number | null;
  deltaWR: number;
  bestUci: string | null;
  rank: number;
  isSacrifice: boolean;
  mitigated: boolean;
  prev?: GameMove | null;
}

type State = "winning" | "better" | "equal" | "worse" | "losing";

function stateOf(wr: number): State {
  if (wr >= 0.85) return "winning";
  if (wr >= 0.62) return "better";
  if (wr >= 0.38) return "equal";
  if (wr >= 0.15) return "worse";
  return "losing";
}

const STATE_PHRASE: Record<State, string> = {
  winning: "a winning position",
  better: "a clear advantage",
  equal: "a balanced position",
  worse: "a slightly worse position",
  losing: "a losing position",
};

const article = (name: string) => (name === "queen" ? "a queen" : `a ${name}`);

export function buildExplanation(ctx: ExplainContext): string {
  const { move, cls, before, after } = ctx;
  const color = move.color;
  const enemy = opposite(color);
  const beforeChess = new Chess(move.fenBefore);
  const afterChess = new Chess(move.fenAfter);

  const movedName = PIECE_NAME[move.piece];
  const capturedName = move.captured ? PIECE_NAME[move.captured] : null;
  const isMate = move.san.endsWith("#");
  const isCheck = move.san.includes("+");
  const isCastle = move.flags.includes("k") || move.flags.includes("q");

  // ---- facts about the best move ----
  const best = before.lines[0];
  const bestUci = ctx.bestUci;
  let bestSan: string | null = null;
  let bestCaptured: string | null = null;
  let bestIsCheck = false;
  if (bestUci) {
    const c = new Chess(move.fenBefore);
    const bm = tryUci(c, bestUci);
    if (bm) {
      bestSan = bm.san;
      bestCaptured = bm.captured ? bm.captured : null;
      bestIsCheck = bm.san.includes("+") || bm.san.includes("#");
    }
  }
  const bestMateForMover =
    best && best.mate !== null && best.mate !== 0 && (color === "w" ? best.mate > 0 : best.mate < 0)
      ? Math.abs(best.mate)
      : null;

  // ---- facts about the opponent's best reply ----
  let replySan: string | null = null;
  let replyCaptured: string | null = null;
  let replyTargetSquare: string | null = null;
  let mateAgainst: number | null = null;
  const replyLine = after?.lines[0];
  if (after && replyLine && !after.terminal) {
    const reply = replyLine.pv[0];
    if (reply) {
      const c = new Chess(move.fenAfter);
      const rm = tryUci(c, reply);
      if (rm) {
        replySan = rm.san;
        replyCaptured = rm.captured ?? null;
        replyTargetSquare = rm.to;
      }
    }
    if (replyLine.mate !== null && replyLine.mate !== 0 && (color === "w" ? replyLine.mate < 0 : replyLine.mate > 0)) {
      mateAgainst = Math.abs(replyLine.mate);
    }
  }

  let netAfterReply = 0;
  if (replySan && after?.lines[0]?.pv[0]) {
    const c = new Chess(move.fenAfter);
    if (tryUci(c, after.lines[0].pv[0])) netAfterReply = balance(c, color) - balance(beforeChess, color);
  }
  const isRecapture = !!(ctx.prev && ctx.prev.captured && ctx.prev.to === move.to && move.captured);

  const hangingAfter = threatenedPieces(afterChess, color);
  const hangingBefore = threatenedPieces(beforeChess, color);
  const movedPieceHangs = hangingAfter.some((h) => h.square === move.to);
  const oppThreatenedAfter = threatenedPieces(afterChess, enemy);
  const oppThreatenedBefore = threatenedPieces(beforeChess, enemy);

  const stateBefore = stateOf(ctx.wrBest);
  const stateAfter = stateOf(ctx.wrAfter);
  const afterPhrase = STATE_PHRASE[stateAfter];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const balAfterSettled = (() => {
    // material balance change (mover POV) of the move itself
    return balance(afterChess, color) - balance(beforeChess, color);
  })();

  // =====================================================================
  switch (cls) {
    case "brilliant": {
      const sacrificed = capturedName
        ? `{S} gave up {P} ${movedName} for ${article(capturedName)}`
        : `{S} sacrificed {P} ${movedName}`;
      return `Brilliant! ${sacrificed} with ${move.san}. It looks like a loss of material, but the engine confirms the sacrifice is sound and the position remains ${afterPhrase}. Ideas like this are very hard to find.`;
    }

    case "great": {
      let purpose = "keep the balance";
      if (ctx.wrBest >= 0.7) purpose = "keep {P} decisive advantage";
      else if (ctx.wrSecond !== null && ctx.wrSecond < 0.3 && ctx.wrBest >= 0.35) purpose = "save the game";
      else if (ctx.wrBest < 0.35) purpose = "stay in the game";
      const drop = ctx.wrSecond !== null ? ` Every other move drops {P} winning chances by at least ${pct(ctx.wrBest - ctx.wrSecond)}.` : "";
      const extra = isCheck ? " It also comes with check." : "";
      return `Great move! ${move.san} was the only good move in the position – the one move that lets {S} ${purpose}.${drop}${extra}`;
    }

    case "best": {
      if (before.legalMoves === 1) return `${move.san} was the only legal move.`;
      if (isMate) return `Checkmate! ${move.san} ends the game.`;
      if (move.flags.includes("p")) return `${move.san} promotes the pawn to ${article(PIECE_NAME[move.promotion ?? "q"])} – the strongest continuation.`;
      if (bestMateForMover && bestMateForMover > 0) {
        return `${move.san} is the best move and keeps a forced mate in ${bestMateForMover} on the board.`;
      }
      if (capturedName && isRecapture) {
        return `${move.san} is the best move – it recaptures the ${capturedName}, restoring the material balance.`;
      }
      if (capturedName) {
        const defended = afterChess.attackers(move.to as Square, enemy).length > 0;
        const wins = !defended || PIECE_VALUE[move.captured ?? "p"] >= PIECE_VALUE[move.piece];
        if (wins && balAfterSettled >= 1) {
          return `${move.san} is the best move – it wins ${article(capturedName)}${defended ? " and the exchange favors {S}" : " for free"}.${stateAfter === "winning" || stateAfter === "better" ? ` {S} now have ${afterPhrase}.` : ""}`;
        }
        return `${move.san} is the best move. Capturing the ${capturedName} is the most accurate way to keep ${afterPhrase}.`;
      }
      if (hangingBefore.length > 0 && hangingAfter.length < hangingBefore.length) {
        const saved = hangingBefore.find((h) => !hangingAfter.some((a) => a.square === h.square) || h.square === move.from);
        if (saved) {
          return saved.square === move.from
            ? `${move.san} is the best move – it moves the ${PIECE_NAME[saved.type]} out of danger while keeping ${afterPhrase}.`
            : `${move.san} is the best move – it defends the ${PIECE_NAME[saved.type]} that was under attack.`;
        }
      }
      const newThreats = oppThreatenedAfter.filter((t) => !oppThreatenedBefore.some((b) => b.square === t.square));
      if (newThreats.length >= 2) {
        return `${move.san} is the best move – it creates a double attack on ${newThreats.map((t) => `the ${PIECE_NAME[t.type]}`).join(" and ")}.`;
      }
      if (newThreats.length === 1) {
        return `${move.san} is the best move – it attacks {Op} ${PIECE_NAME[newThreats[0].type]} and keeps the initiative.`;
      }
      if (isCastle) return `${move.san} is the best move. Castling tucks the king to safety and brings the rook into the game.`;
      if (isCheck) return `${move.san} is the best move – a useful check that keeps ${afterPhrase}.`;
      return `${move.san} is the best move in this position and keeps ${afterPhrase}.`;
    }

    case "excellent":
      return `${move.san} is an excellent move – only a hair less precise than ${bestSan ?? "the engine's choice"}.${movedPieceHangs ? "" : ` The position remains ${STATE_PHRASE[stateAfter]}.`}`;

    case "good": {
      const note = bestCaptured && PIECE_VALUE[bestCaptured] >= 3 ? ` ({S} could have picked up ${article(PIECE_NAME[bestCaptured])} with ${bestSan}.)` : "";
      return `${move.san} is a solid, playable move, though ${bestSan ?? "the top engine move"} was a little more accurate.${note}`;
    }

    default:
      break;
  }

  // ---------------- inaccuracy / mistake / blunder ----------------
  const headline = cls === "inaccuracy" ? "Inaccuracy." : cls === "mistake" ? "Mistake." : "Blunder.";
  const bits: string[] = [];

  if (ctx.mitigated) {
    bits.push(
      `${move.san} gives up some material, but {P} advantage is so large that the game is still completely winning, so the practical damage is small.`,
    );
  }

  if (mateAgainst !== null) {
    bits.push(`This allows a forced mate in ${mateAgainst}${replySan ? `, starting with ${replySan}` : ""}.`);
  } else if (bestMateForMover !== null && bestMateForMover > 0) {
    bits.push(`{S} missed a forced mate in ${bestMateForMover} with ${bestSan}.`);
  } else if (replyCaptured && replyTargetSquare && netAfterReply <= -1) {
    const lost = PIECE_NAME[replyCaptured];
    bits.push(
      movedPieceHangs && replyTargetSquare === move.to && !capturedName
        ? `{S} left {P} ${movedName} hanging – ${replySan} wins it.`
        : `This allows ${replySan}, winning {P} ${lost}.`,
    );
  } else if (bestCaptured && PIECE_VALUE[bestCaptured] >= 3 && !capturedName) {
    bits.push(`{S} overlooked an opportunity to win ${article(PIECE_NAME[bestCaptured])} with ${bestSan}.`);
  } else if (bestIsCheck && bestSan && ctx.wrBest >= 0.6 && stateBefore !== stateAfter) {
    bits.push(`{S} missed a strong tactical shot: ${bestSan}.`);
  } else if (hangingBefore.length > 0 && hangingAfter.some((h) => hangingBefore.some((b) => b.square === h.square))) {
    const h = hangingAfter[0];
    bits.push(`{S} ignored the threat against {P} ${PIECE_NAME[h.type]}.`);
  }

  if (stateBefore !== stateAfter) {
    if (stateBefore === "winning" || stateBefore === "better") {
      bits.push(`{S} let a ${stateBefore === "winning" ? "winning" : "promising"} position slip to ${afterPhrase}.`);
    } else if (stateBefore === "equal") {
      bits.push(`This turns a balanced position into ${afterPhrase}.`);
    } else {
      bits.push(`The position goes from ${STATE_PHRASE[stateBefore]} to ${afterPhrase}.`);
    }
  } else if (bits.length === 0) {
    bits.push(`${move.san} gives away part of {P} advantage (win probability ${pct(ctx.wrBest)} → ${pct(ctx.wrAfter)}).`);
  }

  if (bestSan) bits.push(`The best move was ${bestSan}.`);
  return `${headline} ${bits.join(" ")}`;
}
