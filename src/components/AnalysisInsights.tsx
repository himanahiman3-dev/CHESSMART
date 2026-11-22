import { useEffect, useMemo, useRef, useState } from "react";
import type { Color, Cls, EngineLine, GameReview, Score } from "../types";
import { CLS_META } from "../types";
import { classifyOrdinaryMove } from "../lib/moveClassification";
import { winFor } from "../lib/winprob";
import { evaluatePositionDiagnostics } from "../lib/grandmasterDiagnostics";
import { explainStockfishMove } from "../lib/engineCoach";
import { countPositionPieces, lookupSyzygy, type SyzygyResult } from "../lib/endgameTablebase";
import { sanRu } from "../lib/format";

export interface FreeMoveAssessment {
  san: string;
  uci: string;
  color: Color;
  baseScore: Score | null;
  baseBestUci?: string;
  afterFen: string;
}

interface Props {
  fen: string;
  enabled: boolean;
  lines: EngineLine[];
  targetDepth: number;
  freeMoveAssessment: FreeMoveAssessment | null;
  review: GameReview;
  onSeek: (ply: number) => void;
  onPlayUci: (uci: string) => void;
}

const DANGER_PATTERN = /висящ|атакован|под атакой|под боем|атаки на короля|давление вокруг|под шахом/i;
const STRATEGY_PATTERN = /центр|пешечн|проходн|ладьи|развит|активност|корол/i;

function colorMatches(title: string, color: Color): boolean {
  const text = title.toLocaleLowerCase("ru");
  const words = color === "w" ? ["белых", "белые", "белого"] : ["чёрных", "чёрные", "чёрного"];
  return words.some((word) => text.includes(word));
}

function gradeFreeMove(assessment: FreeMoveAssessment, afterScore: Score): { cls: Cls; loss: number } {
  if (assessment.baseBestUci && assessment.uci === assessment.baseBestUci) {
    return { cls: "best", loss: 0 };
  }
  const before = winFor(assessment.baseScore!, assessment.color);
  const after = winFor(afterScore, assessment.color);
  const loss = Math.max(0, before - after);
  return { cls: classifyOrdinaryMove(loss), loss };
}

function categoryLabel(category: string): string {
  const labels: Record<string, string> = {
    "syzygy-win": "Табличный выигрыш",
    "win": "Выигрыш",
    "maybe-win": "Вероятный выигрыш",
    "cursed-win": "Выигрыш без гарантии в правиле 50 ходов",
    "draw": "Ничья",
    "blessed-loss": "Теоретический проигрыш, но ничья по правилу 50 ходов",
    "maybe-loss": "Вероятный проигрыш",
    "syzygy-loss": "Табличный проигрыш",
    "loss": "Проигрыш",
    "unknown": "Результат не определён",
  };
  return labels[category] ?? category;
}

