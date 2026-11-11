import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Star,
  ThumbsUp,
} from "lucide-react";
import {
  CAT_COLOR,
  CAT_LABEL,
  CAT_LABEL_PLURAL,
  CAT_ORDER,
  formatEval,
  winPct,
  type Cat,
  type MoveInfo,
  type PosEval,
  type Review,
} from "../lib/analysis";
import { cn } from "../utils/cn";

/* ---------- Иконка категории хода ---------- */
export function CatIcon({
  cat,
  className,
  style,
  size = 0,
}: {
  cat: Cat;
  className?: string;
  style?: CSSProperties;
  size?: number;
}) {
  const content: Record<Cat, ReactNode> = {
    brilliant: "!!",
    best: <Star size="62%" fill="currentColor" strokeWidth={0} />,
    excellent: <ThumbsUp size="58%" strokeWidth={2.6} />,
    good: <Check size="64%" strokeWidth={3.4} />,
    book: <BookOpen size="60%" strokeWidth={2.6} />,
    inaccuracy: "?!",
    mistake: "?",
    blunder: "??",
  };
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-extrabold leading-none text-white",
        className
      )}
      style={{
        background: CAT_COLOR[cat],
        ...(size ? { width: size, height: size, fontSize: size * 0.5 } : {}),
        ...style,
      }}
    >
      {content[cat]}
    </div>
  );
}

/* ---------- Полоса оценки ---------- */
export function EvalBar({
  value,
  mate,
  flipped,
  horizontal,
  className,
}: {
  value: number;
  mate: number | null;
  flipped: boolean;
  horizontal?: boolean;
  className?: string;
}) {
  const white =
    mate !== null || Math.abs(value) >= 9000
      ? value > 0
        ? 100
        : value < 0
          ? 0
          : 50
      : Math.max(3, Math.min(97, winPct(value)));
  const label = formatEval(value, mate).replace("-M", "M").replace("+", "");
  const whiteAhead = value >= 0;
  const text = whiteAhead ? "text-[#403d39]" : "text-white";

  if (horizontal) {
    return (
      <div className={cn("relative h-[18px] w-full overflow-hidden rounded-[3px] bg-[#403d39]", className)}>
        <div
          className="absolute inset-y-0 bg-white transition-[width] duration-500 ease-out"
          style={{ width: `${white}%`, [flipped ? "right" : "left"]: 0 }}
        />
        <span
          className={cn(
            "absolute top-1/2 -translate-y-1/2 text-[11px] font-bold tabular-nums",
            text,
            whiteAhead !== flipped ? "left-1.5" : "right-1.5"
          )}
        >
          {label}
        </span>
      </div>
    );
  }
  return (
    <div className={cn("relative w-[26px] shrink-0 overflow-hidden rounded-[3px] bg-[#403d39]", className)}>
      <div
        className="absolute inset-x-0 bg-white transition-[height] duration-500 ease-out"
        style={{ height: `${white}%`, [flipped ? "top" : "bottom"]: 0 }}
      />
      <span
        className={cn(
          "absolute left-0 right-0 text-center text-[11px] font-bold tabular-nums",
          text,
          whiteAhead !== flipped ? "bottom-1" : "top-1"
        )}
      >
        {label}
      </span>
    </div>
  );
}

