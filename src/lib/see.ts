/**
 * Статический размен (SEE-подобный квиесценс-поиск по взятиям) для определения жертв,
 * а также вспомогательные детекторы тактики (вилка, висящая фигура) для тренера.
 *
 * Улучшения (см. ниже):
 *  - qsearch теперь корректно распознаёт мат (раньше возвращал stand-pat в матовой позиции);
 *  - detectSacrifice, помимо чистой SEE-потери, проверяет «висит ли фигура после взятия» —
 *    это ловит «взял-и-отдал» жертвы (типа Nxh7), которые qsearch может недооценить
 *    из-за тактической компенсации;
 *  - порог SACRIFICE_MIN_LOSS снижен с 200 до 150 сп (настраивается).
 */
import { Chess, type Square } from "chess.js";

const VAL: Record<string, number> = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 };
const MATE = 100_000;
const MAX_QDEPTH = 8;
/** Минимальная чистая потеря материала (сп), при которой ход считается жертвой (для среднего рейтинга). */
const SACRIFICE_MIN_LOSS = 150;

/**
 * Chess.com: «мы щедрее в определении жертвы фигуры для новичков, чем для сильных игроков».
 * Для слабых игроков порог ниже. Точные значения Chess.com не публикует — это приближение.
 */
export function sacrificeMinLoss(elo?: number): number {
  if (elo === undefined || !Number.isFinite(elo)) return SACRIFICE_MIN_LOSS;
  if (elo < 1000) return 125;
  if (elo < 1800) return SACRIFICE_MIN_LOSS;
  return 175;
}

function swapTurnFen(fen: string): string {
  const p = fen.split(" ");
  p[1] = p[1] === "w" ? "b" : "w";
  p[3] = "-";
  return p.join(" ");
}

/**
 * Сколько материала соперник выиграл бы взятиями, если бы мы просто «пропустили ход».
 * Если наша фигура уже висела ДО хода, то потеря её после любого хода — не жертва.
 * При шахе пропуск хода невозможен — возвращаем 0.
 */
function passThreat(fenBefore: string): number {
  try {
    if (new Chess(fenBefore).isCheck()) return 0;
    return hangingLoss(swapTurnFen(fenBefore));
  } catch {
    return 0;
  }
}

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

/**
 * Quiescence search — перебор взятий до затишья.
 * Корректно обрабатывает мат: если сторона на ходу получила мат, возвращает -MATE + ε,
 * где ε тем меньше, чем ближе к корню найден мат (форсированный мат предпочтительнее).
 */
function qsearch(chess: Chess, alpha: number, beta: number, depth: number): number {
  // Мат — приоритет над любой материальной оценкой.
  if (chess.isCheckmate()) {
    return -MATE + (MAX_QDEPTH - depth) * 100;
  }

  const stand = staticBalance(chess);
  if (depth <= 0) return stand;
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;

  // Только взятия и превращения — как и раньше. Полный перебор защит от шаха
  // сделал бы qsearch недопустимо медленным; детектор «висящей фигуры» ниже
  // компенсирует этот пробел.
  const caps = chess
    .moves({ verbose: true })
    .filter((m) => m.captured || m.promotion)
    .sort(
      (a, b) =>
        (VAL[b.captured ?? "p"] ?? 0) * 10 - VAL[b.piece] -
        ((VAL[a.captured ?? "p"] ?? 0) * 10 - VAL[a.piece])
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
    return qsearch(new Chess(fen), -MATE * 2, MATE * 2, MAX_QDEPTH);
  } catch {
    return 0;
  }
}

/**
 * Насколько соперник (чей ход) выиграет материал серией взятий сверх текущего баланса.
 * Верхняя граница 2000 сп: если у соперника мат, нам всё равно не нужна гигантская цифра
 * в комментарии «висит 100000 сп материала».
 */
export function hangingLoss(fenAfter: string): number {
  try {
    const chess = new Chess(fenAfter);
    const diff = qsearch(chess, -MATE * 2, MATE * 2, MAX_QDEPTH) - staticBalance(chess);
    return Math.max(0, Math.min(diff, 2000));
  } catch {
    return 0;
  }
}

export interface SacrificeInfo {
  sacrifice: boolean;
  amount: number; // сантипешки (100 = пешка)
  pieceType: string;
}

