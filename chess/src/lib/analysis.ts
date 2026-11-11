import { Chess, type Move } from "chess.js";
import type { Engine } from "./engine";
import { clean, type Book } from "./book";

export type Cat =
  | "brilliant"
  | "best"
  | "excellent"
  | "good"
  | "book"
  | "inaccuracy"
  | "mistake"
  | "blunder";

export const CAT_ORDER: Cat[] = [
  "brilliant",
  "best",
  "excellent",
  "good",
  "book",
  "inaccuracy",
  "mistake",
  "blunder",
];

export const CAT_LABEL: Record<Cat, string> = {
  brilliant: "Блестящий ход",
  best: "Лучший ход",
  excellent: "Отличный ход",
  good: "Хороший ход",
  book: "Дебютный ход",
  inaccuracy: "Неточность",
  mistake: "Ошибка",
  blunder: "Зевок",
};

export const CAT_LABEL_PLURAL: Record<Cat, string> = {
  brilliant: "Блестящие",
  best: "Лучшие",
  excellent: "Отличные",
  good: "Хорошие",
  book: "Дебютные",
  inaccuracy: "Неточности",
  mistake: "Ошибки",
  blunder: "Зевки",
};

export const CAT_COLOR: Record<Cat, string> = {
  brilliant: "#1baca6",
  best: "#81b64c",
  excellent: "#96bc4b",
  good: "#8fa77a",
  book: "#a88865",
  inaccuracy: "#f7c631",
  mistake: "#e58f2a",
  blunder: "#ca3431",
};

export type Mode = "fast" | "deep";
export const MODE_BUDGET: Record<Mode, number> = { fast: 10_000, deep: 120_000 };
const MODE_MAX_MOVETIME: Record<Mode, number> = { fast: 700, deep: 4500 };

export interface PosEval {
  fen: string;
  /** оценка с точки зрения белых (мат = ±(10000-n)) */
  value: number;
  /** мат с точки зрения белых: >0 белые матуют */
  mate: number | null;
  best: string;
  pv: string[];
  depth: number;
}

export interface MoveInfo {
  ply: number;
  san: string;
  uci: string;
  color: "w" | "b";
  from: string;
  to: string;
  fenBefore: string;
  fenAfter: string;
  cat: Cat;
  loss: number;
  bestUci: string;
  bestSan: string;
  sacrifice: number;
  opening?: string;
}

export interface Review {
  headers: Record<string, string | null>;
  moves: MoveInfo[];
  positions: PosEval[];
  accuracy: { w: number; b: number };
  counts: { w: Record<Cat, number>; b: Record<Cat, number> };
  opening?: string;
  mode: Mode;
  elapsedMs: number;
}

export interface ProgressInfo {
  done: number;
  total: number;
  fen: string;
  index: number;
  value: number;
  mate: number | null;
  depth: number;
  elapsedMs: number;
}

const clamp = (v: number) => Math.max(-1500, Math.min(1500, v));
export const winPct = (cp: number) =>
  50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamp(cp))) - 1);

const VAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
function balance(fen: string, color: "w" | "b") {
  let w = 0;
  let b = 0;
  for (const ch of fen.split(" ")[0]) {
    const lower = ch.toLowerCase();
    const v = VAL[lower];
    if (v === undefined) continue;
    if (ch === lower) b += v;
    else w += v;
  }
  return color === "w" ? w - b : b - w;
}

/** Сколько материала сторона теряет «в пределах» основной линии движка после хода. */
function sacrificeAmount(m: Move, after: PosEval | undefined): number {
  if (!after) return 0;
  const m0 = balance(m.before, m.color);
  const c = new Chess(m.after);
  const pv = after.pv.slice(0, 4);
  const target = pv.length >= 4 ? 4 : pv.length >= 2 ? 2 : pv.length;
  for (let k = 0; k < target; k++) {
    const u = pv[k];
    try {
      c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    } catch {
      break;
    }
  }
  return m0 - balance(c.fen(), m.color);
}

export function parsePgn(text: string) {
  const c = new Chess();
  try {
    c.loadPgn(text.trim());
  } catch {
    throw new Error("Не удалось прочитать PGN. Проверьте, что вставлена вся партия.");
  }
  const moves = c.history({ verbose: true });
  if (moves.length < 1) throw new Error("В партии нет ходов.");
  return { headers: c.getHeaders() as Record<string, string | null>, moves };
}

function uciToSan(fen: string, uci: string): string {
  if (!uci) return "";
  try {
    const c = new Chess(fen);
    return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return uci;
  }
}

function terminalEval(fen: string): PosEval | null {
  const c = new Chess(fen);
  if (c.isCheckmate()) {
    const stm = c.turn();
    // сторона, которая ходит, получила мат
    return {
      fen,
      value: stm === "w" ? -10000 : 10000,
      mate: stm === "w" ? -0 : 0,
      best: "",
      pv: [],
      depth: 0,
    };
  }
  if (c.isStalemate() || c.isInsufficientMaterial()) {
    return { fen, value: 0, mate: null, best: "", pv: [], depth: 0 };
  }
  return null;
}

