import type { Score } from "../types";
import { formatScore } from "../lib/format";
import { winPercent } from "../lib/winprob";

export function EvalBar({ score, flipped }: { score: Score; flipped: boolean }) {
  const white = Math.max(2, Math.min(98, winPercent(score)));
  const whiteAhead = winPercent(score) >= 50;
  const label = formatScore(score, true);
  // белые снизу, если доска не перевёрнута
  const labelAtBottom = flipped ? !whiteAhead : whiteAhead;
  return (
    <div
      className="relative w-[26px] shrink-0 overflow-hidden rounded-[4px] bg-[#403d39] sm:w-[30px]"
      title={`Оценка: ${formatScore(score)}`}
      aria-label={`Оценка ${formatScore(score)}`}
    >
      <div
        className="absolute inset-x-0 bg-white transition-[height] duration-700 ease-out"
        style={{ height: `${white}%`, [flipped ? "top" : "bottom"]: 0 }}
      />
      <span
        className={`absolute inset-x-0 text-center text-[10px] font-bold leading-none sm:text-[11px] ${
          labelAtBottom ? "bottom-1" : "top-1"
        } ${whiteAhead ? "text-[#403d39]" : "text-white"}`}
      >
        {label}
      </span>
      <div className="absolute inset-x-0 top-1/2 h-px bg-[#e5533d]/70" />
    </div>
  );
}
