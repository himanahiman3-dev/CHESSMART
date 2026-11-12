import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard, defaultArrowOptions } from "react-chessboard";
import type { Cls } from "../types";
import { ClsBadge } from "./ClsBadge";

export interface BoardArrow {
  from: string;
  to: string;
  color: string;
}

export interface BoardMove {
  from: string;
  to: string;
  san: string;
  uci: string;
  fenAfter: string;
}

interface Props {
  fen: string;
  orientation: "white" | "black";
  lastMove?: { from: string; to: string } | null;
  badge?: { square: string; cls: Cls } | null;
  arrows?: BoardArrow[];
  interactive?: boolean;
  allowedColor?: "w" | "b" | null;
  /** вернуть true, чтобы принять ход (позиция обновляется снаружи) */
  onMove?: (m: BoardMove) => boolean;
  extraSquareStyles?: Record<string, CSSProperties>;
}

const LIGHT = "#ebecd0";
const DARK = "#779556";

export function GameBoard({
  fen,
  orientation,
  lastMove,
  badge,
  arrows = [],
  interactive = false,
  allowedColor = null,
  onMove,
  extraSquareStyles,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => setSelected(null), [fen, interactive]);

  const chess = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return null;
    }
  }, [fen]);

  const turn = chess?.turn();
  const canMoveColor = useCallback((c: string) => interactive && !!turn && c === turn && (!allowedColor || allowedColor === c), [interactive, turn, allowedColor]);

  const tryMove = useCallback(
    (from: string, to: string): boolean => {
      if (!chess || !onMove) return false;
      try {
        const piece = chess.get(from as Square);
        if (!piece || !canMoveColor(piece.color)) return false;
        const isPromo = piece.type === "p" && (to[1] === "8" || to[1] === "1");
        const mv = chess.move({ from: from as Square, to: to as Square, promotion: isPromo ? "q" : undefined });
        const after = chess.fen();
        chess.undo();
        return onMove({ from, to, san: mv.san, uci: from + to + (mv.promotion ?? ""), fenAfter: after });
      } catch {
        return false;
      }
    },
    [chess, onMove, canMoveColor]
  );

  const squareStyles = useMemo(() => {
    const s: Record<string, CSSProperties> = {};
    if (lastMove) {
      s[lastMove.from] = { background: "rgba(255, 235, 59, 0.45)" };
      s[lastMove.to] = { background: "rgba(255, 235, 59, 0.55)" };
    }
    if (selected && chess) {
      s[selected] = { ...(s[selected] ?? {}), background: "rgba(20, 130, 200, 0.5)" };
      for (const m of chess.moves({ square: selected as Square, verbose: true })) {
        s[m.to] = {
          ...(s[m.to] ?? {}),
          background: m.captured
            ? "radial-gradient(transparent 0%, transparent 79%, rgba(20,85,30,0.5) 80%)"
            : "radial-gradient(rgba(20,85,30,0.5) 19%, transparent 20%)",
        };
      }
    }
    if (extraSquareStyles) for (const [k, v] of Object.entries(extraSquareStyles)) s[k] = { ...(s[k] ?? {}), ...v };
    return s;
  }, [lastMove, selected, chess, extraSquareStyles]);

  const chessArrows = useMemo(
    () => arrows.map((a) => ({ startSquare: a.from, endSquare: a.to, color: a.color })),
    [arrows]
  );

  return (
    <div className="aspect-square w-full select-none rounded-[4px] shadow-xl shadow-black/40" style={{ containerType: "inline-size" }}>
      <Chessboard
        options={{
          id: "review-board",
          position: fen,
          boardOrientation: orientation,
          darkSquareStyle: { backgroundColor: DARK },
          lightSquareStyle: { backgroundColor: LIGHT },
          animationDurationInMs: 180,
          showAnimations: true,
          allowDragging: interactive,
          allowDrawingArrows: true,
          clearArrowsOnClick: true,
          arrows: chessArrows,
          arrowOptions: { ...defaultArrowOptions, opacity: 0.8, arrowWidthDenominator: 6.5 },
          canDragPiece: ({ piece }) => canMoveColor(piece.pieceType[0] === "w" ? "w" : "b"),
          onPieceDrop: ({ sourceSquare, targetSquare }) => {
            if (!targetSquare) return false;
            setSelected(null);
            return tryMove(sourceSquare, targetSquare);
          },
          onSquareClick: ({ square, piece }) => {
            if (!interactive || !chess) return;
            if (selected && selected !== square) {
              const legal = chess.moves({ square: selected as Square, verbose: true }).some((m) => m.to === square);
              if (legal) {
                setSelected(null);
                tryMove(selected, square);
                return;
              }
            }
            if (piece && canMoveColor(piece.pieceType[0] === "w" ? "w" : "b")) setSelected(selected === square ? null : square);
            else setSelected(null);
          },
          squareStyles,
          squareRenderer: ({ square, children }) => (
            <div style={{ position: "relative", width: "100%", height: "100%", ...squareStyles[square] }}>
              {children}
              {badge && badge.square === square && (
                <div className="pointer-events-none absolute z-20" style={{ top: "-9%", right: "-9%", width: "36%", height: "36%" }}>
                  <ClsBadge cls={badge.cls} style={{ width: "100%", height: "100%", fontSize: "calc(100cqw / 8 * 0.21)" }} />
                </div>
              )}
            </div>
          ),
        }}
      />
    </div>
  );
}
