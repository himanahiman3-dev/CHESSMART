"use client";

import { Chessboard } from "react-chessboard";
import type { Classification } from "@/lib/types";
import { CLASS_META } from "@/lib/winrate";
import { SquareBadge } from "./ClassBadge";

interface Props {
  fen: string;
  flipped: boolean;
  lastMove?: { from: string; to: string; cls?: Classification } | null;
  bestMove?: { from: string; to: string } | null;
  extraArrows?: { from: string; to: string; color: string }[];
}

export function BoardView({ fen, flipped, lastMove, bestMove, extraArrows = [] }: Props) {
  const squareStyles: Record<string, React.CSSProperties> = {};
  if (lastMove) {
    const tint = lastMove.cls ? hexToRgba(CLASS_META[lastMove.cls].color, 0.5) : "rgba(247,198,49,0.4)";
    squareStyles[lastMove.from] = { background: tint };
    squareStyles[lastMove.to] = { background: tint };
  }

  const arrows = [
    ...(bestMove ? [{ startSquare: bestMove.from, endSquare: bestMove.to, color: "rgba(129,182,76,0.9)" }] : []),
    ...extraArrows.map((a) => ({ startSquare: a.from, endSquare: a.to, color: a.color })),
  ];

  return (
    <div className="w-full overflow-hidden rounded-sm shadow-xl shadow-black/40">
      <Chessboard
        options={{
          id: "review-board",
          position: fen,
          boardOrientation: flipped ? "black" : "white",
          allowDragging: false,
          allowDrawingArrows: true,
          clearArrowsOnClick: true,
          arrows,
          squareStyles,
          animationDurationInMs: 180,
          lightSquareStyle: { backgroundColor: "#ebecd0" },
          darkSquareStyle: { backgroundColor: "#739552" },
          lightSquareNotationStyle: { color: "#739552", fontWeight: 700 },
          darkSquareNotationStyle: { color: "#ebecd0", fontWeight: 700 },
          squareRenderer: ({ square, children }) => (
            <div style={{ position: "relative", width: "100%", height: "100%" }}>
              {children}
              {lastMove?.cls && square === lastMove.to ? <SquareBadge cls={lastMove.cls} /> : null}
            </div>
          ),
        }}
      />
    </div>
  );
}

function hexToRgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
