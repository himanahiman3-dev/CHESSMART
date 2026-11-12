/**
 * Статический размен (SEE-подобный квиесценс-поиск по взятиям) для определения жертв,
 * а также вспомогательные детекторы тактики (вилка, висящая фигура) для тренера.
 */
import { Chess, type Square } from "chess.js";

const VAL: Record<string, number> = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 };
const MAX_QDEPTH = 8;

function material(chess: Chess, color: "w" | "b"): number {
  let sum = 0;
  for (const row of chess.board())
    for (const cell of row) if (cell && cell.color === color) sum += VAL[cell.type];
  return sum;
}

/** Баланс материала с точки зрения стороны, которая ходит. */
function staticBalance(chess: Chess): number {
  const me = chess.turn();
  return material(chess, me) - material(chess, me === "w" ? "b" : "w");
}

function qsearch(chess: Chess, alpha: number, beta: number, depth: number): number {
  const stand = staticBalance(chess);
  if (depth <= 0) return stand;
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  const caps = chess
    .moves({ verbose: true })
    .filter((m) => m.captured || m.promotion)
    .sort(
      (a, b) =>
        (VAL[b.captured ?? "p"] ?? 0) * 10 - VAL[b.piece] - ((VAL[a.captured ?? "p"] ?? 0) * 10 - VAL[a.piece])
    );
  for (const m of caps) {
    chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    const score = -qsearch(chess, -beta, -alpha, depth - 1);
    chess.undo();
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

/** Материальный итог после серии взятий (с точки зрения стороны на ходу). */
export function qBalance(fen: string): number {
  try {
    return qsearch(new Chess(fen), -100000, 100000, MAX_QDEPTH);
  } catch {
    return 0;
  }
}

/** Насколько соперник (чей ход) выиграет материал серией взятий сверх текущего баланса. */
export function hangingLoss(fenAfter: string): number {
  try {
    const chess = new Chess(fenAfter);
    return Math.max(0, qsearch(chess, -100000, 100000, MAX_QDEPTH) - staticBalance(chess));
  } catch {
    return 0;
  }
}

export interface SacrificeInfo {
  sacrifice: boolean;
  amount: number; // сантипешки (100 = пешка)
  pieceType: string;
}

/** Является ли ход жертвой материала (по сравнению с лучшим исходом разменов до хода). */
export function detectSacrifice(fenBefore: string, uci: string): SacrificeInfo {
  const none: SacrificeInfo = { sacrifice: false, amount: 0, pieceType: "" };
  try {
    const chess = new Chess(fenBefore);
    const baseline = staticBalance(chess); // материал ходящего до хода (без «разменов в уме»)
    const mv = chess.move({
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square,
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    if (!mv) return none;
    if (chess.isCheckmate()) return none;
    const after = -qsearch(chess, -100000, 100000, MAX_QDEPTH);
    const lost = baseline - after;
    // жертва — потеря минимум ~фигуры за пешку; рокировки/превращения не считаем
    if (lost >= 200 && !mv.promotion) return { sacrifice: true, amount: lost, pieceType: mv.piece };
    return { ...none, amount: Math.max(0, lost) };
  } catch {
    return none;
  }
}

export interface ReplyInfo {
  san: string;
  piece: string;
  captured?: string;
  isCheck: boolean;
  isMate: boolean;
  promotion: boolean;
  forkTargets: string[]; // типы фигур, атакованных вилкой
  fenAfter: string;
}

function swapTurn(fen: string): string {
  const p = fen.split(" ");
  p[1] = p[1] === "w" ? "b" : "w";
  p[3] = "-";
  return p.join(" ");
}

/** Что делает ответ соперника в позиции fen (ход играет сторона, чья очередь в fen). */
export function describeReply(fen: string, uci: string): ReplyInfo | null {
  try {
    const chess = new Chess(fen);
    const mv = chess.move({
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square,
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    if (!mv) return null;
    const fenAfter = chess.fen();
    const forkTargets: string[] = [];
    // Вилка: ходившая фигура атакует >=2 ценные цели (в т.ч. шах) в новой позиции
    try {
      const hypo = new Chess(swapTurn(fenAfter));
      const attacks = hypo
        .moves({ square: mv.to as Square, verbose: true })
        .filter((m) => m.captured && m.captured !== "p");
      const forkerVal = VAL[mv.piece] || 0;
      const defenderColor = mv.color === "w" ? "b" : "w";
      const valuable = attacks.filter((m) => {
        const tv = VAL[m.captured!] || 0;
        const defended = chess.isAttacked(m.to as Square, defenderColor);
        return tv > forkerVal || !defended;
      });
      for (const m of valuable) forkTargets.push(m.captured!);
      if (chess.isCheck() && mv.piece !== "k") forkTargets.push("k");
    } catch {
      /* некорректная гипотетическая позиция */
    }
    const uniqueTargets = forkTargets.length >= 2 ? forkTargets : [];
    return {
      san: mv.san,
      piece: mv.piece,
      captured: mv.captured,
      isCheck: chess.isCheck(),
      isMate: chess.isCheckmate(),
      promotion: !!mv.promotion,
      forkTargets: uniqueTargets,
      fenAfter,
    };
  } catch {
    return null;
  }
}

export function pieceValueCp(type: string): number {
  return VAL[type] ?? 0;
}
