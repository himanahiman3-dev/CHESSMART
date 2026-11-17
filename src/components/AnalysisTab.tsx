import { useMemo } from "react";
import { Chess, type Square } from "chess.js";
import type { EngineLine } from "../types";
import { formatScore, sanRu } from "../lib/format";
import { winPercent } from "../lib/winprob";
import { explainStockfishMove } from "../lib/engineCoach";

export function pvToSans(fen: string, pv: string[], max = 9): string[] {
  const out: string[] = [];
  try {
    const c = new Chess(fen);
    const parts = fen.split(" ");
    let moveNo = parseInt(parts[5] ?? "1", 10) || 1;
    let turn = c.turn();
    for (const uci of pv.slice(0, max)) {
      const m = c.move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: (uci[4] ?? "q") as never });
      if (!m) break;
      const prefix = turn === "w" ? moveNo + "." : out.length === 0 ? moveNo + "…" : "";
      out.push((prefix ? prefix + "\u00a0" : "") + sanRu(m.san));
      if (turn === "b") moveNo++;
      turn = turn === "w" ? "b" : "w";
    }
  } catch { /* an invalid engine line is simply omitted */ }
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
  const depth = lines.length ? Math.min(...lines.map((line) => line.depth)) : 0;
  const best = lines[0];
  const explanation = useMemo(
    () => enabled && best?.pv[0] ? explainStockfishMove(fen, best.pv[0]) : null,
    [enabled, fen, best?.pv[0]],
  );

  return (
    <section className="overflow-hidden rounded-xl border border-[#46443e] bg-[#292824] shadow-lg shadow-black/10">
      <div className="flex items-center justify-between gap-3 border-b border-[#41403a] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#596c47] bg-[#34432b]">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="#d9edc4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 18V6m0 12h16M7 14l3-4 3 2 5-6" />
              <circle cx="18" cy="6" r="1.5" fill="#d9edc4" stroke="none" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-extrabold text-[#f1f0ec]">Анализ движка</div>
            <div className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-[#96948c]">Stockfish 19 · {variantLabel}</div>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? "Остановить анализ" : "Включить анализ"}
          disabled={disabled}
          onClick={() => onToggle(!enabled)}
          className={"relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 " + (enabled ? "border-[#789c54] bg-[#81b64c]" : "border-[#5a5851] bg-[#45433d]")}
        >
          <span className={"absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all " + (enabled ? "left-[21px]" : "left-[2px]")} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[#41403a] bg-[#24231f] px-4 py-2 text-[10px] font-semibold text-[#96948c]">
        <span>Глубина <b className="ml-1 tabular-nums text-[#e1e0da]">{depth}/{targetDepth}</b></span>
        <span>Линии <b className="ml-1 tabular-nums text-[#e1e0da]">{lines.length}/3</b></span>
        <span>Потоки <b className="ml-1 tabular-nums text-[#e1e0da]">{threads}</b></span>
        <span className="ml-auto text-[#7f9c62]">{enabled ? "АНАЛИЗ ВКЛЮЧЁН" : "ОЖИДАНИЕ"}</span>
      </div>

      {!enabled && (
        <div className="px-4 py-4">
          <p className="text-xs leading-relaxed text-[#aaa89f]">Включи анализ, чтобы получить три лучших продолжения, оценку позиции и возможность сразу сыграть выбранную линию на доске.</p>
        </div>
      )}

      {enabled && (
        <div>
          {lines.length === 0 && (
            <div className="flex items-center gap-3 px-4 py-5 text-xs text-[#aaa89f]">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#5e5c54] border-t-[#9bc66b]" />
              Stockfish рассчитывает варианты…
            </div>
          )}
          {lines.map((line, index) => {
            const probability = winPercent(line.score);
            const sans = pvToSans(fen, line.pv);
            return (
              <button
                key={line.multipv}
                type="button"
                onClick={() => line.pv[0] && onPlayUci(line.pv[0])}
                disabled={!line.pv.length}
                className="group flex w-full items-start gap-3 border-b border-[#3d3b35] px-4 py-3 text-left last:border-0 hover:bg-[#35342e] disabled:cursor-default"
                title="Сыграть первый ход варианта"
              >
                <span className={"mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-black tabular-nums " + (index === 0 ? "bg-[#83ad5f] text-[#172013]" : "bg-[#3a3932] text-[#b4b2a9]")}>{index + 1}</span>
                <span className={"mt-0.5 min-w-[54px] rounded-md px-2 py-1 text-center font-mono text-xs font-extrabold tabular-nums " + (probability >= 50 ? "bg-[#e9e8e1] text-[#292824]" : "bg-[#45433d] text-[#f0efe9]")}>{formatScore(line.score)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] leading-6 text-[#e2e1da] group-hover:text-white">{sans.join(" ") || "Линия не получена"}</span>
                  <span className="mt-1 block text-[9px] font-semibold uppercase tracking-[0.1em] text-[#85837b]">Глубина {line.depth} · {line.pv.length} полуходов</span>
                </span>
                <span className="mt-1 text-[10px] font-bold text-[#8fae6d] opacity-0 transition-opacity group-hover:opacity-100">ХОДИТЬ</span>
              </button>
            );
          })}

          {explanation && (
            <div className="border-t border-[#596b48]/50 bg-[#242a20] px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#a8c98a]">Что меняет лучший ход</div>
                  <div className="mt-1 text-sm font-extrabold text-[#f1f0ec]">Stockfish №1 · {sanRu(explanation.san)}</div>
                </div>
                <span className="rounded-md border border-[#718b59]/40 bg-[#526d3c]/20 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-[#c6dda9]">300 проверок</span>
              </div>

              {explanation.tactical.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {explanation.tactical.map((item) => (
                    <div key={item} className="flex gap-2 text-xs leading-relaxed text-[#d9e7ce]">
                      <span className="font-black text-[#a8d17d]">•</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              )}

              {explanation.changes.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {explanation.changes.map((change) => (
                    <div key={change.title} className="rounded-lg border border-white/[0.06] bg-black/15 p-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-[#e3e5dc]">{change.title}</span>
                        <span className="font-mono font-extrabold tabular-nums text-[#b9d99a]">{change.before} → {change.after}</span>
                      </div>
                      <p className="mt-1 text-[10px] leading-relaxed text-[#a8ad9f]">{change.explanation}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs leading-relaxed text-[#c1c5b8]">
                  В 300 позиционных проверках не обнаружено надёжного структурного изменения после этого хода. Это нормально: Stockfish может выбирать ход из-за конкретного тактического варианта или расчёта на несколько ходов вперёд.
                </p>
              )}

              <p className="mt-3 border-t border-white/[0.07] pt-2 text-[9px] leading-relaxed text-[#7e8975]">
                Это дополнительное объяснение по разнице позиции до и после хода, а не новая оценка движка. Проверки эвристические; лучший ход, оценка и глубина по-прежнему полностью принадлежат Stockfish 19.
              </p>
            </div>
          )}

          {exploring && (
            <div className="border-t border-[#41403a] bg-[#24231f] p-3">
              <button type="button" onClick={onReset} className="w-full rounded-lg border border-[#55534b] bg-[#393831] px-3 py-2.5 text-xs font-bold text-[#d7d6cf] hover:bg-[#45443c]">Вернуться к партии</button>
            </div>
          )}
          {best && (
            <div className="flex items-center justify-between gap-2 bg-[#24231f] px-4 py-2 text-[10px] text-[#89877f]">
              <span>Нажми на вариант, чтобы продолжить позицию</span>
              <span className="font-semibold tabular-nums">PV {best.multipv}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
