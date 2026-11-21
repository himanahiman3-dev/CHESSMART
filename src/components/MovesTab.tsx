import { useEffect, useMemo, useRef, useState } from "react";
import type { GameReview, Cls } from "../types";
import { ClsBadge } from "./ClsBadge";
import { sanRu } from "../lib/format";

type MoveFilter = "all" | "mistakes" | "brilliant" | "book";

const isMistake = (cls: Cls) => cls === "inaccuracy" || cls === "mistake" || cls === "miss" || cls === "blunder";

export function MovesTab({ review, ply, onSeek }: { review: GameReview; ply: number; onSeek: (p: number) => void }) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const [filter, setFilter] = useState<MoveFilter>("all");
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return (move: GameReview["moves"][number], index: number) => {
      const filterMatch = filter === "all"
        || (filter === "mistakes" && isMistake(move.cls))
        || (filter === "brilliant" && move.cls === "brilliant")
        || (filter === "book" && move.cls === "book")
      const number = `${Math.floor(index / 2) + 1}${move.color === "b" ? "…" : "."}`;
      const queryMatch = !q
        || sanRu(move.san).toLocaleLowerCase().includes(q)
        || move.san.toLocaleLowerCase().includes(q)
        || number.includes(q)
        || move.comment.toLocaleLowerCase().includes(q);
      return filterMatch && queryMatch;
    };
  }, [filter, query]);

  const visibleIndices = useMemo(
    () => review.moves.map((move, index) => ({ move, index })).filter(({ move, index }) => matches(move, index)).map(({ index }) => index),
    [review.moves, matches]
  );

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [ply, filter, query]);

  const rows = useMemo(() => {
    const startsBlack = review.moves[0]?.color === "b";
    const starts: number[] = [];
    for (let i = startsBlack ? -1 : 0; i < review.moves.length; i += 2) {
      if (visibleIndices.some((index) => index === i || index === i + 1)) starts.push(i);
    }
    return starts;
  }, [review.moves, visibleIndices]);

  const visibleSet = useMemo(() => new Set(visibleIndices), [visibleIndices]);

  const cell = (idx: number) => {
    const m = review.moves[idx];
    if (!m || !visibleSet.has(idx)) return <div key={idx} />;
    const active = ply === idx + 1;
    return (
      <button
        key={idx}
        ref={active ? activeRef : undefined}
        onClick={() => onSeek(idx + 1)}
        aria-current={active ? "step" : undefined}
        className={`flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm font-semibold transition ${
          active ? "bg-[#4b4844] text-white ring-1 ring-[#81b64c]/60" : "text-[#dcdbd7] hover:bg-[#35322e]"
        }`}
      >
        <ClsBadge cls={m.cls} size={16} />
        <span className="truncate">{sanRu(m.san)}</span>
      </button>
    );
  };

  const firstNum = Math.max(1, Number.parseInt((review.startFen ?? review.headers.FEN ?? "").split(" ")[5] ?? "1", 10) || 1);
  const counts = {
    mistakes: review.moves.filter((move) => isMistake(move.cls)).length,
    brilliant: review.moves.filter((move) => move.cls === "brilliant").length,
    book: review.moves.filter((move) => move.cls === "book").length,
  };

  const filters: { id: MoveFilter; label: string; count?: number }[] = [
    { id: "all", label: "Все", count: review.moves.length },
    { id: "mistakes", label: "Ошибки", count: counts.mistakes },
    { id: "brilliant", label: "Brilliant", count: counts.brilliant },
    { id: "book", label: "Дебют", count: counts.book },
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1 rounded-lg bg-[#1f1d1b] p-1">
        {filters.map((item) => (
          <button
            key={item.id}
            onClick={() => setFilter(item.id)}
            className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-bold transition ${
              filter === item.id ? "bg-[#4b4844] text-white" : "text-[#a7a6a2] hover:text-white"
            }`}
          >
            {item.label} <span className="opacity-60">{item.count}</span>
          </button>
        ))}
      </div>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Найти ход, номер или комментарий…"
        aria-label="Поиск по ходам и комментариям"
        className="w-full rounded-lg border border-[#3d3a37] bg-[#1f1d1b] px-3 py-2 text-xs text-white outline-none placeholder:text-[#77746f] focus:border-[#81b64c]"
      />
      <div className="flex items-center justify-between px-1 text-[10px] text-[#77746f]">
        <span>Показано {visibleIndices.length} из {review.moves.length} полуходов</span>
        {(filter !== "all" || query) && <button onClick={() => { setFilter("all"); setQuery(""); }} className="font-bold text-[#a3d160] hover:text-white">Сбросить фильтр</button>}
      </div>
      <div className="max-h-[420px] overflow-y-auto rounded-lg bg-[#2b2926] p-1.5">
        {rows.length ? rows.map((start, rowIndex) => (
          <div key={start} className="grid grid-cols-[34px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-0.5">
            <span className="pl-1 text-xs tabular-nums text-[#7d7b78]">{firstNum + rowIndex}.</span>
            {cell(start)}
            {cell(start + 1)}
          </div>
        )) : <div className="px-3 py-10 text-center text-xs text-[#85827b]">Подходящих ходов не найдено.</div>}
      </div>
    </div>
  );
}
