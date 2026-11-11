import { cpToWinRate, formatEvalShort } from "@/lib/winrate";

interface Props {
  cp: number | null;
  mate: number | null;
  flipped: boolean;
}

/** Vertical evaluation bar: the white part grows with White's win-rate (computed from Stockfish's CP/mate score). */
export function EvalBar({ cp, mate, flipped }: Props) {
  const value = cp ?? 0;
  const wr = cp === null ? 0.5 : cpToWinRate(value);
  const whitePct = Math.min(98, Math.max(2, wr * 100));
  const whiteAhead = value >= 0;
  const label = cp === null ? "" : formatEvalShort(value, mate);

  return (
    <div
      className="relative w-7 shrink-0 self-stretch overflow-hidden rounded-sm bg-[#3c3a37] sm:w-8"
      style={{ transform: flipped ? "rotate(180deg)" : undefined }}
      aria-label="Evaluation bar"
    >
      {/* black side is the background; white fills from the bottom */}
      <div
        className="absolute inset-x-0 bottom-0 bg-[#f1f1ee] transition-[height] duration-500 ease-out"
        style={{ height: `${whitePct}%` }}
      />
      <div className="absolute inset-x-0 top-1/2 h-px bg-[#81b64c]/60" />
      <span
        className="absolute inset-x-0 text-center text-[10px] font-bold sm:text-[11px]"
        style={{
          [whiteAhead ? "bottom" : "top"]: 3,
          color: whiteAhead ? "#262421" : "#f1f1ee",
          transform: flipped ? "rotate(180deg)" : undefined,
        }}
      >
        {label}
      </span>
    </div>
  );
}
