import { useMemo, useState } from "react";
import { GameBoard } from "./GameBoard";
import { copyText } from "../lib/clipboard";
import {
  diagnosticCategories,
  diagnosticsCsv,
  evaluatePositionDiagnostics,
  filterDiagnostics,
  formatDiagnosticReport,
  validateDiagnosticFen,
  type DiagnosticReport,
  type DiagnosticTone,
} from "../lib/grandmasterDiagnostics";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const toneClass: Record<DiagnosticTone, string> = {
  good: "border-[#5b8243]/40 bg-[#263523]",
  watch: "border-[#b27c42]/40 bg-[#3a3024]",
  info: "border-white/[0.07] bg-[#202820]",
};
const toneLabel: Record<DiagnosticTone, string> = {
  good: "Порог выполнен",
  watch: "Проверить",
  info: "Информация",
};

function downloadFile(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function Grandmaster300Screen({ onBack }: { onBack: () => void }) {
  const [fenInput, setFenInput] = useState(START_FEN);
  const [report, setReport] = useState<DiagnosticReport>(() => evaluatePositionDiagnostics(START_FEN));
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const categories = useMemo(() => diagnosticCategories(), []);
  const visible = useMemo(() => filterDiagnostics(report.results, category, query), [report.results, category, query]);
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of report.results) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    return counts;
  }, [report.results]);

  const analyze = () => {
    const validation = validateDiagnosticFen(fenInput);
    if (!validation.valid || !validation.normalizedFen) {
      setError("Не получилось загрузить FEN: " + (validation.error ?? "неизвестная ошибка"));
      setNotice("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = evaluatePositionDiagnostics(validation.normalizedFen);
      setReport(next);
      setFenInput(next.fen);
      setCategory("");
      setNotice("Готово: рассчитано " + next.total + " проверок.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось проанализировать позицию.");
    } finally {
      setBusy(false);
    }
  };

  const copyReport = async () => {
    const ok = await copyText(formatDiagnosticReport(report));
    setNotice(ok ? "Полный отчёт скопирован." : "Не удалось скопировать отчёт.");
  };
  const copyFen = async () => {
    const ok = await copyText(report.fen);
    setNotice(ok ? "FEN скопирован." : "Не удалось скопировать FEN.");
  };
  const reset = () => {
    setFenInput(START_FEN);
    setReport(evaluatePositionDiagnostics(START_FEN));
    setCategory("");
    setQuery("");
    setError("");
    setNotice("Возвращена начальная позиция.");
  };

  return (
    <main className="min-h-screen bg-[#171c17] px-3 py-5 text-[#eef3e8] sm:px-6 sm:py-7">
      <div className="mx-auto max-w-[1500px]">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#a3d16f]">Chessmart · Grandmaster toolkit</p>
            <h1 className="mt-1 text-2xl font-black sm:text-3xl">Диагностика позиции 300</h1>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[#a5b09d]">
              300 независимых геометрических и позиционных проверок в 30 тематических группах.
              Вставь FEN из партии или лаборатории и получи подробный аудит позиции.
            </p>
          </div>
          <button onClick={onBack} className="rounded-xl border border-[#52604a] bg-[#243023] px-4 py-2.5 text-xs font-bold text-[#e4ecdc] hover:bg-[#30402d]">Назад</button>
        </header>

        <section className="mb-4 rounded-2xl border border-[#52634a]/50 bg-[#202820] p-3 sm:p-4">
          <label htmlFor="gm300-fen" className="mb-2 block text-xs font-bold text-[#dce8d1]">FEN анализируемой позиции</label>
          <div className="flex flex-col gap-2 lg:flex-row">
            <input
              id="gm300-fen"
              value={fenInput}
              onChange={(event) => setFenInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") analyze(); }}
              spellCheck={false}
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#151c15] px-3 py-3 font-mono text-[11px] text-[#e3ebdc] outline-none focus:border-[#8cad67]"
              placeholder="Вставь FEN сюда"
            />
            <button onClick={analyze} disabled={busy} className="rounded-xl bg-[#91bd5e] px-5 py-3 text-xs font-black text-[#17210f] hover:bg-[#a7d477] disabled:opacity-50">
              {busy ? "Анализирую…" : "Проверить 300 пунктов"}
            </button>
            <button onClick={reset} className="rounded-xl border border-white/10 px-4 py-3 text-xs font-bold text-[#c8d2c0] hover:bg-white/[0.05]">Начальная позиция</button>
          </div>
          {error && <p role="alert" className="mt-3 rounded-lg border border-[#9a5147]/40 bg-[#422924] px-3 py-2 text-xs text-[#ffd5ce]">{error}</p>}
          {notice && <p role="status" aria-live="polite" className="mt-3 text-xs font-semibold text-[#b5d78e]">{notice}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => void copyFen()} className="rounded-lg bg-[#303c2d] px-3 py-2 text-[10px] font-bold text-[#dce8d1] hover:bg-[#3b4c35]">Копировать FEN</button>
            <button onClick={() => void copyReport()} className="rounded-lg bg-[#303c2d] px-3 py-2 text-[10px] font-bold text-[#dce8d1] hover:bg-[#3b4c35]">Копировать полный отчёт</button>
            <button onClick={() => downloadFile("chessmart-position-diagnostics.csv", diagnosticsCsv(report), "text/csv;charset=utf-8")} className="rounded-lg bg-[#303c2d] px-3 py-2 text-[10px] font-bold text-[#dce8d1] hover:bg-[#3b4c35]">Скачать CSV</button>
            <button onClick={() => downloadFile("chessmart-position-diagnostics.txt", formatDiagnosticReport(report), "text/plain;charset=utf-8")} className="rounded-lg bg-[#303c2d] px-3 py-2 text-[10px] font-bold text-[#dce8d1] hover:bg-[#3b4c35]">Скачать TXT</button>
          </div>
        </section>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-white/[0.07] bg-[#202820] p-3"><p className="text-[9px] font-bold uppercase tracking-wide text-[#84917d]">Всего проверок</p><p className="mt-1 text-2xl font-black tabular-nums">{report.total}</p></div>
          <div className="rounded-xl border border-[#5b8243]/40 bg-[#263523] p-3"><p className="text-[9px] font-bold uppercase tracking-wide text-[#a6ca86]">Порог выполнен</p><p className="mt-1 text-2xl font-black tabular-nums text-[#c9e5b1]">{report.good}</p></div>
          <div className="rounded-xl border border-[#b27c42]/40 bg-[#3a3024] p-3"><p className="text-[9px] font-bold uppercase tracking-wide text-[#d4a76e]">Проверить</p><p className="mt-1 text-2xl font-black tabular-nums text-[#f1c58e]">{report.watch}</p></div>
          <div className="rounded-xl border border-white/[0.07] bg-[#202820] p-3"><p className="text-[9px] font-bold uppercase tracking-wide text-[#84917d]">Справочные</p><p className="mt-1 text-2xl font-black tabular-nums">{report.info}</p></div>
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(280px,390px)_minmax(0,1fr)]">
          <aside className="space-y-3">
            <section className="rounded-2xl border border-white/[0.07] bg-[#202820] p-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs font-black uppercase tracking-wide text-[#d9e7cf]">Доска</h2>
                <span className="rounded-lg bg-[#303d2d] px-2 py-1 text-[10px] font-bold">{report.status}</span>
              </div>
              <GameBoard fen={report.fen} orientation="white" interactive={false} />
              <p className="mt-2 text-[10px] text-[#8f9b88]">Ход: {report.sideToMove === "w" ? "белые" : "чёрные"}</p>
            </section>
            <section className="rounded-2xl border border-white/[0.07] bg-[#202820] p-3">
              <h2 className="mb-2 text-xs font-black uppercase tracking-wide text-[#d9e7cf]">30 категорий</h2>
              <button onClick={() => setCategory("")} className={"mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[11px] font-bold " + (!category ? "bg-[#3b4d34] text-[#e5f2da]" : "text-[#b7c2ae] hover:bg-white/[0.04]")}>
                <span>Все проверки</span><span>{report.results.length}</span>
              </button>
              <div className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
                {categories.map((item) => (
                  <button key={item} onClick={() => setCategory(item)} className={"flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[11px] font-semibold " + (category === item ? "bg-[#3b4d34] text-[#e5f2da]" : "text-[#aeb9a5] hover:bg-white/[0.04]")}>
                    <span>{item}</span><span className="font-mono text-[10px] text-[#829078]">{categoryCounts.get(item) ?? 0}</span>
                  </button>
                ))}
              </div>
            </section>
          </aside>

          <section className="min-w-0 rounded-2xl border border-white/[0.07] bg-[#202820] p-3 sm:p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-black text-[#e8f0e2]">Результаты диагностики</h2>
                <p className="mt-0.5 text-[10px] text-[#8f9b88]">Показано {visible.length} из {report.total}</p>
              </div>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти проверку…" className="w-full rounded-lg border border-white/10 bg-[#151c15] px-3 py-2 text-xs outline-none focus:border-[#8cad67] sm:max-w-[260px]" />
            </div>
            {visible.length ? (
              <div className="grid gap-2 md:grid-cols-2">
                {visible.map((item) => (
                  <article key={item.id} className={"min-w-0 rounded-xl border p-3 " + toneClass[item.tone]}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[9px] font-bold uppercase tracking-wide text-[#9eac96]">{item.category}</p>
                        <h3 className="mt-1 text-xs font-extrabold leading-snug text-[#edf3e8]">{item.title}</h3>
                      </div>
                      <span className="shrink-0 rounded-lg bg-black/15 px-2 py-1 font-mono text-[11px] font-black text-[#e7efdf]">{item.displayValue}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[9px] font-bold text-[#b8c5ae]">{toneLabel[item.tone]}</span>
                      <span className="text-[9px] text-[#879580]">{item.interpretation}</span>
                    </div>
                    <p className="mt-2 text-[10px] leading-relaxed text-[#a5b09d]">{item.description}</p>
                  </article>
                ))}
              </div>
            ) : <div className="rounded-xl border border-dashed border-white/10 px-4 py-12 text-center text-xs text-[#8f9b88]">Ничего не найдено. Измени фильтр или поисковый запрос.</div>}
          </section>
        </div>

        <p className="mt-4 rounded-xl border border-[#9a7749]/25 bg-[#342d22] p-3 text-[10px] leading-relaxed text-[#d4c2a5]">
          Важно: это расширенный эвристический аудит, а не оценка Stockfish и не предсказание победителя.
          Карта атак псевдолегальная: она не исключает фигуры, связанные абсолютной связкой. Метрики пространства,
          развития, форпостов и пешечной структуры являются приближёнными. Для точной оценки используй анализ движком.
        </p>
      </div>
    </main>
  );
}