export function AnalysisInsights({ fen, enabled, lines, targetDepth, freeMoveAssessment, review, onSeek, onPlayUci }: Props) {
  const diagnostics = useMemo(() => {
    try {
      return evaluatePositionDiagnostics(fen);
    } catch {
      return null;
    }
  }, [fen]);

  const depth = lines.length ? Math.min(...lines.map((line) => line.depth)) : 0;
  const best = lines[0];
  const bestExplanation = useMemo(
    () => enabled && best?.pv[0] ? explainStockfishMove(fen, best.pv[0]) : null,
    [enabled, fen, best?.pv[0]],
  );

  const dangerItems = useMemo(() => {
    if (!diagnostics) return [];
    const side = diagnostics.sideToMove;
    return diagnostics.results
      .filter((item) => DANGER_PATTERN.test(item.title)
        && colorMatches(item.title, side)
        && (item.value > 0 || item.tone === "watch"))
      .sort((a, b) => Number(b.tone === "watch") - Number(a.tone === "watch") || b.value - a.value)
      .slice(0, 5);
  }, [diagnostics]);

  const strategicItems = useMemo(() => {
    if (!diagnostics) return [];
    return diagnostics.results
      .filter((item) => STRATEGY_PATTERN.test(item.category + " " + item.title)
        && !/псевдо|до строгой проверки|геометрическ/i.test(item.description)
        && (item.value > 0 || item.tone === "watch"))
      .sort((a, b) => Number(b.tone === "watch") - Number(a.tone === "watch") || b.value - a.value)
      .slice(0, 5);
  }, [diagnostics]);

  const criticalMoments = useMemo(() => {
    const badClasses: Cls[] = ["inaccuracy", "mistake", "miss", "blunder"];
    const priority: Partial<Record<Cls, number>> = { blunder: 40, miss: 34, mistake: 25, inaccuracy: 12 };
    return review.moves
      .filter((move) => badClasses.includes(move.cls) || move.winLoss >= 2.5)
      .map((move) => ({
        move,
        score: (priority[move.cls] ?? 0) + Math.max(0, move.winLoss) * 2,
      }))
      .sort((a, b) => b.score - a.score || a.move.index - b.move.index)
      .slice(0, 6)
      .map((entry) => entry.move);
  }, [review.moves]);

  const pieceCount = useMemo(() => countPositionPieces(fen), [fen]);
  const [tablebase, setTablebase] = useState<{ status: "idle" | "loading" | "found" | "none" | "error"; result?: SyzygyResult; error?: string }>({ status: "idle" });
  const tablebaseAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    tablebaseAbortRef.current?.abort();
    tablebaseAbortRef.current = null;
    setTablebase({ status: "idle" });
    return () => tablebaseAbortRef.current?.abort();
  }, [fen]);

  useEffect(() => () => tablebaseAbortRef.current?.abort(), []);

  const checkTablebase = async () => {
    tablebaseAbortRef.current?.abort();
    const controller = new AbortController();
    tablebaseAbortRef.current = controller;
    setTablebase({ status: "loading" });
    try {
      const result = await lookupSyzygy(fen, controller.signal);
      if (controller.signal.aborted) return;
      setTablebase(result
        ? { status: "found", result }
        : { status: "none" });
    } catch (reason) {
      if (controller.signal.aborted) return;
      setTablebase({ status: "error", error: reason instanceof Error ? reason.message : String(reason) });
    }
  };

  const grade = freeMoveAssessment && freeMoveAssessment.baseScore && best && freeMoveAssessment.afterFen === fen
    ? gradeFreeMove(freeMoveAssessment, best.score)
    : null;
  const provisional = depth > 0 && depth < targetDepth;

  return (
    <div className="mt-3 space-y-3">
      {freeMoveAssessment && freeMoveAssessment.afterFen === fen && (
        <section className="rounded-xl border border-[#596b48]/60 bg-[#242a20] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.13em] text-[#a8c98a]">Оценка свободного хода</div>
              <div className="mt-1 text-sm font-extrabold text-[#f1f0ec]">{sanRu(freeMoveAssessment.san)}</div>
            </div>
            {grade && (
              <span className="rounded-md px-2.5 py-1 text-[10px] font-black" style={{ backgroundColor: CLS_META[grade.cls].color + "26", color: CLS_META[grade.cls].color }}>
                {CLS_META[grade.cls].ru}
              </span>
            )}
          </div>
          {!freeMoveAssessment.baseScore ? (
            <p className="mt-2 text-[11px] leading-relaxed text-[#c1c5b8]">Не удалось получить оценку исходной позиции до этого хода. CHESSMART не подставляет сюда старую метку из отчёта партии.</p>
          ) : !best ? (
            <p className="mt-2 text-[11px] text-[#aaa89f]">Stockfish рассчитывает позицию после вашего хода…</p>
          ) : (
            <p className="mt-2 text-[11px] leading-relaxed text-[#c1c5b8]">
              Потеря ожидаемых очков: <b className="text-white">{grade?.loss.toFixed(1) ?? "—"} п.п.</b>
              {freeMoveAssessment.baseBestUci && <> · Лучший ход из исходной позиции: <b className="text-white">{freeMoveAssessment.baseBestUci === freeMoveAssessment.uci ? "сыгран" : "не сыгран"}</b></>}
              {provisional ? " · оценка предварительная, пока идёт поиск" : " · оценка по текущему завершённому поиску"}
            </p>
          )}
          <p className="mt-2 text-[9px] text-[#88917d]">Сравнивается оценка до хода с оценкой после него. Классификация не берётся из Game Review.</p>
        </section>
      )}

      {enabled && diagnostics && (
        <section className="rounded-xl border border-[#49463f] bg-[#292824] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-extrabold text-[#f1f0ec]">Угрозы и тактические риски</h3>
            <span className="text-[9px] font-bold uppercase tracking-wide text-[#d2ae72]">Позиционная проверка</span>
          </div>
          {bestExplanation?.tactical.length ? (
            <div className="mt-2 rounded-lg bg-[#242a20] p-2.5">
              <div className="text-[9px] font-black uppercase tracking-wide text-[#a8c98a]">Тактика в лучшем продолжении · {sanRu(bestExplanation.san)}</div>
              <div className="mt-1 space-y-1">
                {bestExplanation.tactical.map((item) => <p key={item} className="text-[11px] text-[#dce6d2]">{item}</p>)}
              </div>
            </div>
          ) : null}
          {dangerItems.length ? (
            <div className="mt-2 space-y-1.5">
              {dangerItems.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg bg-[#211f1c] px-2.5 py-2">
                  <span className="min-w-0 text-[11px] text-[#d8d6cf]">{item.title}</span>
                  <span className={"shrink-0 text-[10px] font-bold tabular-nums " + (item.tone === "watch" ? "text-[#e2ae66]" : "text-[#9fc77b]")}>{item.displayValue}</span>
                </div>
              ))}
            </div>
          ) : !bestExplanation?.tactical.length ? (
            <p className="mt-2 text-[11px] text-[#99978f]">Явных атакованных фигур по геометрической проверке не найдено.</p>
          ) : null}
          <p className="mt-2 text-[9px] leading-relaxed text-[#817e75]">Атакованные поля и фигуры определяются позиционной эвристикой; она может переоценить связанную фигуру. Перед выводом о потере материала проверяй легальность тактики движком.</p>
        </section>
      )}

      {diagnostics && (
        <section className="rounded-xl border border-[#49463f] bg-[#292824] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-extrabold text-[#f1f0ec]">Стратегическая картина</h3>
            <span className="text-[9px] font-semibold text-[#929087]">Структура · центр · активность</span>
          </div>
          <div className="mt-2 space-y-1.5">
            {strategicItems.map((item) => (
              <div key={item.id} className="rounded-lg bg-[#211f1c] px-2.5 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 text-[11px] font-bold text-[#d8d6cf]">{item.title}</span>
                  <span className={"shrink-0 text-[10px] font-bold tabular-nums " + (item.tone === "watch" ? "text-[#e2ae66]" : "text-[#9fc77b]")}>{item.displayValue}</span>
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-[#99978f]">{item.description}</p>
              </div>
            ))}
            {strategicItems.length === 0 && <p className="text-[11px] text-[#99978f]">По выбранным стратегическим показателям заметных отклонений не обнаружено.</p>}
          </div>
          <p className="mt-2 text-[9px] leading-relaxed text-[#817e75]">Это ориентиры по структуре и активности, а не самостоятельная оценка Stockfish и не доказательство стратегического преимущества.</p>
        </section>
      )}

      <section className="rounded-xl border border-[#49463f] bg-[#292824] p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-extrabold text-[#f1f0ec]">Таблицы окончаний Syzygy</h3>
            <p className="mt-0.5 text-[10px] text-[#99978f]">{pieceCount}/7 фигур · точный результат в поддерживаемых позициях</p>
          </div>
          <button
            type="button"
            onClick={() => void checkTablebase()}
            disabled={pieceCount > 7 || tablebase.status === "loading"}
            className="shrink-0 rounded-lg bg-[#81b64c] px-3 py-2 text-[10px] font-extrabold text-[#182012] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {tablebase.status === "loading" ? "Проверяем…" : "Проверить"}
          </button>
        </div>
        {pieceCount > 7 && <p className="mt-2 text-[10px] text-[#aaa89f]">Проверка доступна, когда на доске не более семи фигур.</p>}
        {tablebase.status === "none" && <p className="mt-2 text-[11px] text-[#aaa89f]">Для этой позиции таблица не вернула результат.</p>}
        {tablebase.status === "error" && <p role="alert" className="mt-2 text-[11px] text-[#ed9a8f]">{tablebase.error}</p>}
        {tablebase.status === "found" && tablebase.result && (
          <div className="mt-3 rounded-lg bg-[#211f1c] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-black text-[#c6dda9]">{categoryLabel(tablebase.result.category)}</span>
              <span className="text-[10px] text-[#c6c3b8]">
                {tablebase.result.dtz !== null && tablebase.result.dtz !== undefined ? "DTZ " + tablebase.result.dtz : ""}
                {tablebase.result.dtm !== null && tablebase.result.dtm !== undefined ? " · DTM " + tablebase.result.dtm : ""}
              </span>
            </div>
            {tablebase.result.moves.slice(0, 3).map((move, index) => (
              <button key={move.uci} type="button" onClick={() => onPlayUci(move.uci)} className="mt-2 flex w-full items-center justify-between gap-2 rounded-md bg-[#2e2c27] px-2.5 py-2 text-left hover:bg-[#3a3932]">
                <span className="text-[11px] font-bold text-[#dedbd1]">{index + 1}. {sanRu(move.san)}</span>
                <span className="text-[9px] font-bold text-[#9fc77b]">СЫГРАТЬ</span>
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 text-[9px] leading-relaxed text-[#817e75]">Запрос отправляет текущую FEN-позицию в сервис tablebase.lichess.ovh. DTZ — расстояние до взятия или хода пешкой, а не число ходов до мата.</p>
      </section>

      {criticalMoments.length > 0 && (
        <section className="rounded-xl border border-[#49463f] bg-[#292824] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-extrabold text-[#f1f0ec]">Критические моменты партии</h3>
            <span className="text-[9px] font-semibold text-[#929087]">Автоматический поиск</span>
          </div>
          <div className="mt-2 space-y-1.5">
            {criticalMoments.map((move) => (
              <button key={move.index} type="button" onClick={() => onSeek(move.index)} className="flex w-full items-center gap-2 rounded-lg bg-[#211f1c] px-2.5 py-2 text-left hover:bg-[#3a3932]">
                <span className="shrink-0 text-[10px] font-black tabular-nums text-[#aaa89f]">{Math.floor(move.index / 2) + 1}{move.color === "w" ? "." : "…"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-bold text-[#e1dfd7]">{sanRu(move.san)} · {CLS_META[move.cls].ru}</span>
                  {move.bestSan && <span className="block text-[9px] text-[#99978f]">Вместо этого: {sanRu(move.bestSan)}</span>}
                </span>
                <span className="shrink-0 text-[10px] font-bold tabular-nums text-[#e2ae66]">−{move.winLoss.toFixed(1)}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[9px] text-[#817e75]">Нажми на момент, чтобы перейти к позиции перед соответствующим ходом.</p>
        </section>
      )}
    </div>
  );
}
