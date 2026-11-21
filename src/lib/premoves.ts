import { Chess, type Square } from "chess.js";

export const MAX_PREMOVE_QUEUE = 5;

export interface Premove {
  from: string;
  to: string;
  promotion?: "q" | "r" | "b" | "n";
  /** A capture-intent premove must still take an enemy piece when our turn arrives. */
  capture?: boolean;
}
export interface ResolvedPremove extends Premove { san: string; uci: string; fenAfter: string; }
const SQUARE_PATTERN = /^[a-h][1-8]$/;

export function isChessSquare(value: unknown): value is Square {
  return typeof value === "string" && SQUARE_PATTERN.test(value);
}
export function isPremoveShape(value: unknown): value is Premove {
  if (typeof value !== "object" || value === null) return false;
  const move = value as Partial<Premove>;
  return isChessSquare(move.from) && isChessSquare(move.to) && move.from !== move.to
    && (move.promotion === undefined || ["q", "r", "b", "n"].includes(move.promotion))
    && (move.capture === undefined || typeof move.capture === "boolean");
}
export function sanitizePremove(value: unknown): Premove | null {
  if (!isPremoveShape(value)) return null;
  return {
    from: value.from,
    to: value.to,
    ...(value.promotion ? { promotion: value.promotion } : {}),
    ...(value.capture ? { capture: true } : {}),
  };
}
export function samePremove(a: Premove | null | undefined, b: Premove | null | undefined): boolean {
  return !!a && !!b && a.from === b.from && a.to === b.to
    && (a.promotion ?? "q") === (b.promotion ?? "q")
    && !!a.capture === !!b.capture;
}

/** Computes next-turn destinations on a copy; the live board and en-passant target stay untouched. */
export function getPremoveMoves(fen: string, color: "w" | "b", from: string): Premove[] {
  if (!isChessSquare(from)) return [];
  try {
    const fields = fen.trim().split(/\s+/);
    if (fields.length !== 6) return [];
    const live = new Chess(fen);
    if (live.isGameOver()) return [];
    const piece = live.get(from);
    if (!piece || piece.color !== color) return [];
    fields[1] = color;
    fields[3] = "-";
    // After the player's last move, the opponent may currently be in check.
    // This is valid for a real turn but fails ordinary FEN validation once we project
    // our own next turn, so skip only constructor validation on the cloned position.
    const projected = new Chess(fields.join(" "), { skipValidation: true });
    return projected.moves({ square: from, verbose: true }).map((move) => ({
      from: move.from, to: move.to,
      ...(move.promotion ? { promotion: move.promotion as Premove["promotion"] } : {}),
    }));
  } catch { return []; }
}

/**
 * Squares this piece could capture on our next turn, including currently empty squares.
 * This is intentionally pseudo-legal: the authoritative position is checked again after
 * the opponent moves, so pins, checks, blockers and king safety are all revalidated then.
 */
export function getPremoveCaptureMoves(fen: string, color: "w" | "b", from: string): Premove[] {
  if (!isChessSquare(from)) return [];
  try {
    const fields = fen.trim().split(/\s+/);
    if (fields.length !== 6) return [];
    const live = new Chess(fen);
    if (live.isGameOver()) return [];
    const piece = live.get(from);
    if (!piece || piece.color !== color) return [];
    fields[1] = color;
    fields[3] = "-";
    const projected = new Chess(fields.join(" "), { skipValidation: true });
    const file = from.charCodeAt(0) - 97;
    const rank = Number(from[1]) - 1;
    const targets = new Map<string, Premove>();

    // Returns true when a ray must stop (off-board or occupied).
    const addTarget = (targetFile: number, targetRank: number): boolean => {
      if (targetFile < 0 || targetFile > 7 || targetRank < 0 || targetRank > 7) return true;
      const to = `${String.fromCharCode(97 + targetFile)}${targetRank + 1}` as Square;
      const occupant = projected.get(to);
      if (occupant) {
        if (occupant.color !== color && occupant.type !== "k") {
          targets.set(to, {
            from, to, capture: true,
            ...(piece.type === "p" && (targetRank === 0 || targetRank === 7) ? { promotion: "q" as const } : {}),
          });
        }
        return true;
      }
      targets.set(to, {
        from, to, capture: true,
        ...(piece.type === "p" && (targetRank === 0 || targetRank === 7) ? { promotion: "q" as const } : {}),
      });
      return false;
    };

    if (piece.type === "p") {
      const direction = color === "w" ? 1 : -1;
      addTarget(file - 1, rank + direction);
      addTarget(file + 1, rank + direction);
    } else if (piece.type === "n") {
      for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) {
        addTarget(file + df, rank + dr);
      }
    } else if (piece.type === "k") {
      for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
        if (df !== 0 || dr !== 0) addTarget(file + df, rank + dr);
      }
    } else {
      const directions: Array<[number, number]> = [];
      if (piece.type === "b" || piece.type === "q") directions.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
      if (piece.type === "r" || piece.type === "q") directions.push([1, 0], [-1, 0], [0, 1], [0, -1]);
      for (const [df, dr] of directions) {
        for (let step = 1; step < 8; step++) {
          if (addTarget(file + df * step, rank + dr * step)) break;
        }
      }
    }
    return Array.from(targets.values());
  } catch { return []; }
}

