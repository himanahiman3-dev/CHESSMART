import type { GameReview } from "../types";
import { CLS_META, CLS_ORDER } from "../types";
import { ClsBadge } from "./ClsBadge";
import { AdvantageChart } from "./AdvantageChart";
import { calculatePhaseAccuracy, PHASE_LABELS } from "../lib/learningStats";
import { sanRu } from "../lib/format";

function PlayerBox({ name, elo, acc, rating, white }: { name: string; elo?: string; acc: number; rating: number; white: boolean }) {
  return (
    <div className="rounded-lg bg-[#2b2926] p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className={`h-4 w-4 shrink-0 rounded-sm border ${white ? "border-[#8b8987] bg-white" : "border-black bg-[#403d39]"}`} />
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{name}</div>
          {elo && <div className="text-[11px] text-[#a7a6a2]">{elo}</div>}
        </div>
      </div>
      <div className={`rounded-md py-2 text-center text-2xl font-black tabular-nums ${white ? "bg-white text-[#262421]" : "bg-[#403d39] text-white"}`}>
        {acc.toFixed(1)}
      </div>
      <div className="mt-1 text-center text-[11px] uppercase tracking-wide text-[#a7a6a2]">Точность</div>
      <div className="mt-2 flex items-center justify-between rounded-md bg-[#1f1d1b] px-2 py-1.5 text-xs">
        <span className="text-[#a7a6a2]">Рейтинг партии</span>
        <b className="text-sm tabular-nums">{rating}</b>
      </div>
    </div>
  );
}

export function ReportTab({ review, ply, onSeek }: { review: GameReview; ply: number; onSeek: (p: number) => void }) {
  const h = review.headers;
  const phases = calculatePhaseAccuracy(review.moves);
  const brilliant = review.moves.filter((move) => move.cls === "brilliant");
  const missed = review.moves.filter((move) => move.cls === "miss");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <PlayerBox name={h.White ?? "Белые"} elo={h.WhiteElo} acc={review.accuracy.w} rating={review.rating.w} white />
        <PlayerBox name={h.Black ?? "Чёрные"} elo={h.BlackElo} acc={review.accuracy.b} rating={review.rating.b} white={false} />
      </div>

      <div>
        <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-[#a7a6a2]">График преимущества</div>
        <AdvantageChart winSeries={review.winSeries} ply={ply} moves={review.moves} onSeek={onSeek} />
      </div>

      <div className="overflow-hidden rounded-lg bg-[#2b2926]">
        <div className="grid grid-cols-[1fr_44px_44px] items-center border-b border-[#3d3a37] px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-[#a7a6a2]">
          <span>Ходы</span><span className="text-center">Бел.</span><span className="text-center">Чёр.</span>
        </div>
        {CLS_ORDER.map((c) => {
          const w = review.counts.w[c];
          const b = review.counts.b[c];
          return (
            <div key={c} className="grid grid-cols-[1fr_44px_44px] items-center px-3 py-1.5 text-sm odd:bg-white/[0.02]">
              <span className="flex items-center gap-2"><ClsBadge cls={c} size={20} /><span style={{ color: c === "book" ? "#c9a87e" : CLS_META[c].color }} className="font-semibold">{CLS_META[c].ru}</span></span>
              <span className={`text-center font-bold tabular-nums ${w ? "" : "text-[#6b6964]"}`}>{w}</span>
              <span className={`text-center font-bold tabular-nums ${b ? "" : "text-[#6b6964]"}`}>{b}</span>
            </div>
          );
        })}
      </div>

      <section className="rounded-lg bg-[#2b2926] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs font-bold uppercase tracking-wide text-[#a7a6a2]">Точность по стадиям</div>
          <span className="text-[10px] text-[#77746f]">по ходам каждой стороны</span>
        </div>
        <div className="space-y-3">
          {(["opening", "middlegame", "endgame"] as const).map((phase) => {
            const stat = phases[phase];
            const hasMoves = stat.w.moves + stat.b.moves > 0;
            return (
              <div key={phase}>
                <div className="mb-1 flex items-center justify-between text-sm"><b>{PHASE_LABELS[phase]}</b><span className="text-[10px] text-[#77746f]">{stat.w.moves + stat.b.moves} полуходов</span></div>
                <div className="grid grid-cols-2 gap-2">
                  {(["w", "b"] as const).map((color) => {
                    const side = stat[color];
                    const value = side.moves ? side.accuracy : 0;
                    return (
                      <div key={color}>
                        <div className="mb-1 flex justify-between text-[11px] text-[#a7a6a2]"><span>{color === "w" ? "Белые" : "Чёрные"}</span><b className="text-white">{side.moves ? `${value.toFixed(1)}%` : "—"}</b></div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[#1f1d1b]"><div className={`h-full ${color === "w" ? "bg-[#e5e5e5]" : "bg-[#88837a]"}`} style={{ width: `${value}%` }} /></div>
                      </div>
                    );
                  })}
                </div>
                {!hasMoves && <div className="mt-1 text-[10px] text-[#77746f]">В этой стадии ходов не было</div>}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-[#77746f]">Границы стадий определяются приближённо: дебют — первые 10 ходов, эндшпиль — по оставшемуся тяжёлому и лёгкому материалу.</p>
      </section>

      <section className="rounded-lg bg-[#2b2926] p-3">
        <div className="mb-2 flex items-center justify-between"><div className="text-xs font-bold uppercase tracking-wide text-[#a7a6a2]">Блестящие ходы</div><span className="rounded bg-[#1baca6]/15 px-2 py-0.5 text-xs font-black text-[#59c9c0]">{brilliant.length}</span></div>
        {brilliant.length ? (
          <div className="space-y-2">
            {brilliant.map((move) => (
              <button key={move.index} onClick={() => onSeek(move.index + 1)} className="flex w-full items-start gap-2 rounded-md bg-[#1f1d1b] p-2 text-left hover:bg-[#35322e]">
                <ClsBadge cls="brilliant" size={19} />
                <span className="min-w-0 flex-1"><b className="text-sm">{Math.floor(move.index / 2) + 1}{move.color === "b" ? "…" : "."} {sanRu(move.san)}</b><span className="mt-0.5 block text-[11px] leading-relaxed text-[#a7a6a2]">{move.comment}</span></span>
              </button>
            ))}
          </div>
        ) : <p className="text-xs text-[#77746f]">В этой партии блестящих ходов не обнаружено.</p>}
      </section>

      {missed.length > 0 && (
        <section className="rounded-lg bg-[#2b2926] p-3">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-[#a7a6a2]">Упущенные возможности · {missed.length}</div>
          {missed.map((move) => (
            <button key={move.index} onClick={() => onSeek(move.index + 1)} className="mb-1 flex w-full items-start gap-2 rounded-md bg-[#1f1d1b] p-2 text-left last:mb-0 hover:bg-[#35322e]">
              <ClsBadge cls="miss" size={18} /><span className="text-xs"><b>{Math.floor(move.index / 2) + 1}{move.color === "b" ? "…" : "."} {sanRu(move.san)}</b><span className="mt-0.5 block text-[#a7a6a2]">{move.comment}</span></span>
            </button>
          ))}
        </section>
      )}

      {review.opening && (
        <div className="rounded-lg bg-[#2b2926] p-3">
          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-[#a7a6a2]">Дебют</div>
          <div className="flex items-start gap-2"><ClsBadge cls="book" size={22} /><div><div className="text-sm font-bold"><span className="mr-1.5 rounded bg-[#a88865]/25 px-1.5 py-0.5 text-xs text-[#d6b88f]">{review.opening.eco}</span>{review.opening.ru}</div><div className="text-xs text-[#a7a6a2]">{review.opening.en}</div></div></div>
        </div>
      )}
      <p className="px-1 text-[11px] leading-relaxed text-[#6f6d69]">Глубина анализа: {review.depth} · Stockfish 19 · MultiPV 2. Точность — оценка Chessmart на основе Win% и волатильности позиции (не официальный CAPS2 Chess.com). Стадии — приближённое деление по номеру хода и материалу.</p>
    </div>
  );
}
