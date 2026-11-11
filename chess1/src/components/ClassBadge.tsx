import type { Classification } from "@/lib/types";
import { CLASS_META } from "@/lib/winrate";

export function ClassBadge({ cls, size = 18, title }: { cls: Classification; size?: number; title?: string }) {
  const meta = CLASS_META[cls];
  return (
    <span
      title={title ?? meta.label}
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full font-extrabold leading-none shadow-sm"
      style={{
        width: size,
        height: size,
        background: meta.color,
        color: meta.text,
        fontSize: Math.round(size * (meta.symbol.length > 1 ? 0.5 : 0.62)),
        border: cls === "good" ? "1px solid #d9d9d4" : undefined,
      }}
    >
      {meta.symbol}
    </span>
  );
}

/** SVG badge that scales with the board square (rendered in the corner of the destination square). */
export function SquareBadge({ cls }: { cls: Classification }) {
  const meta = CLASS_META[cls];
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ position: "absolute", top: "-6%", right: "-6%", width: "40%", height: "40%", zIndex: 30, pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(0,0,0,.5))" }}
    >
      <circle cx="12" cy="12" r="11" fill={meta.color} stroke="rgba(255,255,255,.85)" strokeWidth="1" />
      <text
        x="12"
        y="12.5"
        textAnchor="middle"
        dominantBaseline="central"
        fontWeight="800"
        fontSize={meta.symbol.length > 1 ? 12 : 15}
        fill={meta.text}
        fontFamily="system-ui, sans-serif"
      >
        {meta.symbol}
      </text>
    </svg>
  );
}
