import { Chess, type Square } from "chess.js";
import type { EngineLine } from "../types";
import { formatScore, sanRu } from "../lib/format";
import { winPercent } from "../lib/winprob";

export function pvToSans(fen: string, pv: string[], max = 9): string[] {
  const out: string[] = [];
  try {
    const c = new Chess(fen);
    const parts = fen.split(" ");
    let moveNo = parseInt(parts[5] ?? "1", 10) || 1;
    let turn = c.turn();
    for (const uci of pv.slice(0, max)) {
      const m = c.move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci.length > 4 ? uci[4] : undefined });
      if (!m) break;
      const prefix = turn === "w" ? `${moveNo}.` : out.length === 0 ? `${moveNo}…` : "";
      out.push(`${prefix}${prefix ? "\u00a0" : ""}${sanRu(m.san)}`);
      if (turn === "b") moveNo++;
      turn = turn === "w" ? "b" : "w";
    }
  } catch {
    /* ignore */
  }
  return out;
}

interface Props {
  enabled: boolean;
  onToggle: (v: boolean) => void;
  lines: EngineLine[];
  fen: string;
  targetDepth: number;
  threads: number;
  variantLabel: string;
  onPlayUci: (uci: string) => void;
  onReset: () => void;
  exploring: boolean;
  disabled?: boolean;
}

export function AnalysisTab({ enabled, onToggle, lines, fen, targetDepth, threads, variantLabel, onPlayUci, onReset, exploring, disabled }: Props) {
  const depth = lines.length ? Math.min(...lines.map((l) => l.depth)) : 0;
  return (
    <div className="space-y-3">
      <button
        disabled={disabled}
        onClick={() => onToggle(!enabled)}
        className="flex w-full items-center justify-between rounded-lg bg-[#2b2926] px-3 py-3 text-left hover:bg-[#35322e] disabled:opacity-40"
      >
        <span>
          <span className="block text-sm font-bold">Свободный анализ</span>
          <span className="block text-xs text-[#a7a6a2]">3 лучшие линии Stockfish 19 · двигайте фигуры за обе стороны</span>
        </span>
        <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${enabled ? "bg-[#81b64c]" : "bg-[#4b4844]"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "left-[22px]" : "left-0.5"}`} />
        </span>
      </button>

      {enabled && (
        <div className="overflow-hidden rounded-lg bg-[#2b2926]">
          <div className="flex items-center justify-between border-b border-[#3d3a37] px-3 py-2 text-xs text-[#a7a6a2]">
            <span>
              Stockfish 19 · {variantLabel} · {threads > 1 ? `${threads} потоков` : "1 поток"}
            </span>
            <span className="font-bold tabular-nums text-white">
              глубина {depth}/{targetDepth}
            </span>
          </div>
          {lines.length === 0 && <div className="animate-pulse px-3 py-4 text-sm text-[#a7a6a2]">Движок думает…</div>}
          {lines.map((l) => {
            const w = winPercent(l.score);
            const sans = pvToSans(fen, l.pv);
            const whiteMove = fen.split(" ")[1] === "w";
            void whiteMove;
            return (
              <button
                key={l.multipv}
                onClick={() => l.pv[0] && onPlayUci(l.pv[0])}
                className="flex w-full items-start gap-2 border-b border-[#3d3a37] px-3 py-2.5 text-left last:border-0 hover:bg-[#35322e]"
                title="Сыграть первый ход линии"
              >
                <span
                  className={`mt-0.5 w-14 shrink-0 rounded px-1 py-0.5 text-center text-xs font-extrabold tabular-nums ${
                    w >= 50 ? "bg-white text-[#262421]" : "bg-[#403d39] text-white"
                  }`}
                >
                  {formatScore(l.score)}
                </span>
                <span className="min-w-0 text-[13px] leading-snug text-[#dcdbd7]">{sans.join(" ")}</span>
              </button>
            );
          })}
          {exploring && (
            <button onClick={onReset} className="w-full bg-[#3d3a37] py-2 text-sm font-semibold hover:bg-[#4b4844]">
              ↩ Вернуться к партии
            </button>
          )}
        </div>
      )}
    </div>
  );
}
