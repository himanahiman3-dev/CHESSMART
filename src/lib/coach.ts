/**
 * Виртуальный тренер: генерирует текстовый комментарий на русском к каждому ходу.
 */
import type { Cls, Color, EngineLine, OpeningInfo, Score } from "../types";
import { describeReply, hangingLoss, pieceValueCp } from "./see";
import { PIECE_NAME_RU, PIECE_NAME_RU_GEN, formatScore, sanRu } from "./format";
import { cpFor } from "./winprob";

export interface CoachContext {
  cls: Cls;
  color: Color;
  san: string;
  uci: string;
  piece: string;
  captured?: string;
  fenBefore: string;
  fenAfter: string;
  bestUci?: string;
  bestSan?: string;
  playedIsBest: boolean;
  scoreBefore: Score;
  scoreAfter: Score;
  winBefore: number;
  winAfter: number;
  winLoss: number;
  sacrifice: boolean;
  sacrificePiece: string;
  opening?: OpeningInfo;
  linesBefore: EngineLine[];
  linesAfter: EngineLine[];
  prevOpponentLoss: number;
  prevOpponentSan?: string;
  legalMoves: number;
  isCheck: boolean;
  isMate: boolean;
  exceptionPawn: boolean;
  bestSecondGapCp: number;
  bestSecondSan?: string;
}

const PIECE_ACC_PLAIN = PIECE_NAME_RU;

function advantagePhrase(score: Score, color: Color): string {
  const cp = cpFor(score, color);
  if (score.mate !== undefined) {
    return cp > 0 ? "у вас форсированный выигрыш" : "положение проигрышное";
  }
  const a = Math.abs(cp);
  if (a < 30) return "позиция примерно равна";
  const who = cp > 0 ? "у вас" : "у соперника";
  if (a < 100) return `${who} небольшое преимущество`;
  if (a < 250) return `${who} заметное преимущество`;
  if (a < 500) return `${who} значительное преимущество`;
  return `${who} решающее преимущество`;
}

function pov(score: Score, color: Color): Score {
  if (color === "w") return score;
  return score.mate !== undefined ? { mate: -score.mate, terminal: score.terminal } : { cp: -score.cp };
}

function mateIn(score: Score): number | null {
  return score.mate !== undefined && !score.terminal ? Math.abs(score.mate) : null;
}

function pvToRu(fen: string, pv: string[], max = 1): string {
  const r = describeReply(fen, pv[0] ?? "");
  if (!r) return "";
  const first = sanRu(r.san);
  if (max <= 1) return first;
  return first;
}

function whyBad(ctx: CoachContext): string {
  const { color } = ctx;
  const after = ctx.scoreAfter;
  const before = ctx.scoreBefore;
  const mAfter = mateIn(after);
  // 1. позволил мат
  if (mAfter !== null && cpFor(after, color) < 0) {
    return `позволяет сопернику поставить мат в ${mAfter}`;
  }
  // 2. вилка / потеря фигуры
  const replyUci = ctx.linesAfter[0]?.pv[0];
  if (replyUci) {
    const reply = describeReply(ctx.fenAfter, replyUci);
    if (reply) {
      const rsan = sanRu(reply.san);
      if (reply.forkTargets.length >= 2) {
        const names = Array.from(new Set(reply.forkTargets)).map((t) =>
          t === "k" ? "короля" : PIECE_NAME_RU_GEN[t] ? PIECE_ACC_PLAIN[t] : t
        );
        return `зевает вилку: ответ ${rsan} одновременно атакует ${names.join(" и ")}`;
      }
      if (reply.captured && pieceValueCp(reply.captured) >= 300 && hangingLoss(ctx.fenAfter) >= 250) {
        return `оставляет фигуру под боем: после ${rsan} соперник выигрывает ${PIECE_NAME_RU[reply.captured]}`;
      }
      if (reply.captured === "p" && ctx.winLoss >= 5) {
        return `теряет пешку после ${rsan}`;
      }
      if (reply.isCheck) {
        return `позволяет сильный шах ${rsan}`;
      }
    }
  }
  // 3. упущенный мат
  const mBefore = mateIn(before);
  if (mBefore !== null && cpFor(before, color) > 0 && !(mAfter !== null && cpFor(after, color) > 0)) {
    return `упускает форсированный мат в ${mBefore}${ctx.bestSan ? ` ходом ${sanRu(ctx.bestSan)}` : ""}`;
  }
  // 4. упущенный выигрыш материала
  if (ctx.bestUci) {
    const best = describeReply(ctx.fenBefore, ctx.bestUci);
    if (best?.captured && pieceValueCp(best.captured) >= 300 && !ctx.captured) {
      return `упускает возможность выиграть ${PIECE_NAME_RU[best.captured]} ходом ${sanRu(best.san)}`;
    }
    if (best?.isMate) return `упускает мат ходом ${sanRu(best.san)}`;
    if (best?.captured && pieceValueCp(best.captured) >= 100 && !ctx.captured && ctx.winLoss >= 5) {
      return `упускает возможность выиграть материал ходом ${sanRu(best.san)}`;
    }
    if (best?.isCheck && ctx.winLoss >= 8) return `не использует сильный шах ${sanRu(best.san)}`;
  }
  return `оценка для ${color === "w" ? "белых" : "чёрных"} меняется с ${formatScore(pov(before, color))} на ${formatScore(pov(after, color))}`;
}

