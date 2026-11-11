import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";

export const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const PIECE_NAME: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

export const opposite = (c: Color): Color => (c === "w" ? "b" : "w");

export function material(chess: Chess, color: Color): number {
  let total = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (sq && sq.color === color) total += PIECE_VALUE[sq.type];
    }
  }
  return total;
}

export function balance(chess: Chess, color: Color): number {
  return material(chess, color) - material(chess, opposite(color));
}

export interface PieceOnSquare {
  square: Square;
  type: PieceSymbol;
}

/** Pieces of `color` that are en prise: attacked and either undefended or attacked by a cheaper piece. */
export function threatenedPieces(chess: Chess, color: Color): PieceOnSquare[] {
  const out: PieceOnSquare[] = [];
  const enemy = opposite(color);
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== color || sq.type === "k") continue;
      const attackers = chess.attackers(sq.square, enemy);
      if (attackers.length === 0) continue;
      const defenders = chess.attackers(sq.square, color).filter((s) => s !== sq.square);
      let cheapest = 100;
      for (const a of attackers) {
        const p = chess.get(a);
        if (p) cheapest = Math.min(cheapest, p.type === "k" ? 100 : PIECE_VALUE[p.type]);
      }
      if (defenders.length === 0 || cheapest < PIECE_VALUE[sq.type]) {
        out.push({ square: sq.square, type: sq.type });
      }
    }
  }
  return out;
}

export function tryUci(chess: Chess, uci: string) {
  try {
    return chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
  } catch {
    return null;
  }
}

export function uciToSan(fen: string, uci: string | null | undefined): string | null {
  if (!uci) return null;
  const chess = new Chess(fen);
  const m = tryUci(chess, uci);
  return m ? m.san : null;
}

/** Convert a UCI principal variation to SAN (with move numbers), starting from `fen`. */
export function pvToSan(fen: string, pv: string[], max = 8): string {
  const chess = new Chess(fen);
  const parts: string[] = [];
  const startsBlack = fen.split(" ")[1] === "b";
  let moveNo = parseInt(fen.split(" ")[5] || "1", 10) || 1;
  let black = startsBlack;
  for (let i = 0; i < Math.min(pv.length, max); i++) {
    const m = tryUci(chess, pv[i]);
    if (!m) break;
    if (!black) parts.push(`${moveNo}.${m.san}`);
    else if (i === 0) parts.push(`${moveNo}...${m.san}`);
    else parts.push(m.san);
    if (black) moveNo++;
    black = !black;
  }
  return parts.join(" ");
}
