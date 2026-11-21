import { Chess, type Square } from "chess.js";

export interface SacrificeMoveSnapshot {
  color: "w" | "b";
  piece: string;
  from: string;
  to: string;
  fenBefore: string;
  fenAfter: string;
}

export interface PersistentSacrificeContinuation {
  originIndex: number;
  square: string;
  pieceType: string;
}

function opposite(color: "w" | "b"): "w" | "b" {
  return color === "w" ? "b" : "w";
}

function pieceStillOnSquare(
  fen: string,
  square: string,
  color: "w" | "b",
  pieceType: string,
): boolean {
  const piece = new Chess(fen).get(square as Square);
  return !!piece && piece.color === color && piece.type === pieceType;
}

/**
 * Checks whether the opponent has a legal capture on the offered piece.
 * The FEN may have either side to move, so we temporarily set the opponent
 * to move. En-passant is cleared because the offered non-pawn piece cannot
 * be captured en-passant and stale EP rights would invalidate the probe.
 */
function opponentCanCapture(
  fen: string,
  square: string,
  owner: "w" | "b",
): boolean {
  try {
    const fields = fen.split(" ");
    fields[1] = opposite(owner);
    fields[3] = "-";
    const position = new Chess(fields.join(" "));
    return position.moves({ verbose: true }).some(
      (move) => move.to === square && !!move.captured,
    );
  } catch {
    return false;
  }
}

/**
 * Finds a still-live piece offer from an earlier move by the current player.
 *
 * A continuation is accepted only when:
 * - the original move was independently identified as a sound, near-best
 *   piece sacrifice by the engine (soundOffers[originIndex]);
 * - the destination square was not capturable before the offer, but was
 *   legally capturable immediately after it;
 * - the opponent declined the capture and the same piece remained legally
 *   capturable after every intervening move, including the current move.
 *
 * This allows a best/nearly-best pawn/quiet move to inherit the tactical
 * context of a declined piece sacrifice without treating every hanging
 * piece as a Brilliant continuation.
 */
export function findPersistentSacrificeContinuation(
  moves: readonly SacrificeMoveSnapshot[],
  currentIndex: number,
  soundOffers: readonly boolean[],
): PersistentSacrificeContinuation | null {
  const current = moves[currentIndex];
  if (!current || currentIndex < 2) return null;

  const owner = current.color;
  for (let originIndex = currentIndex - 2; originIndex >= 0; originIndex -= 2) {
    const offer = moves[originIndex];
    if (
      !offer ||
      !soundOffers[originIndex] ||
      offer.color !== owner ||
      offer.piece === "p" ||
      offer.piece === "k"
    ) continue;

    const square = offer.to;
    try {
      const before = new Chess(offer.fenBefore);
      const movingPiece = before.get(offer.from as Square);
      if (!movingPiece || movingPiece.color !== owner || movingPiece.type !== offer.piece) continue;

      // The offer must create the capture opportunity, not merely preserve an
      // unrelated piece that was already hanging before the move.
      if (opponentCanCapture(offer.fenBefore, square, owner)) continue;
      if (!pieceStillOnSquare(offer.fenAfter, square, owner, offer.piece)) continue;
      if (!opponentCanCapture(offer.fenAfter, square, owner)) continue;

      let persists = true;
      for (let stepIndex = originIndex + 1; stepIndex <= currentIndex; stepIndex++) {
        const step = moves[stepIndex];
        if (!step) {
          persists = false;
          break;
        }
        // Once the offered piece moves, the original sacrifice offer is over.
        if (step.color === owner && step.from === square) {
          persists = false;
          break;
        }
        if (!pieceStillOnSquare(step.fenAfter, square, owner, offer.piece)) {
          persists = false;
          break;
        }
        // The opponent must still be able to take the piece after every reply
        // and after the current continuation move.
        if (!opponentCanCapture(step.fenAfter, square, owner)) {
          persists = false;
          break;
        }
      }

      if (persists) {
        return { originIndex, square, pieceType: offer.piece };
      }
    } catch {
      // Malformed FEN or an invalid historical move: ignore this candidate.
    }
  }

  return null;
}
