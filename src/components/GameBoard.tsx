import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard, defaultArrowOptions } from "react-chessboard";
import type { Cls } from "../types";
import { ClsBadge } from "./ClsBadge";
import { CLS_META } from "../types";

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
  /** Меняйте при каждом переходе к ходу — по смене ключа анимация проигрывается заново. */
  animKey?: number;
  /** Визуальная тема клеток доски. */
  theme?: BoardTheme;
}

export type BoardTheme = "classic" | "blue" | "walnut" | "violet";

const BOARD_PALETTES: Record<BoardTheme, { light: string; dark: string; accent: string }> = {
  classic: { light: "#ebecd0", dark: "#779556", accent: "#a3d160" },
  blue: { light: "#e8edf5", dark: "#6b83a5", accent: "#8fb5e8" },
  walnut: { light: "#ead7ba", dark: "#9a6748", accent: "#d9aa72" },
  violet: { light: "#ece4f4", dark: "#856a9b", accent: "#c19cde" },
};

/** Ходы, у которых значок появляется с анимацией (как на Chess.com): клетка окрашивается, затем «выпрыгивает» значок. */
const ANIMATED: Cls[] = ["brilliant", "great"];

function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** Искры вокруг значка «блестящего» хода: смещение в единицах cqw (1% ширины доски). */
const SPARKS = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
  const r = i % 2 ? 4.2 : 6.2;
  return { dx: +(Math.cos(a) * r).toFixed(2), dy: +(Math.sin(a) * r).toFixed(2), delay: 0.42 + (i % 4) * 0.04, big: i % 2 === 0 };
});

/** Положение клетки на доске в процентах (с учётом ориентации). */
function squareOrigin(square: string, orientation: "white" | "black") {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1], 10) - 1;
  const col = orientation === "white" ? file : 7 - file;
  const row = orientation === "white" ? 7 - rank : rank;
  return { left: col * 12.5, top: row * 12.5 };
}

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
  animKey = 0,
  theme = "classic",
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
    const animated = badge && ANIMATED.includes(badge.cls) ? badge : null;
    if (lastMove) {
      s[lastMove.from] = { background: "rgba(255, 235, 59, 0.45)" };
      // у «блестящего»/«отличного» хода клетка назначения красится цветом класса, а не жёлтым
      if (!(animated && animated.square === lastMove.to)) s[lastMove.to] = { background: "rgba(255, 235, 59, 0.55)" };
    }
    if (animated) {
      // две одинаковые анимации (a/b) чередуются: так она перезапускается, даже если клетка та же, что и в прошлый раз
      const vars = { "--c": hexToRgb(CLS_META[animated.cls].color), animation: `cls-tint-${animKey % 2 ? "a" : "b"} 0.95s ease-out forwards` } as CSSProperties;
      s[animated.square] = { ...(s[animated.square] ?? {}), ...vars };
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
  }, [lastMove, selected, chess, extraSquareStyles, badge?.square, badge?.cls, animKey]);

  const chessArrows = useMemo(
    () => arrows.map((a) => ({ startSquare: a.from, endSquare: a.to, color: a.color })),
    [arrows]
  );

  return (
    <div className="relative aspect-square w-full select-none rounded-[4px] shadow-xl shadow-black/40" style={{ containerType: "inline-size" }}>
      <Chessboard
        options={{
          id: "review-board",
          position: fen,
          boardOrientation: orientation,
          darkSquareStyle: { backgroundColor: BOARD_PALETTES[theme].dark },
          lightSquareStyle: { backgroundColor: BOARD_PALETTES[theme].light },
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
            </div>
          ),
        }}
      />
      {badge && <BadgeOverlay badge={badge} orientation={orientation} animKey={animKey} />}
    </div>
  );
}

/** Значок класса хода поверх доски. Для brilliant/great — анимация: вспышка клетки → «выпрыгивание» значка → кольца и искры. */
function BadgeOverlay({ badge, orientation, animKey }: { badge: { square: string; cls: Cls }; orientation: "white" | "black"; animKey: number }) {
  const { left, top } = squareOrigin(badge.square, orientation);
  // значок: 36% клетки, сдвинут к правому верхнему углу (как и раньше)
  const box: CSSProperties = {
    left: `${left + 9.125}%`,
    top: `${top - 1.125}%`,
    width: "4.5%",
    height: "4.5%",
    ...({ "--c": hexToRgb(CLS_META[badge.cls].color) } as CSSProperties),
  };
  const badgeStyle: CSSProperties = { width: "100%", height: "100%", fontSize: "calc(100cqw / 8 * 0.21)" };
  const animated = ANIMATED.includes(badge.cls);
  const brilliant = badge.cls === "brilliant";
  return (
    <div className="pointer-events-none absolute z-30" style={box}>
      {animated ? (
        <div key={animKey} className="relative h-full w-full">
          <span className="cls-ring" />
          {brilliant && <span className="cls-ring cls-ring-2" />}
          <div className="cls-pop relative h-full w-full">
            <ClsBadge cls={badge.cls} style={badgeStyle} />
            {brilliant && <span className="cls-shine" />}
          </div>
          {brilliant &&
            SPARKS.map((p, i) => (
              <span
                key={i}
                className={`cls-spark ${p.big ? "cls-spark-big" : ""}`}
                style={{ "--dx": p.dx, "--dy": p.dy, animationDelay: `${p.delay}s` } as CSSProperties}
              />
            ))}
        </div>
      ) : (
        <ClsBadge cls={badge.cls} style={badgeStyle} />
      )}
    </div>
  );
}
