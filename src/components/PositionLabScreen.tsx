import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import type { StockfishEngine } from "../lib/engine";
import { formatScore } from "../lib/format";
import type { EngineLine } from "../types";
import { GameBoard, type BoardMove } from "./GameBoard";
import { pvToSans } from "./AnalysisTab";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
type MoveFilter = "all" | "captures" | "checks" | "castles" | "promotions";
interface HistoryEntry { fen: string; san: string | null; }
const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_NAME: Record<string, string> = { p: "Пешки", n: "Кони", b: "Слоны", r: "Ладьи", q: "Ферзи", k: "Короли" };

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Браузер не разрешил копирование.");
  }
}

export function PositionLabScreen({ engine, onBack }: { engine: StockfishEngine; onBack: () => void }) {
  const [history, setHistory] = useState<HistoryEntry[]>([{ fen: START_FEN, san: null }]);
  const [cursor, setCursor] = useState(0);
  const [fenInput, setFenInput] = useState(START_FEN);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [filter, setFilter] = useState<MoveFilter>("all");
  const [depth, setDepth] = useState(14);
  const [lines, setLines] = useState<EngineLine[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState("");
  const requestRef = useRef<{ stop: () => void } | null>(null);
  const fen = history[cursor]?.fen ?? START_FEN;

  const position = useMemo(() => {
    try { return new Chess(fen); } catch { return null; }
  }, [fen]);
  const legalMoves = useMemo(() => position?.moves({ verbose: true }) ?? [], [position]);
  const board = position?.board() ?? [];
  const material = useMemo(() => {
    let white = 0;
    let black = 0;
    const counts: Record<"w" | "b", Record<string, number>> = {
      w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
      b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    };
    for (const row of board) for (const piece of row) {
      if (!piece) continue;
      counts[piece.color][piece.type] += 1;
      if (piece.color === "w") white += PIECE_VALUE[piece.type];
      else black += PIECE_VALUE[piece.type];
    }
    return { white, black, balance: white - black, counts };
  }, [board]);
  const fenFields = fen.split(" ");
  const status = !position ? "Некорректная позиция" : position.isCheckmate() ? "Мат" : position.isStalemate() ? "Пат" : position.isDraw() ? "Ничья" : position.isCheck() ? "Шах" : "Игра продолжается";

  const filteredMoves = useMemo(() => legalMoves.filter((move) => {
    if (filter === "captures") return !!move.captured;
    if (filter === "checks") return move.san.includes("+") || move.san.includes("#");
    if (filter === "castles") return move.san === "O-O" || move.san === "O-O-O";
    if (filter === "promotions") return !!move.promotion;
    return true;
  }), [legalMoves, filter]);

  const moveHistory = history.slice(1, cursor + 1);
  const undo = () => setCursor((value) => Math.max(0, value - 1));
  const redo = () => setCursor((value) => Math.min(history.length - 1, value + 1));
  const reset = () => {
    setHistory([{ fen: START_FEN, san: null }]);
    setCursor(0);
    setFenInput(START_FEN);
    setLines([]);
    setError(null);
  };
  const loadFen = () => {
    try {
      const next = new Chess(fenInput.trim());
      const normalized = next.fen();
      setHistory([{ fen: normalized, san: null }]);
      setCursor(0);
      setLines([]);
      setError(null);
    } catch {
      setError("FEN не прошёл проверку. Проверь расстановку, сторону хода и поля прав рокировки.");
    }
  };
  const handleBoardMove = (move: BoardMove): boolean => {
    const next = [...history.slice(0, cursor + 1), { fen: move.fenAfter, san: move.san }];
    setHistory(next);
    setCursor(next.length - 1);
    setLines([]);
    setError(null);
    return true;
  };
  const playUci = (uci: string): boolean => {
    if (!position) return false;
    try {
      const next = new Chess(fen);
      const result = next.move({
        from: uci.slice(0, 2) as Square,
        to: uci.slice(2, 4) as Square,
        promotion: (uci[4] ?? "q") as never,
      });
      if (!result) return false;
      handleBoardMove({ from: result.from, to: result.to, san: result.san, uci, fenAfter: next.fen() });
      return true;
    } catch { return false; }
  };
  const runAnalysis = useCallback(() => {
    if (!position) return;
    requestRef.current?.stop();
    setAnalyzing(true);
    setError(null);
    setLines([]);
    const requestedFen = fen;
    const handle = engine.search({ fen: requestedFen, depth, multipv: 3, movetimeMs: depth >= 18 ? 1800 : depth >= 14 ? 1100 : 650 });
    requestRef.current = handle;
    handle.promise
      .then((result) => {
        if (requestedFen === fen) setLines(result);
      })
      .catch((reason: unknown) => {
        if (requestedFen === fen) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (requestRef.current === handle) {
          requestRef.current = null;
          setAnalyzing(false);
        }
      });
  }, [engine, fen, depth, position]);

  useEffect(() => {
    setFenInput(fen);
    setFilter("all");
  }, [fen]);
  useEffect(() => {
    requestRef.current?.stop();
    requestRef.current = null;
    setAnalyzing(false);
    setLines([]);
  }, [fen]);
  useEffect(() => () => requestRef.current?.stop(), []);

  const copy = async (value: string, label: string) => {
    try {
      await copyText(value);
      setCopied(label + " скопирован");
      window.setTimeout(() => setCopied(""), 1800);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const allUci = legalMoves.map((move) => move.from + move.to + (move.promotion ?? "")).join(" ");
  const allSan = legalMoves.map((move) => move.san).join(" · ");
  const activeColor = position?.turn() === "w" ? "белые" : "чёрные";
  const pieceRows = ["p", "n", "b", "r", "q", "k"] as const;

  return (
    <main className="min-h-screen bg-[#242522] p-4 text-[#f0f0ed] sm:p-6">
      <div className="mx-auto max-w-[1440px]">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9fc776]">Chessmart tools</p>
            <h1 className="mt-1 text-2xl font-black">Лаборатория позиции</h1>
            <p className="mt-1 text-xs text-[#97968e]">FEN · легальные ходы · материал · Stockfish · история</p>
          </div>
          <button onClick={onBack} className="rounded-lg border border-[#45463f] bg-[#30312c] px-4 py-2 text-xs font-bold hover:bg-[#3b3c35]">Назад</button>
        </header>

        <section className="mb-4 rounded-xl border border-[#42433c] bg-[#2d2e29] p-3 sm:p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="lab-fen" className="text-xs font-bold text-[#d4d3cc]">Текущая позиция FEN</label>
            <div className="flex gap-2">
              <button onClick={() => void copy(fen, "FEN")} className="rounded-md border border-[#515249] px-2.5 py-1.5 text-[10px] font-bold text-[#d4d3cc] hover:bg-[#3a3b34]">Копировать FEN</button>
              <button onClick={() => void copy(allUci, "Список UCI")} disabled={!legalMoves.length} className="rounded-md border border-[#515249] px-2.5 py-1.5 text-[10px] font-bold text-[#d4d3cc] hover:bg-[#3a3b34] disabled:opacity-40">Копировать UCI</button>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input id="lab-fen" value={fenInput} onChange={(event) => setFenInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") loadFen(); }} className="min-w-0 flex-1 rounded-lg border border-[#4a4b43] bg-[#20211e] px-3 py-2.5 font-mono text-[11px] text-[#e0dfd8] outline-none focus:border-[#8eae68]" />
            <button onClick={loadFen} className="rounded-lg bg-[#81b64c] px-4 py-2.5 text-xs font-extrabold text-[#182012] hover:bg-[#93c75d]">Загрузить FEN</button>
            <button onClick={reset} className="rounded-lg border border-[#515249] px-4 py-2.5 text-xs font-bold text-[#d4d3cc] hover:bg-[#3a3b34]">Начальная</button>
          </div>
          {error && <p role="alert" className="mt-2 rounded-md bg-[#482c29] px-3 py-2 text-xs text-[#ffd0c8]">{error}</p>}
          {copied && <p className="mt-2 text-[10px] font-bold text-[#b6d79a]">{copied}</p>}
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
          <section className="rounded-xl border border-[#41423b] bg-[#2d2e29] p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-[#41423b] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[#d8d7d0]">{status}</span>
                <span className="text-[11px] text-[#9b9a92]">Ход: {activeColor}</span>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => setOrientation((value) => value === "white" ? "black" : "white")} className="rounded-md border border-[#4b4c44] px-2.5 py-1.5 text-[10px] font-bold hover:bg-[#3a3b34]">Перевернуть</button>
                <button onClick={undo} disabled={cursor === 0} className="rounded-md border border-[#4b4c44] px-2.5 py-1.5 text-[10px] font-bold hover:bg-[#3a3b34] disabled:opacity-35">← Отменить</button>
                <button onClick={redo} disabled={cursor >= history.length - 1} className="rounded-md border border-[#4b4c44] px-2.5 py-1.5 text-[10px] font-bold hover:bg-[#3a3b34] disabled:opacity-35">Повторить →</button>
              </div>
            </div>
            <div className="mx-auto max-w-[760px]">
              <GameBoard fen={fen} orientation={orientation} interactive={!!position && !position.isGameOver()} onMove={handleBoardMove} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#23241f] px-3 py-2 text-[10px] text-[#a7a69f]">
              <span>История: {cursor} полуходов · Можно ходить за обе стороны</span>
              <span>Легальных ходов: <b className="text-white">{legalMoves.length}</b></span>
            </div>
            {moveHistory.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1 rounded-lg bg-[#23241f] p-2">
                {moveHistory.map((move, index) => <button key={index} onClick={() => setCursor(index + 1)} className={"rounded px-2 py-1 text-[10px] " + (index + 1 === cursor ? "bg-[#4b633b] font-bold text-white" : "text-[#c3c2bb] hover:bg-[#373830]")}>{Math.floor(index / 2) + 1}{index % 2 ? "…" : "."} {move.san}</button>)}
              </div>
            )}
          </section>

          <aside className="space-y-3">
            <section className="rounded-xl border border-[#41423b] bg-[#2d2e29] p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-extrabold">Stockfish 19</h2>
                <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8eae68]">MultiPV · 3 линии</span>
              </div>
              <div className="flex gap-2">
                <select value={depth} onChange={(event) => setDepth(Number(event.target.value))} className="flex-1 rounded-lg border border-[#4b4c44] bg-[#20211e] px-3 py-2 text-xs">
                  {[10, 12, 14, 16, 18, 20].map((value) => <option key={value} value={value}>Глубина {value}</option>)}
                </select>
                <button onClick={runAnalysis} disabled={!position || analyzing} className="rounded-lg bg-[#81b64c] px-4 py-2 text-xs font-extrabold text-[#182012] disabled:opacity-40">{analyzing ? "Считаю…" : "Анализировать"}</button>
              </div>
              <div className="mt-3 space-y-2">
                {lines.map((line, index) => (
                  <button key={line.multipv} onClick={() => line.pv[0] && playUci(line.pv[0])} className="flex w-full items-start gap-2 rounded-lg bg-[#23241f] p-2.5 text-left hover:bg-[#3a3b34]">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#41423b] text-[10px] font-bold">{index + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-xs font-extrabold text-[#dfe0d7]">{formatScore(line.score)}</span>
                      <span className="mt-1 block text-[10px] leading-relaxed text-[#b0afa7]">{pvToSans(fen, line.pv).join(" ")}</span>
                    </span>
                    <span className="text-[9px] font-bold text-[#91b66c]">ХОД</span>
                  </button>
                ))}
                {lines.length === 0 && <p className="rounded-lg bg-[#23241f] p-3 text-[10px] text-[#85847d]">Нажми «Анализировать», чтобы получить оценку и три продолжения.</p>}
              </div>
            </section>

            <section className="rounded-xl border border-[#41423b] bg-[#2d2e29] p-4">
              <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-extrabold">Материальный баланс</h2><span className="text-[10px] text-[#97968e]">в пешках</span></div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-[#23241f] p-2"><div className="text-[9px] text-[#929188]">Белые</div><div className="mt-1 text-xl font-black tabular-nums">{material.white}</div></div>
                <div className="rounded-lg bg-[#23241f] p-2"><div className="text-[9px] text-[#929188]">Баланс</div><div className={"mt-1 text-xl font-black tabular-nums " + (material.balance > 0 ? "text-[#a9cf83]" : material.balance < 0 ? "text-[#ed9a8f]" : "text-white")}>{material.balance > 0 ? "+" : ""}{material.balance}</div></div>
                <div className="rounded-lg bg-[#23241f] p-2"><div className="text-[9px] text-[#929188]">Чёрные</div><div className="mt-1 text-xl font-black tabular-nums">{material.black}</div></div>
              </div>
              <div className="mt-3 space-y-1.5">
                {pieceRows.map((piece) => <div key={piece} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-[10px]"><span className="text-[#aaa99f]">{PIECE_NAME[piece]}</span><span className="w-10 text-right text-[#d8d7d0]">{material.counts.w[piece]} бел.</span><span className="w-10 text-right text-[#d8d7d0]">{material.counts.b[piece]} чёрн.</span></div>)}
              </div>
            </section>

            <section className="rounded-xl border border-[#41423b] bg-[#2d2e29] p-4">
              <h2 className="mb-3 text-sm font-extrabold">Сведения о позиции</h2>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                {[
                  ["Сторона хода", fenFields[1] === "w" ? "Белые" : "Чёрные"],
                  ["Рокировка", fenFields[2] === "-" ? "Нет" : fenFields[2]],
                  ["Взятие на проходе", fenFields[3] === "-" ? "Нет" : fenFields[3]],
                  ["Счётчик полуходов", fenFields[4] ?? "—"],
                  ["Номер хода", fenFields[5] ?? "—"],
                  ["Всего ходов", String(legalMoves.length)],
                ].map(([label, value]) => <div key={label} className="rounded-md bg-[#23241f] p-2"><div className="text-[#85847d]">{label}</div><div className="mt-1 font-bold text-[#e0dfd8]">{value}</div></div>)}
              </div>
            </section>

            <section className="rounded-xl border border-[#41423b] bg-[#2d2e29] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-extrabold">Легальные ходы</h2><button onClick={() => void copy(allSan, "Список SAN")} disabled={!legalMoves.length} className="text-[9px] font-bold text-[#a9cb87] disabled:opacity-35">КОПИРОВАТЬ SAN</button></div>
              <div className="mb-2 flex flex-wrap gap-1">
                {([
                  ["all", "Все"],
                  ["captures", "Взятия"],
                  ["checks", "Шахи"],
                  ["castles", "Рокировки"],
                  ["promotions", "Превращения"],
                ] as const).map(([id, label]) => <button key={id} onClick={() => setFilter(id)} className={"rounded-md px-2 py-1 text-[9px] font-bold " + (filter === id ? "bg-[#81b64c] text-[#182012]" : "bg-[#23241f] text-[#aaa99f] hover:bg-[#3a3b34]")}>{label}</button>)}
              </div>
              <div className="max-h-40 overflow-y-auto">
                <div className="flex flex-wrap gap-1">
                  {filteredMoves.map((move) => {
                    const uci = move.from + move.to + (move.promotion ?? "");
                    return <button key={uci} onClick={() => playUci(uci)} className="rounded-md bg-[#23241f] px-2 py-1.5 text-[10px] font-semibold text-[#d8d7d0] hover:bg-[#48583b]">{move.san}</button>;
                  })}
                  {filteredMoves.length === 0 && <p className="p-2 text-[10px] text-[#85847d]">Нет ходов этого типа.</p>}
                </div>
              </div>
              <p className="mt-2 text-[9px] text-[#77766f]">Выбери ход, чтобы сыграть его на доске.</p>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}