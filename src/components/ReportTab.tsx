import type { GameReview } from "../types";
import { CLS_META, CLS_ORDER } from "../types";
import { ClsBadge } from "./ClsBadge";
import { AdvantageChart } from "./AdvantageChart";

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
          <span>Ходы</span>
          <span className="text-center">Бел.</span>
          <span className="text-center">Чёр.</span>
        </div>
        {CLS_ORDER.map((c) => {
          const w = review.counts.w[c];
          const b = review.counts.b[c];
          return (
            <div key={c} className="grid grid-cols-[1fr_44px_44px] items-center px-3 py-1.5 text-sm odd:bg-white/[0.02]">
              <span className="flex items-center gap-2">
                <ClsBadge cls={c} size={20} />
                <span style={{ color: c === "book" ? "#c9a87e" : CLS_META[c].color }} className="font-semibold">
                  {CLS_META[c].ru}
                </span>
              </span>
              <span className={`text-center font-bold tabular-nums ${w ? "" : "text-[#6b6964]"}`}>{w}</span>
              <span className={`text-center font-bold tabular-nums ${b ? "" : "text-[#6b6964]"}`}>{b}</span>
            </div>
          );
        })}
      </div>

      {review.opening && (
        <div className="rounded-lg bg-[#2b2926] p-3">
          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-[#a7a6a2]">Дебют</div>
          <div className="flex items-start gap-2">
            <ClsBadge cls="book" size={22} />
            <div>
              <div className="text-sm font-bold">
                <span className="mr-1.5 rounded bg-[#a88865]/25 px-1.5 py-0.5 text-xs text-[#d6b88f]">{review.opening.eco}</span>
                {review.opening.ru}
              </div>
              <div className="text-xs text-[#a7a6a2]">{review.opening.en}</div>
            </div>
          </div>
        </div>
      )}
      <p className="px-1 text-[11px] leading-relaxed text-[#6f6d69]">
        Глубина анализа: {review.depth} · Stockfish 19 · MultiPV 2. Точность считается по формуле CAPS2 (Win% и волатильность
        позиции). Рейтинг партии — приблизительная оценка по точности и Elo из PGN.
      </p>
    </div>
  );
}
