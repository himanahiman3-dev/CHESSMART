import { useEffect, useRef } from "react";
import type { GameReview } from "../types";
import { ClsBadge } from "./ClsBadge";
import { sanRu } from "../lib/format";

export function MovesTab({ review, ply, onSeek }: { review: GameReview; ply: number; onSeek: (p: number) => void }) {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [ply]);

  const rows: number[] = [];
  const startsBlack = review.moves[0]?.color === "b";
  for (let i = startsBlack ? -1 : 0; i < review.moves.length; i += 2) rows.push(i);

  const cell = (idx: number) => {
    const m = review.moves[idx];
    if (!m) return <div />;
    const active = ply === idx + 1;
    return (
      <button
        ref={active ? activeRef : undefined}
        onClick={() => onSeek(idx + 1)}
        className={`flex items-center gap-1.5 rounded px-2 py-1 text-left text-sm font-semibold transition ${
          active ? "bg-[#4b4844] text-white" : "text-[#dcdbd7] hover:bg-[#35322e]"
        }`}
      >
        <ClsBadge cls={m.cls} size={16} />
        <span>{sanRu(m.san)}</span>
      </button>
    );
  };

  const firstNum = parseInt((review.headers.FEN ?? "").split(" ")[5] ?? "1", 10) || 1;
  return (
    <div className="max-h-[420px] overflow-y-auto rounded-lg bg-[#2b2926] p-1.5">
      {rows.map((start, r) => (
        <div key={r} className="grid grid-cols-[34px_1fr_1fr] items-center">
          <span className="pl-1 text-xs tabular-nums text-[#7d7b78]">{firstNum + r}.</span>
          {cell(start)}
          {cell(start + 1)}
        </div>
      ))}
    </div>
  );
}