/**
 * Эвристика «фигура висит после взятия».
 * Возвращает { sacrifice, amount }, если ход — взятие не-пешкой, которое ставит фигуру
 * на поле, где соперник может её забрать с чистой материальной выгодой.
 *
 * Именно этот детектор ловит Nxh7: формально ход выигрывает пешку (SEE не видит потери),
 * но конь на h7 висит и будет съеден, а компенсация — матовая атака — qsearch
 * без шахов не видит.
 */
function computeHangingLoss(
  chessAfterMove: Chess,
  mv: { piece: string; to: string; captured?: string; color: "w" | "b" },
  minLoss: number
): { sacrifice: boolean; amount: number } {
  const none = { sacrifice: false, amount: 0 };

  // Пешки и король — не «жертва фигуры» в нашем понимании.
  if (mv.piece === "p" || mv.piece === "k") return none;

  const movedValue = VAL[mv.piece] || 0;
  const capturedValue = mv.captured ? VAL[mv.captured] || 0 : 0;
  const netLoss = movedValue - capturedValue;
  if (netLoss < minLoss) return none;

  // Сейчас ход соперника — ищем его взятия на наше поле.
  const capturesOnSquare = chessAfterMove.moves({ verbose: true }).filter((m) => m.to === mv.to);
  if (capturesOnSquare.length === 0) return none;

  // Атаковано ли наше поле нашими же фигурами (то есть защищено ли оно нами)?
  const defendedByUs = chessAfterMove.isAttacked(mv.to as Square, mv.color);

  // Самый дешёвый атакующий — если он дешевле нашей фигуры, обмен невыгоден нам
  // (даже если поле защищено: соперник получает фигуру за меньшую).
  const cheapestAttackerValue = capturesOnSquare.reduce(
    (min, m) => Math.min(min, VAL[m.piece] || 0),
    Infinity
  );

  // Висящая фигура — это чистая потеря:
  //  - либо поле не защищено нами;
  //  - либо соперник бьёт более дешёвой фигурой.
  const clearlyLosing = !defendedByUs || cheapestAttackerValue < movedValue;
  if (!clearlyLosing) return none;

  // Если мы взяли сопоставимую по стоимости фигуру — это размен, а не жертва
  // (Qxd5 при ферзях, Rxd5 при ладьях). Требуем, чтобы захваченное было
  // меньше половины стоимости нашей фигуры.
  if (capturedValue * 2 >= movedValue) return none;

  return { sacrifice: true, amount: netLoss };
}

/**
 * Является ли ход жертвой материала.
 *
 * Комбинируются два сигнала:
 *   1) qsearch-оценка (чистая материальная потеря после всех взятий, включая мат);
 *   2) «висящая фигура после взятия» — ловит тактические жертвы, которые qsearch
 *      без шахов недооценивает.
 *
 * Ход считается жертвой, если сработал ХОТЯ БЫ ОДИН из сигналов. Это осознанно
 * щедрее классического SEE: классификация «brilliant» в analyze.ts всё равно
 * дополнительно фильтруется по winAfter / refCp, поэтому здесь допустимо ловить
 * больше кандидатов, а окончательное решение принимает вызывающий код.
 */
export function detectSacrifice(fenBefore: string, uci: string, elo?: number): SacrificeInfo {
  const none: SacrificeInfo = { sacrifice: false, amount: 0, pieceType: "" };
  const minLoss = sacrificeMinLoss(elo);
  try {
    const chess = new Chess(fenBefore);
    const baseline = staticBalance(chess);
    const mv = chess.move({
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square,
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    if (!mv) return none;
    // Мат собственным ходом — не жертва.
    if (chess.isCheckmate()) return none;
    // Превращение — не жертва в нашем смысле.
    if (mv.promotion) return none;
    // Chess.com: Brilliant — это жертва ФИГУРЫ. Ходы пешками жертвой не считаем.
    if (mv.piece === "p") return none;

    // Сигнал 1: чистая потеря материала по qsearch.
    const after = -qsearch(chess, -MATE * 2, MATE * 2, MAX_QDEPTH);
    // Вычитаем угрозу, которая висела ещё до хода: уже висевшая фигура — не наша жертва.
    const lost = baseline - after - passThreat(fenBefore);

    // Сигнал 2: фигура висит после взятия.
    const hanging = computeHangingLoss(chess, {
      piece: mv.piece,
      to: mv.to,
      captured: mv.captured,
      color: mv.color,
    }, minLoss);

    if (lost >= minLoss || hanging.sacrifice) {
      return {
        sacrifice: true,
        amount: Math.max(lost, hanging.amount),
        pieceType: mv.piece,
      };
    }
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