export async function analyzeGame(opts: {
  pgn: string;
  mode: Mode;
  engine: Engine;
  book: Book;
  onProgress: (p: ProgressInfo) => void;
  signal: { aborted: boolean };
}): Promise<Review> {
  const { mode, engine, book, onProgress, signal } = opts;
  const { headers, moves } = parsePgn(opts.pgn);
  const fens = [moves[0].before, ...moves.map((m) => m.after)];
  const total = fens.length;
  const budget = MODE_BUDGET[mode];
  const maxT = MODE_MAX_MOVETIME[mode];
  const t0 = performance.now();
  const positions: PosEval[] = [];

  engine.newGame();
  await engine.ready();

  for (let j = 0; j < total; j++) {
    if (signal.aborted) throw new Error("aborted");
    const fen = fens[j];
    const term = terminalEval(fen);
    let pe: PosEval;
    if (term) {
      pe = term;
    } else {
      const elapsed = performance.now() - t0;
      const remaining = Math.max(0, budget - elapsed);
      const per = Math.min(maxT, Math.max(40, remaining / (total - j)));
      const r = await engine.analyse(fen, per);
      const white = fen.split(" ")[1] === "w";
      pe = {
        fen,
        value: white ? r.value : -r.value,
        mate: r.mate === null ? null : white ? r.mate : -r.mate,
        best: r.best,
        pv: r.pv,
        depth: r.depth,
      };
    }
    positions.push(pe);
    onProgress({
      done: j + 1,
      total,
      fen,
      index: j,
      value: pe.value,
      mate: pe.mate,
      depth: pe.depth,
      elapsedMs: performance.now() - t0,
    });
  }

  // --- дебютная книга ---
  const sans = moves.map((m) => clean(m.san));
  const isStandardStart = moves[0].before.startsWith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w");
  const bookFlags: boolean[] = [];
  const openingNames: (string | undefined)[] = [];
  let inBook = isStandardStart;
  let key = "";
  let lastName: string | undefined;
  sans.forEach((s, i) => {
    key = key ? key + " " + s : s;
    const entry = inBook ? book.get(key) : undefined;
    if (!entry) inBook = false;
    bookFlags[i] = inBook;
    if (entry?.name) lastName = entry.name;
    openingNames[i] = inBook ? lastName : undefined;
  });

  // --- классификация ---
  const infos: MoveInfo[] = [];
  const counts = {
    w: Object.fromEntries(CAT_ORDER.map((c) => [c, 0])) as Record<Cat, number>,
    b: Object.fromEntries(CAT_ORDER.map((c) => [c, 0])) as Record<Cat, number>,
  };
  const accSum = { w: 0, b: 0 };
  const accN = { w: 0, b: 0 };

  moves.forEach((m, i) => {
    const sign = m.color === "w" ? 1 : -1;
    const before = sign * positions[i].value;
    const after = sign * positions[i + 1].value;
    const bClamped = clamp(before);
    const aClamped = clamp(after);
    const loss = Math.max(0, bClamped - aClamped);
    const uci = m.from + m.to + (m.promotion ?? "");
    const mated = new Chess(m.after).isCheckmate();
    const isBest = mated || (positions[i].best !== "" && uci === positions[i].best);

    let cat: Cat;
    let sac = 0;
    if (bookFlags[i]) {
      cat = "book";
    } else {
      sac = sacrificeAmount(m, positions[i + 1]);
      const realSac = sac >= 2 || (sac >= 1 && aClamped >= 150 && bClamped < 150);
      const notLost = aClamped > -80;
      if (realSac && notLost && (isBest || loss < 20)) cat = "brilliant";
      else if (isBest) cat = "best";
      else if (loss < 20) cat = "excellent";
      else if (loss < 50) cat = "good";
      else if (loss < 100) cat = "inaccuracy";
      else if (loss < 200) cat = "mistake";
      else cat = "blunder";

      // Смягчение: ты всё ещё уверенно побеждаешь → потеря 1–2 пешек = неточность
      if ((cat === "mistake" || cat === "blunder") && loss <= 200 && aClamped > 250) {
        cat = "inaccuracy";
      }
    }

    const bestUci = positions[i].best;
    infos.push({
      ply: i + 1,
      san: m.san,
      uci,
      color: m.color,
      from: m.from,
      to: m.to,
      fenBefore: m.before,
      fenAfter: m.after,
      cat,
      loss,
      bestUci,
      bestSan: isBest ? m.san : uciToSan(m.before, bestUci),
      sacrifice: sac,
      opening: openingNames[i],
    });
    counts[m.color][cat]++;

    // точность хода (формула win%)
    let acc: number;
    if (cat === "book" || isBest) acc = 100;
    else {
      const d = Math.max(0, winPct(before) - winPct(after));
      acc = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * d) - 3.1669 + 1));
    }
    accSum[m.color] += acc;
    accN[m.color]++;
  });

  const lastOpening = [...openingNames].reverse().find(Boolean);

  return {
    headers,
    moves: infos,
    positions,
    accuracy: {
      w: accN.w ? accSum.w / accN.w : 100,
      b: accN.b ? accSum.b / accN.b : 100,
    },
    counts,
    opening: lastOpening,
    mode,
    elapsedMs: performance.now() - t0,
  };
}

export function formatEval(value: number, mate: number | null): string {
  if (mate !== null) {
    if (mate === 0) return value > 0 ? "1-0" : "0-1";
    return (mate > 0 ? "M" : "-M") + Math.abs(mate);
  }
  const v = value / 100;
  return (v > 0 ? "+" : "") + v.toFixed(1);
}

export const SAMPLE_PGN = `[Event "Opera Game"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[White "Paul Morphy"]
[Black "Duke of Brunswick & Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;
