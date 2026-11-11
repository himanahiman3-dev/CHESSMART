import { useEffect, useRef } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Key } from "chessground/types";
import { Chess } from "chess.js";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.cburnett.css";
import type { Cat } from "../lib/analysis";
import { CatIcon } from "./parts";

interface Props {
  fen: string;
  orientation: "white" | "black";
  lastMove?: [string, string] | null;
  arrow?: { from: string; to: string } | null;
  badge?: { square: string; cat: Cat } | null;
  onSwipe?: (dir: -1 | 1) => void;
}

export default function Board({ fen, orientation, lastMove, arrow, badge, onSwipe }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!host.current) return;
    api.current = Chessground(host.current, {
      fen,
      orientation,
      viewOnly: true,
      coordinates: false,
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      drawable: { enabled: false, visible: true },
    });
    const ro = new ResizeObserver(() => api.current?.redrawAll());
    ro.observe(host.current);
    return () => {
      ro.disconnect();
      api.current?.destroy();
      api.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let check = false;
    let turn: "white" | "black" = "white";
    try {
      const c = new Chess(fen);
      check = c.inCheck();
      turn = c.turn() === "w" ? "white" : "black";
    } catch {
      /* ignore */
    }
    api.current?.set({
      fen,
      orientation,
      turnColor: turn,
      check,
      lastMove: lastMove ? (lastMove as Key[]) : undefined,
      drawable: {
        enabled: false,
        visible: true,
        autoShapes: arrow
          ? [{ orig: arrow.from as Key, dest: arrow.to as Key, brush: "green" }]
          : [],
      },
    });
  }, [fen, orientation, lastMove, arrow]);

  const pos = badge
    ? (() => {
        const file = badge.square.charCodeAt(0) - 97;
        const rank = +badge.square[1] - 1;
        const col = orientation === "white" ? file : 7 - file;
        const row = orientation === "white" ? 7 - rank : rank;
        return { left: col * 12.5, top: row * 12.5 };
      })()
    : null;

  return (
    <div
      className="board-wrap relative aspect-square w-full select-none"
      onTouchStart={(e) => {
        const t = e.touches[0];
        touch.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const s = touch.current;
        touch.current = null;
        if (!s || !onSwipe) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - s.x;
        const dy = t.clientY - s.y;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 1 : -1);
      }}
    >
      <div ref={host} className="board-host" />
      <div className="pointer-events-none absolute inset-0 z-10">
        {Array.from({ length: 8 }, (_, i) => {
          const rankLabel = orientation === "white" ? 8 - i : i + 1;
          const fileLabel = "abcdefgh"[orientation === "white" ? i : 7 - i];
          const rankDark = i % 2 === 1;
          const fileDark = (i + 7) % 2 === 1;
          return (
            <span key={i}>
              <span
                className="coord-label absolute"
                style={{ left: "0.5%", top: `${i * 12.5 + 0.6}%`, color: rankDark ? "#ebecd0" : "#779556" }}
              >
                {rankLabel}
              </span>
              <span
                className="coord-label absolute"
                style={{ left: `${i * 12.5 + 10.2}%`, top: "87.5%", marginTop: "9.4%", color: fileDark ? "#ebecd0" : "#779556" }}
              >
                {fileLabel}
              </span>
            </span>
          );
        })}
      </div>
      {badge && pos && (
        <div
          className="pointer-events-none absolute z-20"
          style={{ left: `${pos.left}%`, top: `${pos.top}%`, width: "12.5%", height: "12.5%" }}
        >
          <CatIcon
            cat={badge.cat}
            className="absolute shadow-[0_1px_4px_rgba(0,0,0,.45)] ring-[1.5px] ring-white/90"
            style={{
              width: "46%",
              height: "46%",
              right: "-9%",
              top: "-9%",
              fontSize: "min(2.6vw, 17px)",
            }}
          />
        </div>
      )}
    </div>
  );
}
