"use client";

import { evalWhiteWr } from "@/lib/review";
import type { MoveReview, PositionEval } from "@/lib/types";
import { CLASS_META } from "@/lib/winrate";

interface Props {
  evals: (PositionEval | null)[];
  moves: (MoveReview | null)[];
  ply: number;
  onSelect: (ply: number) => void;
}

const W = 400;
const H = 90;

export function EvalGraph({ evals, moves, ply, onSelect }: Props) {
  const n = Math.max(1, evals.length - 1);
  const xs = (i: number) => (i / n) * W;
  const pts: { x: number; y: number }[] = [];
  evals.forEach((e, i) => {
    const wr = evalWhiteWr(e);
    if (wr !== null) pts.push({ x: xs(i), y: H - (wr / 100) * H });
  });
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = pts.length > 1 ? `${line} L${pts[pts.length - 1].x.toFixed(1)},${H} L${pts[0].x.toFixed(1)},${H} Z` : "";

  const handle = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSelect(Math.max(0, Math.min(evals.length - 1, Math.round(ratio * n))));
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-24 w-full cursor-pointer rounded-md bg-[#3c3a37]"
      preserveAspectRatio="none"
      onClick={handle}
      role="img"
      aria-label="Evaluation graph"
    >
      {area && <path d={area} fill="#e8e8e4" opacity={0.92} />}
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="#81b64c" strokeOpacity={0.5} strokeWidth="0.6" />
      {line && <path d={line} fill="none" stroke="#fff" strokeWidth="1" />}
      {moves.map((m, i) => {
        if (!m || !pts.length) return null;
        if (!["brilliant", "great", "mistake", "blunder"].includes(m.classification)) return null;
        const wr = evalWhiteWr(evals[i + 1]);
        if (wr === null) return null;
        return <circle key={i} cx={xs(i + 1)} cy={H - (wr / 100) * H} r={2.6} fill={CLASS_META[m.classification].color} stroke="#fff" strokeWidth="0.6" />;
      })}
      <line x1={xs(ply)} x2={xs(ply)} y1="0" y2={H} stroke="#f7c631" strokeWidth="1.2" />
    </svg>
  );
}