/* ---------- График оценки ---------- */
export function EvalGraph({
  positions,
  moves,
  ply,
  onSelect,
  className,
}: {
  positions: PosEval[];
  moves: MoveInfo[];
  ply: number;
  onSelect: (i: number) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const n = positions.length - 1;
  const ys = positions.map((p) =>
    100 - (Math.abs(p.value) >= 9000 ? (p.value > 0 ? 100 : 0) : winPct(p.value))
  );
  const pts = ys.map((y, i) => `${(i / Math.max(1, n)) * 100},${y.toFixed(1)}`);
  const line = pts.join(" L");
  const area = `M0,100 L${line} L100,100 Z`;
  const pick = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    onSelect(Math.round(f * n));
  };
  return (
    <div
      ref={ref}
      className={cn(
        "relative h-20 w-full cursor-pointer touch-none overflow-hidden rounded-md bg-[#403d39]",
        className
      )}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        pick(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons || e.pointerType === "touch") pick(e.clientX);
      }}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <path d={area} fill="#f2f2f2" />
        <path
          d={`M${pts.join(" L")}`}
          fill="none"
          stroke="#bdbdbd"
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
        />
        <line x1="0" x2="100" y1="50" y2="50" stroke="#8b8987" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        <line
          x1={(ply / Math.max(1, n)) * 100}
          x2={(ply / Math.max(1, n)) * 100}
          y1="0"
          y2="100"
          stroke="#81b64c"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {moves.map((m, i) =>
        m.cat === "brilliant" || m.cat === "mistake" || m.cat === "blunder" ? (
          <span
            key={i}
            className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-black/40"
            style={{
              left: `${((i + 1) / Math.max(1, n)) * 100}%`,
              top: `${ys[i + 1]}%`,
              background: CAT_COLOR[m.cat],
            }}
          />
        ) : null
      )}
    </div>
  );
}

/* ---------- Список ходов (таблица) ---------- */
function MoveCell({ m, active, onClick }: { m?: MoveInfo; active: boolean; onClick: () => void }) {
  if (!m) return <div />;
  return (
    <button
      data-active={active || undefined}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded px-2 py-1.5 text-left text-[15px] font-semibold transition-colors",
        active ? "bg-[#4a4743] text-white" : "text-[#d5d3d1] hover:bg-[#3a3835]"
      )}
    >
      <CatIcon cat={m.cat} size={16} />
      <span className={cn(m.cat === "brilliant" && "text-[#35d3cc]", m.cat === "blunder" && "text-[#ff6b68]")}>
        {m.san}
      </span>
    </button>
  );
}

export function MoveList({
  moves,
  ply,
  onSelect,
  className,
}: {
  moves: MoveInfo[];
  ply: number;
  onSelect: (p: number) => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>("[data-active]");
    const c = box.current;
    if (!el || !c) return;
    const top = el.offsetTop - c.offsetTop;
    if (top < c.scrollTop + 20 || top > c.scrollTop + c.clientHeight - 50) {
      c.scrollTo({ top: top - c.clientHeight / 2, behavior: "smooth" });
    }
  }, [ply]);
  const rows = Math.ceil(moves.length / 2);
  return (
    <div ref={box} className={cn("relative overflow-y-auto", className)}>
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          className={cn("grid grid-cols-[34px_1fr_1fr] items-center", r % 2 === 0 ? "bg-[#2b2927]" : "bg-[#262421]")}
        >
          <div className="pl-2 text-[13px] font-semibold text-[#8b8987]">{r + 1}.</div>
          <MoveCell m={moves[r * 2]} active={ply === r * 2 + 1} onClick={() => onSelect(r * 2 + 1)} />
          <MoveCell m={moves[r * 2 + 1]} active={ply === r * 2 + 2} onClick={() => onSelect(r * 2 + 2)} />
        </div>
      ))}
    </div>
  );
}

