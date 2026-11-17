import { Chess, type Square } from "chess.js";
import type { Color } from "../types";
import { evaluatePositionDiagnostics, type DiagnosticResult } from "./grandmasterDiagnostics.ts";

export interface EngineCoachChange {
  title: string;
  before: string;
  after: string;
  explanation: string;
  thresholdReached: boolean;
}

export interface EngineMoveExplanation {
  uci: string;
  san: string;
  color: Color;
  tactical: string[];
  changes: EngineCoachChange[];
  fenAfter: string;
}

const PIECE_NAMES: Record<string, string> = {
  p: "пешку",
  n: "коня",
  b: "слона",
  r: "ладью",
  q: "ферзя",
  k: "короля",
};

const DANGER_METRIC = /висящ|атакован|слабые пешки|изолирован|сдвоен|отстал|давление вокруг|атаки на короля|ферзь .* под атакой/i;
const ACTIVITY_METRIC = /контроль центра|расширенный центр|развитые лёгкие фигуры|активность (белых|чёрных)|проходные пешки|пешечные цепи|пешечный щит|защищённые фигуры|ладьи .* открытых линиях|подвижность (ладей|слонов|коней|ферзя)|центральность коней|коневые форпосты/i;
const PSEUDO_ATTACK_METRIC = /висящ|атакован|давление вокруг|атаки на короля|под атакой|контроль центра|расширенный центр|контролируемые поля|подвижность|псевдоподвижность|защищённые фигуры|коневые форпосты|отсталые пешки|слабые пешки|активность (белых|чёрных)|король .* под шахом/i;

function mentionsColor(title: string, color: Color): boolean {
  const variants = color === "w"
    ? ["белых", "белые", "белого", "белыми", "белый"]
    : ["чёрных", "чёрные", "чёрного", "чёрными", "чёрный"];
  const normalized = title.toLocaleLowerCase("ru");
  return variants.some((variant) => normalized.includes(variant));
}

function metricPriority(title: string): number {
  if (/висящ|ферзь .* под атакой|давление вокруг|атаки на короля/i.test(title)) return 100;
  if (/атакован|слабые пешки|отстал|изолирован|сдвоен/i.test(title)) return 85;
  if (/пешечный щит|король .* под шахом/i.test(title)) return 80;
  if (/проходные пешки|контроль центра|расширенный центр/i.test(title)) return 65;
  if (/развитые лёгкие фигуры|активность|защищённые фигуры/i.test(title)) return 55;
  return 40;
}

function explainMetricChange(
  metric: DiagnosticResult,
  before: DiagnosticResult,
  after: DiagnosticResult,
  forMover: boolean,
  isDanger: boolean,
): EngineCoachChange {
  const increased = after.value > before.value;
  const direction = increased ? "увеличился" : "уменьшился";
  const difference = Math.abs(after.value - before.value);
  const sideEffect = isDanger
    ? (forMover ? "Снижает один из отмеченных рисков вашей стороны." : "Создаёт дополнительную угрозу фигурам соперника.")
    : (forMover ? "Усиливает один из позиционных показателей вашей стороны." : "Ослабляет соответствующий позиционный показатель соперника.");
  return {
    title: metric.title,
    before: before.displayValue,
    after: after.displayValue,
    explanation: `Показатель ${direction} на ${difference}; ${sideEffect}`,
    thresholdReached: before.tone === "watch" && after.tone === "good",
  };
}

/**
 * Explains the first move of Stockfish's principal variation using a separate,
 * heuristic before/after comparison. It never invokes or changes Stockfish.
 */
export function explainStockfishMove(fen: string, uci: string): EngineMoveExplanation | null {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(uci)) return null;

  try {
    const board = new Chess(fen);
    const color = board.turn();
    const wasInCheck = board.isCheck();
    const from = uci.slice(0, 2) as Square;
    const to = uci.slice(2, 4) as Square;
    const promotion = uci.length > 4 ? uci[4].toLowerCase() as "q" | "r" | "b" | "n" : undefined;
    const move = board.move({ from, to, promotion });
    if (!move) return null;

    const fenAfter = board.fen();
    const beforeDiagnostics = evaluatePositionDiagnostics(fen);
    const afterDiagnostics = evaluatePositionDiagnostics(fenAfter);
    const beforeByTitle = new Map<string, DiagnosticResult>();
    for (const item of beforeDiagnostics.results) {
      if (!beforeByTitle.has(item.title)) beforeByTitle.set(item.title, item);
    }

    const opponent: Color = color === "w" ? "b" : "w";
    const candidates: EngineCoachChange[] = [];
    const seen = new Set<string>();

    for (const after of afterDiagnostics.results) {
      if (seen.has(after.title)) continue;
      seen.add(after.title);
      const before = beforeByTitle.get(after.title);
      if (!before || before.value === after.value || before.tone === "info" || after.tone === "info") continue;

      const isDanger = DANGER_METRIC.test(after.title);
      const isActivity = ACTIVITY_METRIC.test(after.title);
      if (!isDanger && !isActivity) continue;

      const belongsToMover = mentionsColor(after.title, color);
      const belongsToOpponent = mentionsColor(after.title, opponent);
      if (!belongsToMover && !belongsToOpponent) continue;
      const forMover = belongsToMover;
      const favorableIncrease = isDanger ? !forMover : forMover;
      const improved = favorableIncrease ? after.value > before.value : after.value < before.value;
      if (!improved) continue;

      // Pseudo-legal attack-map metrics are deliberately excluded from the coaching
      // summary: pinned pieces can make geometric attack counts misleading.
      if (PSEUDO_ATTACK_METRIC.test(after.title) || /псевдо|до строгой проверки|геометрическ/i.test(after.description)) continue;
      candidates.push(explainMetricChange(after, before, after, forMover, isDanger));
    }

    candidates.sort((a, b) =>
      Number(b.thresholdReached) - Number(a.thresholdReached) ||
      metricPriority(b.title) - metricPriority(a.title),
    );

    const tactical: string[] = [];
    if (move.captured) tactical.push(`Забирает ${PIECE_NAMES[move.captured] ?? "фигуру"} соперника.`);
    if (move.san === "O-O") tactical.push("Делает короткую рокировку: король уходит с центра, ладья подключается.");
    if (move.san === "O-O-O") tactical.push("Делает длинную рокировку: король уходит с центра, ладья подключается.");
    if (move.promotion) tactical.push(`Проводит пешку в ${PIECE_NAMES[move.promotion] ?? "фигуру"}.`);

    if (wasInCheck && !board.isCheck()) tactical.push("Снимает шах с вашего короля.");
    if (board.isCheckmate()) tactical.push("Ставит мат.");
    else if (board.isCheck()) tactical.push("Объявляет шах королю соперника.");

    return {
      uci,
      san: move.san,
      color,
      tactical,
      changes: candidates.slice(0, 4),
      fenAfter,
    };
  } catch {
    // An invalid FEN or stale/illegal PV move must never break the analysis UI.
    return null;
  }
}
