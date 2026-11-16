import { useRef, useState } from "react";
import type { MoveReview } from "../types";
import { CLS_META } from "../types";

const MARK = new Set(["brilliant", "great", "mistake", "miss", "blunder"]);

export function AdvantageChart({
  winSeries,
  ply,
  moves,
  onSeek,
}: {
  winSeries: number[];
  ply: number;
  moves: MoveReview[];
  onSeek: (ply: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 400;
  const H = 100;
  const n = winSeries.length - 1;
  const x = (i: number) => (n <= 0 ? 0 : (i / n) * W);
  const y = (v: number) => H - (v / 100) * H;
  const line = winSeries.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;

  const idxFromEvent = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return Math.round(t * n);
  };

  return (
    <div className="relative">
      <div
        ref={ref}
        className="relative h-[92px] w-full cursor-pointer overflow-hidden rounded-md bg-[#403d39]"
        onClick={(e) => onSeek(idxFromEvent(e.clientX))}
        onMouseMove={(e) => setHover(idxFromEvent(e.clientX))}
        onMouseLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <path d={area} fill="#f3f3f3" opacity="0.95" />
          <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="#7a766f" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="3 3" />
          <path d={line} fill="none" stroke="#bdbdbd" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
          <line x1={x(ply)} x2={x(ply)} y1="0" y2={H} stroke="#f7c045" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        {moves.map((m) =>
          MARK.has(m.cls) ? (
            <span
              key={m.index}
              className="pointer-events-none absolute h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-black/40"
              style={{ left: `${(x(m.index + 1) / W) * 100}%`, top: `${y(winSeries[m.index + 1])}%`, background: CLS_META[m.cls].color }}
            />
          ) : null
        )}
      </div>
      {hover !== null && (
        <div
          className="pointer-events-none absolute -top-6 z-10 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-[10px] text-white"
          style={{ left: `${(x(hover) / W) * 100}%` }}
        >
          {hover === 0 ? "Старт" : `${Math.ceil(hover / 2)}${hover % 2 ? "." : "…"} ${moves[hover - 1]?.san ?? ""}`} · {winSeries[hover].toFixed(0)}%
        </div>
      )}
    </div>
  );
}
