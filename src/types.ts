export type Color = "w" | "b";

export type Cls =
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "book"
  | "inaccuracy"
  | "mistake"
  | "miss"
  | "blunder";

/** Оценка с точки зрения БЕЛЫХ. cp — сантипешки, mate — ходов до мата (+ мат ставят белые). */
export type Score = { cp: number; mate?: undefined; terminal?: undefined } | { mate: number; cp?: undefined; terminal?: boolean };

export interface EngineLine {
  multipv: number;
  depth: number;
  score: Score; // с точки зрения белых
  pv: string[]; // UCI
}

export interface PositionEval {
  fen: string;
  depth: number;
  lines: EngineLine[];
}

export interface OpeningInfo {
  eco: string;
  en: string;
  ru: string;
}

export interface MoveReview {
  index: number; // 0-based индекс полухода
  color: Color;
  san: string;
  uci: string;
  from: string;
  to: string;
  piece: string;
  captured?: string;
  fenBefore: string;
  fenAfter: string;
  cls: Cls;
  scoreBefore: Score; // лучшая линия до хода (белые)
  scoreAfter: Score; // оценка после сыгранного хода (белые)
  winBefore: number; // Win% для ходящего (лучшая линия)
  winAfter: number; // Win% для ходящего после хода
  winLoss: number;
  accuracy: number;
  bestUci?: string;
  bestSan?: string;
  secondUci?: string;
  playedIsBest: boolean;
  sacrifice: boolean;
  opening?: OpeningInfo;
  comment: string;
  lines: EngineLine[]; // линии до хода
}

export interface GameReview {
  headers: Record<string, string>;
  startFen: string;
  moves: MoveReview[];
  fens: string[]; // N+1
  scores: Score[]; // N+1, белые
  positions: PositionEval[]; // N+1 результатов движка
  winSeries: number[]; // Win% белых по позициям
  accuracy: { w: number; b: number };
  counts: { w: Record<Cls, number>; b: Record<Cls, number> };
  rating: { w: number; b: number };
  opening?: OpeningInfo;
  depth: number;
}

export const CLS_ORDER: Cls[] = [
  "brilliant",
  "great",
  "best",
  "excellent",
  "good",
  "book",
  "inaccuracy",
  "mistake",
  "miss",
  "blunder",
];

export const CLS_META: Record<Cls, { color: string; symbol: string; ru: string; en: string }> = {
  brilliant: { color: "#1baca6", symbol: "!!", ru: "Блестящий", en: "Brilliant" },
  great: { color: "#5c8bb0", symbol: "!", ru: "Отличный", en: "Great" },
  best: { color: "#96bc4b", symbol: "★", ru: "Лучший", en: "Best" },
  excellent: { color: "#96bc4b", symbol: "👍", ru: "Отличный ход", en: "Excellent" },
  good: { color: "#95af8a", symbol: "✓", ru: "Хороший", en: "Good" },
  book: { color: "#a88865", symbol: "📖", ru: "Книжный", en: "Book" },
  inaccuracy: { color: "#f7c045", symbol: "?!", ru: "Неточность", en: "Inaccuracy" },
  mistake: { color: "#e58f2a", symbol: "?", ru: "Ошибка", en: "Mistake" },
  miss: { color: "#ca3431", symbol: "×", ru: "Упущено", en: "Miss" },
  blunder: { color: "#ca3431", symbol: "??", ru: "Зевок", en: "Blunder" },
};

export const emptyCounts = (): Record<Cls, number> => ({
  brilliant: 0,
  great: 0,
  best: 0,
  excellent: 0,
  good: 0,
  book: 0,
  inaccuracy: 0,
  mistake: 0,
  miss: 0,
  blunder: 0,
});
