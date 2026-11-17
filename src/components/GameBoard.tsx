import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard, defaultArrowOptions } from "react-chessboard";
import type { Cls } from "../types";
import { ClsBadge } from "./ClsBadge";
import { CLS_META } from "../types";
import { createPremove, getPremoveMoves, type Premove } from "../lib/premoves";
import type { GameBoardTheme } from "../lib/gameplayPreferences";

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
  /** Разрешает поставить один ход на следующую очередь, пока ходит соперник. */
  premoveEnabled?: boolean;
  premove?: Premove | null;
  onPremove?: (move: Premove) => void;
  onClearPremove?: () => void;
  showLegalMoves?: boolean;
  highlightLastMove?: boolean;
  animations?: boolean;
  autoQueen?: boolean;
}

export type BoardTheme = GameBoardTheme;

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
  premoveEnabled = false,
  premove = null,
  onPremove,
  onClearPremove,
  showLegalMoves = true,
  highlightLastMove = true,
  animations = true,
  autoQueen = true,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [promotionDraft, setPromotionDraft] = useState<{ from: string; to: string } | null>(null);

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
  const canPremoveColor = useCallback(
    (c: string) => premoveEnabled && !!turn && !!allowedColor && c === allowedColor && turn !== allowedColor,
    [premoveEnabled, turn, allowedColor]
  );
  const selectedPremoveMoves = useMemo(
    () => selected && allowedColor && canPremoveColor(allowedColor)
      ? getPremoveMoves(fen, allowedColor, selected)
      : [],
    [fen, selected, allowedColor, canPremoveColor]
  );
  const selectOrQueuePremove = useCallback((from: string, to: string): boolean => {
    if (!allowedColor || !onPremove) return false;
    const candidates = getPremoveMoves(fen, allowedColor, from).filter((move) => move.to === to);
    if (!candidates.length) return false;
    if (candidates.some((move) => move.promotion) && !autoQueen) {
      setPromotionDraft({ from, to });
      return true;
    }
    const candidate = createPremove(fen, allowedColor, from, to, "q");
    if (!candidate) return false;
    onPremove(candidate);
    return true;
  }, [fen, allowedColor, onPremove, autoQueen]);

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
    if (lastMove && highlightLastMove) {
      // Спокойные контрастные оттенки: откуда ушла фигура — холодный,
      // куда пришла — мягкий зелёный. Без кислотного жёлтого.
      s[lastMove.from] = {
        background: "rgba(91, 153, 190, 0.38)",
        boxShadow: "inset 0 0 0 2px rgba(70, 132, 174, 0.32)",
      };
      // Не перекрываем цвет значка brilliant/great на клетке назначения.
      if (!(animated && animated.square === lastMove.to)) {
        s[lastMove.to] = {
          background: "rgba(145, 190, 91, 0.48)",
          boxShadow: "inset 0 0 0 2px rgba(111, 157, 67, 0.38)",
        };
      }
    }
    if (animated) {
      // две одинаковые анимации (a/b) чередуются: так она перезапускается, даже если клетка та же, что и в прошлый раз
      const vars = { "--c": hexToRgb(CLS_META[animated.cls].color), animation: `cls-tint-${animKey % 2 ? "a" : "b"} 0.95s ease-out forwards` } as CSSProperties;
      s[animated.square] = { ...(s[animated.square] ?? {}), ...vars };
    }
    if (selected && chess) {
      const selectedIsPremove = selectedPremoveMoves.length > 0;
      s[selected] = {
        ...(s[selected] ?? {}),
        background: selectedIsPremove ? "rgba(220, 62, 62, 0.42)" : "rgba(20, 130, 200, 0.5)",
        boxShadow: selectedIsPremove ? "inset 0 0 0 3px rgba(220,62,62,.9)" : undefined,
      };
      const destinations = selectedIsPremove
        ? selectedPremoveMoves.map((move) => ({ to: move.to, captured: !!chess.get(move.to) }))
        : showLegalMoves && canMoveColor(chess.get(selected as Square)?.color ?? "")
          ? chess.moves({ square: selected as Square, verbose: true })
          : [];
      for (const move of destinations) {
        s[move.to] = {
          ...(s[move.to] ?? {}),
          background: selectedIsPremove
            ? "radial-gradient(rgba(220,62,62,.72) 17%, transparent 19%)"
            : move.captured
              ? "radial-gradient(transparent 0%, transparent 79%, rgba(20,85,30,0.5) 80%)"
              : "radial-gradient(rgba(20,85,30,0.5) 19%, transparent 20%)",
        };
      }
    }
    if (premove) {
      s[premove.from] = { ...(s[premove.from] ?? {}), background: "rgba(220,62,62,.38)", boxShadow: "inset 0 0 0 3px rgba(220,62,62,.9)" };
      s[premove.to] = { ...(s[premove.to] ?? {}), background: "rgba(220,62,62,.22)", boxShadow: "inset 0 0 0 3px rgba(220,62,62,.75)" };
    }
    if (extraSquareStyles) for (const [k, v] of Object.entries(extraSquareStyles)) s[k] = { ...(s[k] ?? {}), ...v };
    return s;
  }, [lastMove, highlightLastMove, selected, chess, extraSquareStyles, badge?.square, badge?.cls, animKey, premove, selectedPremoveMoves, showLegalMoves, canMoveColor]);

  const chessArrows = useMemo(() => [
    ...arrows.map((a) => ({ startSquare: a.from, endSquare: a.to, color: a.color })),
    ...(premove ? [{ startSquare: premove.from, endSquare: premove.to, color: "rgba(230,65,65,.95)" }] : []),
  ], [arrows, premove]);

  useEffect(() => {
    if (!premove || !onClearPremove) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPromotionDraft(null);
        onClearPremove();
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [premove, onClearPremove]);

  return (
    <div
      className="relative aspect-square w-full select-none rounded-[4px] shadow-xl shadow-black/40"
      style={{ containerType: "inline-size" }}
      onContextMenu={(event) => {
        if (!premove || !onClearPremove) return;
        event.preventDefault();
        setPromotionDraft(null);
        onClearPremove();
        setSelected(null);
      }}
    >
      <Chessboard
        options={{
          id: "review-board",
          position: fen,
          boardOrientation: orientation,
          darkSquareStyle: { backgroundColor: BOARD_PALETTES[theme].dark },
          lightSquareStyle: { backgroundColor: BOARD_PALETTES[theme].light },
          animationDurationInMs: animations ? 180 : 0,
          showAnimations: animations,
          allowDragging: interactive || premoveEnabled,
          allowDrawingArrows: true,
          clearArrowsOnClick: true,
          arrows: chessArrows,
          arrowOptions: { ...defaultArrowOptions, opacity: 0.8, arrowWidthDenominator: 6.5 },
          canDragPiece: ({ piece }) => {
            const color = piece.pieceType[0] === "w" ? "w" : "b";
            return canMoveColor(color) || canPremoveColor(color);
          },
          onPieceDrop: ({ sourceSquare, targetSquare }) => {
            if (!targetSquare || !chess) return false;
            setSelected(null);
            const piece = chess.get(sourceSquare as Square);
            if (piece && canPremoveColor(piece.color)) return selectOrQueuePremove(sourceSquare, targetSquare);
            return tryMove(sourceSquare, targetSquare);
          },
          onSquareClick: ({ square, piece }) => {
            if (!chess) return;
            if (premove && square === premove.from && onClearPremove) {
              onClearPremove();
              setSelected(null);
              return;
            }
            if (selected && selected !== square) {
              const movingPiece = chess.get(selected as Square);
              if (movingPiece && canPremoveColor(movingPiece.color)) {
                if (selectedPremoveMoves.some((move) => move.to === square)) {
                  selectOrQueuePremove(selected, square);
                  setSelected(null);
                  return;
                }
              } else {
                const legal = chess.moves({ square: selected as Square, verbose: true }).some((move) => move.to === square);
                if (legal) {
                  setSelected(null);
                  tryMove(selected, square);
                  return;
                }
              }
            }
            if (piece) {
              const color = piece.pieceType[0] === "w" ? "w" : "b";
              if (canMoveColor(color) || canPremoveColor(color)) {
                setSelected(selected === square ? null : square);
                return;
              }
            }
            setSelected(null);
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
      {promotionDraft && allowedColor && (
        <div className="absolute inset-0 z-40 flex items-center justify-center rounded-md bg-black/55">
          <div className="rounded-xl border border-white/15 bg-[#20231d] p-3 shadow-2xl">
            <div className="mb-2 text-center text-xs font-bold text-white">Выбери превращение premove</div>
            <div className="flex gap-2">
              {(["q", "r", "b", "n"] as const).map((piece) => (
                <button
                  key={piece}
                  type="button"
                  aria-label={piece === "q" ? "Ферзь" : piece === "r" ? "Ладья" : piece === "b" ? "Слон" : "Конь"}
                  onClick={() => {
                    const chosen = createPremove(fen, allowedColor, promotionDraft.from, promotionDraft.to, piece);
                    if (chosen) onPremove?.(chosen);
                    setPromotionDraft(null);
                    setSelected(null);
                  }}
                  className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#38432e] text-2xl text-white hover:bg-[#50643e]"
                >
                  {piece === "q" ? "♕" : piece === "r" ? "♖" : piece === "b" ? "♗" : "♘"}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setPromotionDraft(null)} className="mt-2 w-full rounded-md border border-white/15 px-3 py-1.5 text-[10px] font-bold text-[#bbb]">Отмена</button>
          </div>
        </div>
      )}
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