/* ---------- Горизонтальная лента ходов (мобильная) ---------- */
export function MoveStrip({
  moves,
  ply,
  onSelect,
}: {
  moves: MoveInfo[];
  ply: number;
  onSelect: (p: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = box.current;
    const el = c?.querySelector<HTMLElement>("[data-active]");
    if (!c || !el) return;
    c.scrollTo({ left: el.offsetLeft - c.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
  }, [ply]);
  return (
    <div ref={box} className="no-scrollbar flex items-center gap-0.5 overflow-x-auto bg-[#21201d] px-2 py-1.5">
      {moves.map((m, i) => (
        <div key={i} className="flex shrink-0 items-center">
          {m.color === "w" && (
            <span className="pl-1.5 pr-0.5 text-[13px] font-semibold text-[#8b8987]">{Math.ceil(m.ply / 2)}.</span>
          )}
          <button
            data-active={ply === i + 1 || undefined}
            onClick={() => onSelect(i + 1)}
            className={cn(
              "flex items-center gap-1 rounded-md px-1.5 py-1 text-[15px] font-bold",
              ply === i + 1 ? "bg-[#4a4743] text-white" : "text-[#c9c7c5]"
            )}
          >
            <CatIcon cat={m.cat} size={14} />
            {m.san}
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------- Итоги ---------- */
export function SummaryCard({ review, className }: { review: Review; className?: string }) {
  const h = review.headers;
  const white = h.White && h.White !== "?" ? h.White : "Белые";
  const black = h.Black && h.Black !== "?" ? h.Black : "Чёрные";
  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid grid-cols-2 gap-2">
        {[
          { n: white, a: review.accuracy.w, light: true },
          { n: black, a: review.accuracy.b, light: false },
        ].map((p, i) => (
          <div key={i} className="rounded-lg bg-[#2b2927] p-3 text-center">
            <div className="truncate text-xs font-semibold text-[#a7a6a2]">{p.n}</div>
            <div
              className={cn(
                "mx-auto mt-1.5 inline-block min-w-[84px] rounded-md px-3 py-1.5 text-[22px] font-extrabold tabular-nums",
                p.light ? "bg-white text-[#262421]" : "bg-[#454240] text-white"
              )}
            >
              {p.a.toFixed(1)}
            </div>
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[#8b8987]">Точность</div>
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg bg-[#2b2927]">
        {CAT_ORDER.map((c, i) => (
          <div
            key={c}
            className={cn(
              "grid grid-cols-[1fr_40px_40px] items-center px-3 py-[7px] text-sm",
              i % 2 ? "bg-[#2b2927]" : "bg-[#262421]/60"
            )}
          >
            <div className="flex items-center gap-2.5 font-semibold" style={{ color: review.counts.w[c] + review.counts.b[c] ? CAT_COLOR[c] : "#6d6b69" }}>
              <CatIcon cat={c} size={18} />
              {CAT_LABEL_PLURAL[c]}
            </div>
            <div className="text-center font-bold tabular-nums text-white">{review.counts.w[c]}</div>
            <div className="text-center font-bold tabular-nums text-white">{review.counts.b[c]}</div>
          </div>
        ))}
      </div>
      {review.opening && (
        <div className="flex items-center gap-2 rounded-lg bg-[#2b2927] px-3 py-2.5 text-sm text-[#d5d3d1]">
          <BookOpen size={16} className="shrink-0 text-[#a88865]" />
          <span className="font-semibold">{review.opening}</span>
        </div>
      )}
      <div className="text-center text-xs text-[#8b8987]">
        Stockfish 19 · {review.mode === "fast" ? "быстрый" : "глубокий"} анализ ·{" "}
        {(review.elapsedMs / 1000).toFixed(0)} с
      </div>
    </div>
  );
}

/* ---------- Комментарий «тренера» ---------- */
export function CoachCard({
  move,
  total,
  review,
  showBest,
  onToggleBest,
  ply,
  className,
}: {
  move: MoveInfo | null;
  total: number;
  review: Review;
  showBest: boolean;
  onToggleBest: () => void;
  ply: number;
  className?: string;
}) {
  if (!move) {
    return (
      <div className={cn("flex items-center gap-3 rounded-lg bg-[#2b2927] p-3", className)}>
        <div className="text-2xl">♟️</div>
        <div>
          <div className="text-[15px] font-bold text-white">Начало партии</div>
          <div className="text-[13px] text-[#a7a6a2]">
            Полуходов: {total} · листайте ← → или свайпом по доске
          </div>
        </div>
      </div>
    );
  }
  const pos = review.positions[ply];
  const color = CAT_COLOR[move.cat];
  const canBest = move.cat !== "best" && move.cat !== "brilliant" && move.cat !== "book" && !!move.bestUci;
  return (
    <div className={cn("rounded-lg bg-[#2b2927] p-3", className)}>
      <div className="flex items-center gap-3">
        <CatIcon cat={move.cat} size={30} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-extrabold" style={{ color }}>
            {move.san} — {CAT_LABEL[move.cat].toLowerCase()}
          </div>
          <div className="truncate text-[13px] text-[#a7a6a2]">
            {move.cat === "book" && move.opening
              ? move.opening
              : canBest
                ? `Лучше было ${move.bestSan}${move.loss >= 20 ? ` (−${(move.loss / 100).toFixed(1)})` : ""}`
                : move.cat === "brilliant"
                  ? `Жертва ${move.sacrifice >= 3 ? "фигуры" : "материала"} — и позиция остаётся в порядке`
                  : "Это лучший ход в позиции"}
          </div>
        </div>
        <div
          className={cn(
            "rounded-md px-2 py-1 text-sm font-extrabold tabular-nums",
            pos.value >= 0 ? "bg-white text-[#262421]" : "bg-[#454240] text-white"
          )}
        >
          {formatEval(pos.value, pos.mate)}
        </div>
      </div>
      {canBest && (
        <button
          onClick={onToggleBest}
          className={cn(
            "mt-2.5 w-full rounded-md py-2 text-[13px] font-bold transition-colors",
            showBest ? "bg-[#81b64c] text-white" : "bg-[#3d3a37] text-[#e0dfdd] hover:bg-[#46433f]"
          )}
        >
          {showBest ? "Скрыть лучший ход" : "Показать лучший ход"}
        </button>
      )}
    </div>
  );
}

/* ---------- Кнопки навигации ---------- */
export function Controls({
  ply,
  max,
  onSet,
  big,
}: {
  ply: number;
  max: number;
  onSet: (p: number) => void;
  big?: boolean;
}) {
  const btn = cn(
    "flex flex-1 items-center justify-center rounded-md bg-[#3d3a37] text-[#e8e7e5] transition active:scale-95 active:bg-[#4d4a46] disabled:opacity-35",
    big ? "h-12" : "h-10 hover:bg-[#4a4743]"
  );
  const s = big ? 26 : 22;
  return (
    <div className="flex gap-1.5">
      <button className={btn} disabled={ply <= 0} onClick={() => onSet(0)} aria-label="В начало">
        <ChevronsLeft size={s} />
      </button>
      <button className={btn} disabled={ply <= 0} onClick={() => onSet(ply - 1)} aria-label="Назад">
        <ChevronLeft size={s} />
      </button>
      <button className={btn} disabled={ply >= max} onClick={() => onSet(ply + 1)} aria-label="Вперёд">
        <ChevronRight size={s} />
      </button>
      <button className={btn} disabled={ply >= max} onClick={() => onSet(max)} aria-label="В конец">
        <ChevronsRight size={s} />
      </button>
    </div>
  );
}

/* ---------- Полоска игрока ---------- */
export function PlayerStrip({
  name,
  rating,
  color,
  accuracy,
  result,
  compact,
}: {
  name: string;
  rating?: string;
  color: "w" | "b";
  accuracy?: number;
  result?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5 px-1", compact ? "h-10" : "h-11")}>
      <div
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded text-lg",
          color === "w" ? "bg-[#f1f1f1] text-[#262421]" : "bg-[#454240] text-white"
        )}
      >
        {color === "w" ? "♔" : "♚"}
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[15px] font-bold text-white">
          {name}
          {rating && rating !== "?" && <span className="ml-1.5 text-[13px] font-semibold text-[#8b8987]">({rating})</span>}
        </div>
      </div>
      {result && <span className="text-sm font-bold text-[#a7a6a2]">{result}</span>}
      {accuracy !== undefined && (
        <span className="rounded bg-[#3d3a37] px-2 py-0.5 text-[13px] font-bold tabular-nums text-[#c9e3a6]">
          {accuracy.toFixed(1)}%
        </span>
      )}
    </div>
  );
}