export function buildComment(ctx: CoachContext): string {
  const side = ctx.color === "w" ? "Белые" : "Чёрные";
  const san = sanRu(ctx.san);
  const best = ctx.bestSan ? sanRu(ctx.bestSan) : "";
  const adv = advantagePhrase(ctx.scoreAfter, ctx.color);
  const parts: string[] = [];

  switch (ctx.cls) {
    case "book": {
      const o = ctx.opening;
      parts.push(`${san} — теоретический ход из дебюта.`);
      if (o) parts.push(`${o.ru} (${o.eco}).`);
      break;
    }
    case "brilliant": {
      const piece = PIECE_NAME_RU[ctx.sacrificePiece] ?? "материал";
      const m = mateIn(ctx.scoreAfter);
      if (m !== null && cpFor(ctx.scoreAfter, ctx.color) > 0) {
        parts.push(`${san} — блестящая жертва! ${side} отдают ${piece}, но получают форсированный мат в ${m}.`);
      } else if (ctx.isCheck) {
        parts.push(`${san} — отличная жертва, вскрывающая позицию короля. ${side} отдают ${piece} ради атаки.`);
      } else {
        const cpAfter = cpFor(ctx.scoreAfter, ctx.color);
        parts.push(
          cpAfter >= 30
            ? `${san} — отличная жертва! ${side} отдают ${piece}, но получают сильную инициативу и преимущество (${formatScore(ctx.scoreAfter)}).`
            : `${san} — отличная жертва! ${side} отдают ${piece} ради инициативы: компенсации достаточно, чтобы удержать позицию (${formatScore(ctx.scoreAfter)}).`
        );
      }
      parts.push("Это лучший ход, и найти его непросто.");
      break;
    }
    case "great": {
      parts.push(`${san} — единственный хороший ход в этой позиции!`);
      if (ctx.bestSecondSan) {
        const gap = Math.abs(ctx.bestSecondGapCp) >= 90000 ? "ведёт к мату" : `теряет около ${(Math.abs(ctx.bestSecondGapCp) / 100).toFixed(1)} пешки`;
        parts.push(`Лучший из остальных ходов (${sanRu(ctx.bestSecondSan)}) заметно слабее — он ${gap}.`);
      } else parts.push("Остальные ходы резко ухудшают оценку.");
      break;
    }
    case "best": {
      const m = mateIn(ctx.scoreAfter);
      if (ctx.isMate) parts.push(`${san} — мат! Партия окончена.`);
      else if (m !== null && cpFor(ctx.scoreAfter, ctx.color) > 0) parts.push(`${san} — лучший ход: впереди форсированный мат в ${m}.`);
      else if (ctx.captured && pieceValueCp(ctx.captured) >= 300)
        parts.push(`${san} — лучший ход: ${side.toLowerCase()} выигрывают ${PIECE_NAME_RU[ctx.captured]}.`);
      else if (ctx.isCheck) parts.push(`${san} — сильный шах и лучший ход по мнению Stockfish 19.`);
      else if (ctx.prevOpponentLoss >= 10)
        parts.push(`${san} — лучший ход! ${side} использовали ошибку соперника (${ctx.prevOpponentSan ? sanRu(ctx.prevOpponentSan) : "предыдущий ход"}).`);
      else parts.push(`${san} — лучший ход в позиции, первая линия Stockfish 19.`);
      if (!ctx.isMate) parts.push(`Сейчас: ${adv}.`);
      break;
    }
    case "excellent": {
      parts.push(`${san} — отличный ход, почти не уступающий лучшему${best ? ` (${best})` : ""}.`);
      parts.push(`Сейчас: ${adv}.`);
      break;
    }
    case "good": {
      parts.push(`${san} — хороший, рабочий ход.`);
      if (best) parts.push(`Немного сильнее было ${best}.`);
      parts.push(`Сейчас: ${adv}.`);
      break;
    }
    case "inaccuracy": {
      if (ctx.exceptionPawn) {
        parts.push(`${san} — неточность: ${side.toLowerCase()} теряют материал, но сохраняют огромное преимущество (${formatScore(ctx.scoreAfter)}).`);
        if (best) parts.push(`Точнее было ${best}.`);
      } else {
        parts.push(`${san} — неточность: ${whyBad(ctx)}.`);
        if (best) parts.push(`Лучше было ${best}.`);
      }
      break;
    }
    case "mistake": {
      parts.push(`${san} — ошибка: ${whyBad(ctx)}.`);
      if (best) parts.push(`Нужно было сыграть ${best}.`);
      break;
    }
    case "miss": {
      const opp = ctx.prevOpponentSan ? ` (${sanRu(ctx.prevOpponentSan)})` : "";
      parts.push(`Соперник ошибся${opp}, но ${side.toLowerCase()} не воспользовались этим: ${whyBad(ctx)}.`);
      if (best) parts.push(`Выигрывало ${best}.`);
      parts.push(`Преимущество растаяло — ${adv}.`);
      break;
    }
    case "blunder": {
      parts.push(`Этот ход — зевок: ${whyBad(ctx)}.`);
      if (best) parts.push(`Нужно было сыграть ${best}.`);
      parts.push(`Теперь ${adv}.`);
      break;
    }
  }
  if (ctx.cls === "blunder" || ctx.cls === "mistake" || ctx.cls === "miss") {
    parts.push("Нажмите «Попробовать снова», чтобы найти лучший ход самостоятельно.");
  }
  return parts.join(" ");
}

export { pvToRu };