export function canSetPremove(fen: string, color: "w" | "b", from: string, to: string): boolean {
  return getPremoveMoves(fen, color, from).some((move) => move.to === to);
}
export function createPremove(
  fen: string,
  color: "w" | "b",
  from: string,
  to: string,
  promotion: "q" | "r" | "b" | "n" = "q",
): Premove | null {
  if (!isChessSquare(from) || !isChessSquare(to) || from === to) return null;
  const candidate = getPremoveMoves(fen, color, from).find((move) => move.to === to);
  if (!candidate) return null;
  return { from, to, ...(candidate.promotion ? { promotion } : {}) };
}
export function createCapturePremove(
  fen: string,
  color: "w" | "b",
  from: string,
  to: string,
  promotion: "q" | "r" | "b" | "n" = "q",
): Premove | null {
  if (!isChessSquare(from) || !isChessSquare(to) || from === to) return null;
  const candidate = getPremoveCaptureMoves(fen, color, from).find((move) => move.to === to);
  if (!candidate) return null;
  return { from, to, capture: true, ...(candidate.promotion ? { promotion } : {}) };
}
/**
 * Projects the live opponent-to-move position to the player's next turn.
 * En-passant is cleared because the opponent will have moved before execution.
 */
export function projectPremoveTurn(fen: string, color: "w" | "b"): string | null {
  try {
    const live = new Chess(fen);
    if (live.isGameOver() || live.turn() === color) return null;
    const fields = fen.trim().split(/\\s+/);
    if (fields.length !== 6) return null;
    fields[1] = color;
    fields[3] = "-";
    return new Chess(fields.join(" "), { skipValidation: true }).fen();
  } catch {
    return null;
  }
}

export interface PremoveQueueProjection {
  fen: string;
  projectedCount: number;
  canAppend: boolean;
}

/**
 * Builds a planning position for multiple premoves. Opponent replies are
 * skipped between planned moves, but each move is revalidated on the actual
 * position before it is ever played. Empty-square capture premoves end preview.
 */
export function projectPremoveQueue(
  fen: string,
  color: "w" | "b",
  premoves: readonly Premove[],
): PremoveQueueProjection {
  const startingFen = projectPremoveTurn(fen, color);
  if (!startingFen) return { fen, projectedCount: 0, canAppend: false };

  let projectedFen = startingFen;
  let projectedCount = 0;
  let gameFinished = false;
  for (const raw of premoves.slice(0, MAX_PREMOVE_QUEUE)) {
    const premove = sanitizePremove(raw);
    if (!premove) break;
    try {
      const chess = new Chess(projectedFen, { skipValidation: true });
      if (chess.turn() !== color || chess.isGameOver()) break;
      if (premove.capture) {
        const target = chess.get(premove.to as Square);
        if (!target || target.color === color || target.type === "k") break;
      }
      const moved = chess.move({
        from: premove.from as Square,
        to: premove.to as Square,
        ...(premove.promotion ? { promotion: premove.promotion } : {}),
      });
      if (!moved) break;
      projectedCount += 1;
      if (chess.isGameOver()) {
        projectedFen = chess.fen();
        gameFinished = true;
        break;
      }
      const fields = chess.fen().split(/\\s+/);
      fields[1] = color;
      fields[3] = "-";
      projectedFen = new Chess(fields.join(" "), { skipValidation: true }).fen();
    } catch {
      break;
    }
  }

  return {
    fen: projectedFen,
    projectedCount,
    canAppend: !gameFinished && projectedCount === premoves.length && premoves.length < MAX_PREMOVE_QUEUE,
  };
}

/** Re-checks legality only after the opponent's real move has arrived. */
export function resolvePremove(fen: string, color: "w" | "b", premove: Premove): ResolvedPremove | null {
  if (!isPremoveShape(premove)) return null;
  try {
    const chess = new Chess(fen);
    if (chess.isGameOver() || chess.turn() !== color) return null;
    const piece = chess.get(premove.from as Square);
    if (!piece || piece.color !== color) return null;
    if (premove.capture) {
      const target = chess.get(premove.to as Square);
      if (target) {
        if (target.color === color || target.type === "k") return null;
      } else {
        // En passant is the only legal capture whose destination square is empty.
        const enPassant = chess.moves({ square: premove.from as Square, verbose: true })
          .some((move) => move.to === premove.to && move.flags.includes("e"));
        if (!enPassant) return null;
      }
    }
    const result = chess.move({
      from: premove.from as Square, to: premove.to as Square,
      ...(premove.promotion ? { promotion: premove.promotion } : {}),
    });
    if (!result) return null;
    return { ...premove, san: result.san, uci: result.from + result.to + (result.promotion ?? ""), fenAfter: chess.fen() };
  } catch { return null; }
}
export function premoveToUci(premove: Premove): string {
  return premove.from + premove.to + (premove.promotion ?? "");
}
export function formatPremove(premove: Premove): string {
  return `${premove.from} → ${premove.to}${premove.capture ? " ×" : ""}${premove.promotion ? `=${premove.promotion.toUpperCase()}` : ""}`;
}
export function premoveClockPenaltyMs(enabled: boolean): number { return enabled ? 100 : 0; }
export function isPremoveForTurn(fen: string, color: "w" | "b"): boolean {
  try { const chess = new Chess(fen); return !chess.isGameOver() && chess.turn() !== color; }
  catch { return false; }
}
