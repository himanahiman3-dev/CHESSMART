"use client";

import { useEffect, useRef } from "react";
import type { GameMove, MoveReview } from "@/lib/types";
import { ClassBadge } from "./ClassBadge";

interface Props {
  game: GameMove[];
  moves: (MoveReview | null)[];
  ply: number;
  onSelect: (ply: number) => void;
  startNumber: number;
}

export function MoveList({ game, moves, ply, onSelect, startNumber }: Props) {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [ply]);

  // Build rows of (white, black)
  const rows: { no: number; w?: number; b?: number }[] = [];
  game.forEach((m, i) => {
    const idx = i + 1;
    const last = rows[rows.length - 1];
    if (m.color === "w") rows.push({ no: startNumber + rows.length, w: idx });
    else if (last && last.w !== undefined && last.b === undefined) last.b = idx;
    else rows.push({ no: startNumber + rows.length, b: idx });
  });

  const cell = (idx?: number) => {
    if (!idx) return <div />;
    const mv = game[idx - 1];
    const rv = moves[idx - 1];
    const active = idx === ply;
    return (
      <button
        ref={active ? activeRef : undefined}
        onClick={() => onSelect(idx)}
        className={`flex items-center gap-1.5 rounded px-2 py-1 text-left text-sm font-semibold transition-colors ${
          active ? "bg-[#4b4947] text-white ring-1 ring-[#81b64c]" : "text-[#d3d2d0] hover:bg-[#3a3835]"
        }`}
      >
        {rv ? <ClassBadge cls={rv.classification} size={17} /> : <span className="h-[17px] w-[17px] animate-pulse rounded-full bg-[#4b4947]" />}
        <span>{mv.san}</span>
      </button>
    );
  };

  return (
    <div className="max-h-[420px] overflow-y-auto rounded-md bg-[#262421] p-1.5 pr-1">
      {rows.map((r) => (
        <div key={r.no} className="grid grid-cols-[34px_1fr_1fr] items-center odd:bg-[#2b2926]">
          <span className="pl-2 text-xs text-[#8b8987]">{r.no}.</span>
          {cell(r.w)}
          {cell(r.b)}
        </div>
      ))}
      {rows.length === 0 && <p className="p-3 text-sm text-[#8b8987]">No moves – this is a position-only analysis.</p>}
    </div>
  );
}
