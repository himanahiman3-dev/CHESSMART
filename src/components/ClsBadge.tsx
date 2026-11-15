import type { CSSProperties } from "react";
import type { Cls } from "../types";
import { CLS_META } from "../types";

function Icon({ cls }: { cls: Cls }) {
  const common = { fill: "none", stroke: "#fff", strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (cls) {
    case "best":
      return (
        <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]">
          <polygon fill="#fff" points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      );
    case "excellent":
      return (
        <svg viewBox="0 0 24 24" className="h-[58%] w-[58%]">
          <path
            fill="#fff"
            d="M7 10v12h-3a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h3zm8-4.12L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H9V10h.76a2 2 0 0 0 1.79-1.11L13 6a3.13 3.13 0 0 1 2 .88z"
          />
        </svg>
      );
    case "good":
      return (
        <svg viewBox="0 0 24 24" className="h-[58%] w-[58%]">
          <polyline {...common} points="20 6 9 17 4 12" />
        </svg>
      );
    case "book":
      return (
        <svg viewBox="0 0 24 24" className="h-[60%] w-[60%]">
          <path fill="#fff" d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" />
        </svg>
      );
    case "miss":
      return (
        <svg viewBox="0 0 24 24" className="h-[56%] w-[56%]">
          <line {...common} x1="6" y1="6" x2="18" y2="18" />
          <line {...common} x1="18" y1="6" x2="6" y2="18" />
        </svg>
      );
    default:
      return (
        <span className="font-black leading-none text-white" style={{ fontSize: "1em", letterSpacing: "-0.04em" }}>
          {CLS_META[cls].symbol}
        </span>
      );
  }
}

export function ClsBadge({ cls, size = 20, className = "", style }: { cls: Cls; size?: number; className?: string; style?: CSSProperties }) {
  const fs = size * 0.55;
  return (
    <span
      title={CLS_META[cls].ru}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: fs,
        background: CLS_META[cls].color,
        boxShadow: "0 1px 3px rgba(0,0,0,.45)",
        ...style,
      }}
    >
      <Icon cls={cls} />
    </span>
  );
}
