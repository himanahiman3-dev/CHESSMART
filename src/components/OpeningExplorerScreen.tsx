import { useMemo, useState } from "react";
import { Chess } from "chess.js";
import { searchOpenings, type OpeningCatalogEntry } from "../lib/openings";
import { copyText } from "../lib/clipboard";
import { GameBoard } from "./GameBoard";

interface Props {
  onBack: () => void;
}

function previewPosition(entry: OpeningCatalogEntry | undefined): { fen: string; movesApplied: number; pgn: string } {
  const chess = new Chess();
  if (!entry) return { fen: chess.fen(), movesApplied: 0, pgn: chess.pgn() };
  let movesApplied = 0;
  for (const san of entry.moves.split(" ").filter(Boolean)) {
    try {
      chess.move(san);
      movesApplied += 1;
    } catch {
      // A bad external line must not crash the whole explorer or its board preview.
      break;
    }
  }
  return { fen: chess.fen(), movesApplied, pgn: chess.pgn() };
}

export function OpeningExplorerScreen({ onBack }: Props) {
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const results = useMemo(() => searchOpenings(query, 100), [query]);
  const selected = results.find((entry) => `${entry.eco}|${entry.moves}` === selectedKey) ?? results[0];
  const preview = useMemo(() => previewPosition(selected), [selected]);

  const copy = async (value: string, label: string) => {
    const ok = await copyText(value);
    setNotice(ok ? `${label} скопирован` : `Не удалось скопировать ${label.toLowerCase()}`);
  };

  return (
    <main className="min-h-screen bg-[#242321] px-3 py-5 text-white sm:px-6 sm:py-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-1 text-[11px] font-extrabold uppercase tracking-[0.22em] text-[#a3d160]">Chess Review · Library</div>
            <h1 className="text-2xl font-black sm:text-3xl">Дебютная энциклопедия</h1>
            <p className="mt-1 text-sm text-[#aaa8a2]">Ищи дебют по названию, ECO-коду или последовательности ходов</p>
          </div>
          <button onClick={onBack} className="rounded-xl border border-[#4a4843] bg-[#302e2b] px-4 py-2.5 text-sm font-bold text-[#e8e6e1] transition hover:border-[#81b64c] hover:bg-[#393732]">← Назад</button>
        </header>

        <section className="mb-4 rounded-2xl border border-[#45423c] bg-[#302e2b] p-3 shadow-xl shadow-black/20 sm:p-4">
          <label htmlFor="opening-search" className="mb-2 block text-xs font-bold text-[#c9c6bf]">Поиск по базе</label>
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[220px] flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#77746f]">⌕</span>
              <input
                id="opening-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Например: Сицилианская, Najdorf, B90, e4 c5…"
                className="w-full rounded-xl border border-[#4a4843] bg-[#201f1d] py-3 pl-9 pr-3 text-sm text-white outline-none transition placeholder:text-[#77746f] focus:border-[#81b64c] focus:ring-2 focus:ring-[#81b64c]/15"
              />
            </div>
            {query && <button onClick={() => setQuery("")} className="rounded-xl bg-[#44413b] px-4 py-2 text-sm font-bold hover:bg-[#514e47]">Очистить</button>}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#85827b]">
            <span>{query ? `Найдено: ${results.length}` : `В базе более 4 000 линий · показаны первые ${results.length}`}</span>
            <span>Источник: Lichess Openings · ECO A00–E99</span>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.9fr)_minmax(480px,1.1fr)]">
          <section className="overflow-hidden rounded-2xl border border-[#45423c] bg-[#302e2b] shadow-xl shadow-black/20">
            <div className="flex items-center justify-between border-b border-[#45423c] px-4 py-3">
              <h2 className="font-extrabold">Каталог</h2>
              <span className="rounded-full bg-[#20201d] px-2.5 py-1 text-[10px] font-bold text-[#a3d160]">{results.length} результатов</span>
            </div>
            <div className="max-h-[72vh] overflow-y-auto p-2">
              {results.length ? results.map((entry) => {
                const key = `${entry.eco}|${entry.moves}`;
                const active = selected?.moves === entry.moves && selected?.eco === entry.eco;
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedKey(key)}
                    className={`mb-1 flex w-full items-start gap-3 rounded-xl p-3 text-left transition last:mb-0 ${active ? "bg-[#3c4931] ring-1 ring-[#81b64c]/70" : "hover:bg-[#3a3833]"}`}
                  >
                    <span className="mt-0.5 min-w-12 rounded-md bg-[#201f1d] px-2 py-1 text-center font-mono text-[11px] font-bold text-[#d7b887]">{entry.eco}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold leading-snug text-[#eeeae2]">{entry.ru}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-[#85827b]">{entry.en}</span>
                      <span className="mt-1 block text-[10px] text-[#a3d160]">{entry.plyCount} полуходов</span>
                    </span>
                    <span className="pt-1 text-[#77746f]">›</span>
                  </button>
                );
              }) : (
                <div className="px-4 py-12 text-center">
                  <div className="text-3xl">♟</div>
                  <p className="mt-3 text-sm font-bold">Ничего не найдено</p>
                  <p className="mt-1 text-xs text-[#85827b]">Попробуй название на английском, русском или ECO-код</p>
                </div>
              )}
            </div>
          </section>

          <section className="min-w-0 rounded-2xl border border-[#45423c] bg-[#302e2b] p-3 shadow-xl shadow-black/20 sm:p-4">
            {selected ? (
              <>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="inline-flex rounded-md bg-[#d7b887]/15 px-2 py-1 font-mono text-[11px] font-bold text-[#d7b887]">{selected.eco}</span>
                    <h2 className="mt-2 text-xl font-black leading-tight sm:text-2xl">{selected.ru}</h2>
                    <p className="mt-1 text-xs text-[#85827b]">{selected.en}</p>
                  </div>
                  <span className="rounded-xl bg-[#20201d] px-3 py-2 text-xs font-bold text-[#a3d160]">{selected.plyCount} полуходов</span>
                </div>

                <div className="mx-auto max-w-[560px] overflow-hidden rounded-xl border border-[#4a4843] bg-[#201f1d] p-2 sm:p-3">
                  <GameBoard fen={preview.fen} orientation="white" interactive={false} />
                </div>
                <div className="mt-3 rounded-xl bg-[#201f1d] p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-extrabold uppercase tracking-wide text-[#bdb9b1]">Последовательность ходов</h3>
                    <span className="text-[10px] text-[#85827b]">Позиция проверена: {preview.movesApplied}/{selected.plyCount}</span>
                  </div>
                  <p className="break-words font-mono text-sm leading-7 text-[#e5e1d9]">{selected.moves}</p>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => void copy(selected.moves, "Линия")} className="rounded-lg bg-[#414039] px-3 py-2 text-xs font-bold hover:bg-[#504e45]">Копировать линию</button>
                  <button onClick={() => void copy(preview.fen, "FEN")} className="rounded-lg bg-[#414039] px-3 py-2 text-xs font-bold hover:bg-[#504e45]">Копировать FEN</button>
                  {notice && <span role="status" aria-live="polite" className="self-center text-xs text-[#a3d160]">{notice}</span>}
                </div>
              </>
            ) : (
              <div className="flex min-h-[420px] items-center justify-center text-sm text-[#85827b]">Выбери дебют из каталога</div>
            )}
          </section>
        </div>

        <p className="mt-4 text-[10px] leading-relaxed text-[#77746f]">База названий и эталонных линий получена из открытого проекта lichess-org/chess-openings (CC0 1.0). Некоторые названия новых вариантов оставлены с оригинальными именами; шахматные термины локализованы автоматически.</p>
      </div>
    </main>
  );
}
