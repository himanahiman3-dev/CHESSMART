import type { GameReview, MoveReview } from "../types";
import { CLS_META } from "../types";
import { ClsBadge } from "./ClsBadge";
import { formatScore, sanRu } from "../lib/format";

export interface RetryState {
  idx: number;
  status: "waiting" | "wrong" | "solved" | "shown";
  hint: boolean;
  attempts: number;
}

interface Props {
  review: GameReview;
  ply: number;
  move: MoveReview | null;
  retry: RetryState | null;
  showBest: boolean;
  onToggleBest: () => void;
  onStartRetry: () => void;
  onHint: () => void;
  onShowSolution: () => void;
  onExitRetry: () => void;
  onContinue: () => void;
  exploring: boolean;
}

function Avatar() {
  return (
    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-[#a3d160] to-[#5d8b34] shadow-md ring-2 ring-[#81b64c]/60">
      <svg viewBox="0 0 64 64" className="h-full w-full">
        <circle cx="32" cy="26" r="11" fill="#f1c7a1" />
        <path d="M20 24c0-9 6-14 13-14s12 5 11 13c-3-5-8-7-12-6-5 0-9 3-12 7z" fill="#4a3322" />
        <rect x="25" y="26" width="6" height="4" rx="2" fill="none" stroke="#2b2926" strokeWidth="1.5" />
        <rect x="34" y="26" width="6" height="4" rx="2" fill="none" stroke="#2b2926" strokeWidth="1.5" />
        <path d="M28 35c2 2 6 2 8 0" stroke="#8a4b35" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M10 64c2-14 10-20 22-20s20 6 22 20z" fill="#2b2926" />
        <path d="M27 44l5 7 5-7z" fill="#fff" />
      </svg>
    </div>
  );
}

export function CoachCard({
  review,
  ply,
  move,
  retry,
  showBest,
  onToggleBest,
  onStartRetry,
  onHint,
  onShowSolution,
  onExitRetry,
  onContinue,
  exploring,
}: Props) {
  const total = review.moves.length;
  let title: React.ReactNode = null;
  let text = "";

  if (retry) {
    const m = review.moves[retry.idx];
    const side = m.color === "w" ? "белых" : "чёрных";
    if (retry.status === "waiting")
      text = `Найдите лучший ход за ${side}. Перетащите фигуру или кликните по ней и по клетке назначения.`;
    if (retry.status === "wrong") text = "Это не лучший ход. Попробуйте ещё раз — можно взять подсказку.";
    if (retry.status === "solved") text = `Верно! ${m.bestSan ? sanRu(m.bestSan) : "Этот ход"} — лучший ход в позиции. Вы нашли его с ${retry.attempts + 1}-й попытки.`;
    if (retry.status === "shown") text = `Лучший ход — ${m.bestSan ? sanRu(m.bestSan) : "показан стрелкой"}.`;
    title = <span className="font-bold">Попробуйте снова</span>;
  } else if (exploring) {
    title = <span className="font-bold">Свободный анализ</span>;
    text = "Вы исследуете собственный вариант. Stockfish 19 оценивает позицию в реальном времени — смотрите вкладку «Анализ».";
  } else if (move) {
    const meta = CLS_META[move.cls];
    title = (
      <span className="flex items-center gap-2 font-bold">
        <ClsBadge cls={move.cls} size={22} />
        <span style={{ color: move.cls === "book" ? "#c9a87e" : meta.color }}>
          {sanRu(move.san)} — {meta.ru}
        </span>
      </span>
    );
    text = move.comment;
  } else {
    title = <span className="font-bold">Обзор партии готов</span>;
    const h = review.headers;
    text = `${h.White ?? "Белые"} — ${h.Black ?? "Чёрные"}. ${
      review.opening ? `Дебют: ${review.opening.ru} (${review.opening.eco}). ` : ""
    }Листайте партию стрелками ← → или кликайте по графику. Я прокомментирую каждый ход.`;
  }
  if (!retry && !exploring && ply === total && total > 0) {
    const r = review.headers.Result;
    if (r && r !== "*") text += ` Результат партии: ${r}.`;
  }

  const canRetry = !retry && !exploring && move && (move.cls === "mistake" || move.cls === "blunder" || move.cls === "miss") && move.bestUci;
  const bestShown = move && !move.playedIsBest && move.bestSan;

  return (
    <div className="rounded-xl bg-[#262421] p-4">
      <div className="flex gap-3">
        <Avatar />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between gap-2 text-sm">
            {title}
            {!retry && !exploring && move && (
              <span className="rounded bg-[#1f1d1b] px-2 py-0.5 text-xs font-bold tabular-nums text-[#dcdbd7]">{formatScore(move.scoreAfter)}</span>
            )}
          </div>
          <div className="relative rounded-lg rounded-tl-none bg-[#3a3835] px-3 py-2.5 text-[13.5px] leading-snug text-[#e8e7e3]">
            {text}
          </div>
        </div>
      </div>

      {bestShown && !retry && !exploring && (
        <button
          onClick={onToggleBest}
          className={`mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${
            showBest ? "border-[#81b64c]/60 bg-[#2f3a28]" : "border-[#3d3a37] bg-[#2b2926] hover:border-[#5d5a55]"
          }`}
        >
          <span>
            Лучший ход: <b className="text-[#a3d160]">{sanRu(move!.bestSan!)}</b>
          </span>
          <span className="text-xs text-[#a7a6a2]">{showBest ? "стрелка включена" : "показать стрелку"}</span>
        </button>
      )}

      {canRetry && (
        <button
          onClick={onStartRetry}
          className="mt-3 w-full rounded-lg bg-[#81b64c] py-2.5 text-sm font-extrabold shadow-[0_3px_0_#45753c] transition hover:bg-[#95c75f] active:translate-y-0.5 active:shadow-none"
        >
          ↻ Попробовать снова
        </button>
      )}

      {retry && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {retry.status !== "solved" && (
            <>
              <button onClick={onHint} className="rounded-lg bg-[#3d3a37] py-2 text-sm font-semibold hover:bg-[#4b4844]">
                💡 Подсказка
              </button>
              <button onClick={onShowSolution} className="rounded-lg bg-[#3d3a37] py-2 text-sm font-semibold hover:bg-[#4b4844]">
                Показать ход
              </button>
            </>
          )}
          {retry.status === "solved" && (
            <button onClick={onContinue} className="col-span-2 rounded-lg bg-[#81b64c] py-2 text-sm font-extrabold hover:bg-[#95c75f]">
              Продолжить партию →
            </button>
          )}
          <button onClick={onExitRetry} className="col-span-2 rounded-lg bg-[#2b2926] py-2 text-sm text-[#a7a6a2] hover:bg-[#35322e]">
            Выйти из режима
          </button>
        </div>
      )}
    </div>
  );
}
