import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useEngine } from "../hooks/useEngine";
import { SAMPLE_GAMES, fetchGameFromLink } from "../lib/importers";
import { parseGame } from "../lib/analyze";
import { clearPositionCache, positionCacheSize } from "../lib/db";
import { clearEngineCache } from "../lib/engineFiles";

export const DEPTHS = [
  {
    id: "fast",
    depth: 14,
    title: "Быстрый",
    desc: "Для первого взгляда на партию",
    note: "Меньше ожидания",
    level: "01",
  },
  {
    id: "deep",
    depth: 18,
    title: "Подробный",
    desc: "Оптимальный баланс анализа",
    note: "Рекомендуем",
    level: "02",
  },
  {
    id: "max",
    depth: 22,
    title: "Максимальный",
    desc: "Больше расчёта в сложных позициях",
    note: "Самый глубокий",
    level: "03",
  },
] as const;

const PIECES = [
  ["♜", "♞", "♝", "♛", "♚", "♝", "♞", "♜"],
  ["♟", "♟", "♟", "♟", "♟", "♟", "♟", "♟"],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["♙", "♙", "♙", "♙", "♙", "♙", "♙", "♙"],
  ["♖", "♘", "♗", "♕", "♔", "♗", "♘", "♖"],
];

function UploadIcon({ className = "h-4 w-4" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4.5 14.5v4A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function PasteIcon({ className = "h-4 w-4" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="7" y="5" width="13" height="16" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M9 5.5V4a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v1.5M4 8v11a2 2 0 0 0 2 2h1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
}

function LinkIcon({ className = "h-4 w-4" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9.5 14.5 14.5 9.5M8 16H6.5a4 4 0 0 1 0-8H11M13 8h4.5a4 4 0 0 1 0 8H13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
}

function SparkIcon({ className = "h-4 w-4" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2ZM19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>;
}

function ArrowRight({ className = "h-4 w-4" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.5 12h14m-5.5-5.5L18.5 12 13 17.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function formatResult(result: string | undefined) {
  if (result === "1-0") return "Победа белых";
  if (result === "0-1") return "Победа чёрных";
  if (result === "1/2-1/2") return "Ничья";
  return "Результат не указан";
}

export function ImportScreen({ onStart }: { onStart: (pgn: string, depth: number) => void }) {
  const { info } = useEngine();
  const [pgn, setPgn] = useState("");
  const [link, setLink] = useState("");
  const [depth, setDepth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("chess-review:analysis-depth");
      const numeric = saved === null ? NaN : Number(saved);
      if (Number.isFinite(numeric) && numeric >= 8 && numeric <= 245) return Math.round(numeric);
      return DEPTHS.find((item) => item.id === saved)?.depth ?? 14;
    } catch {
      return 14;
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [cacheCount, setCacheCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => {
    if (!pgn.trim()) return { game: null, error: null };
    try {
      return { game: parseGame(pgn), error: null };
    } catch (reason) {
      return {
        game: null,
        error: reason instanceof Error ? reason.message : "Не удалось прочитать PGN.",
      };
    }
  }, [pgn]);

  useEffect(() => {
    void positionCacheSize().then(setCacheCount);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("chess-review:analysis-depth", String(depth));
    } catch {
      // Настройка необязательна и не должна мешать анализу.
    }
  }, [depth]);

  const selectedDepth = DEPTHS.find((item) => item.depth === depth);

  const game = parsed.game;
  const displayError = error || (pgn.trim() ? parsed.error : null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      if (!text.trim()) throw new Error("Файл пустой.");
      setPgn(text);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось прочитать файл.");
    }
  };

  const pastePgn = async () => {
    try {
      if (!navigator.clipboard?.readText) {
        throw new Error("Браузер не разрешил доступ к буферу обмена. Открой сайт по HTTPS или вставь PGN вручную.");
      }
      const text = await navigator.clipboard.readText();
      if (!text.trim()) throw new Error("Буфер обмена пустой.");
      setPgn(text);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось вставить PGN. Вставь текст вручную.");
    }
  };

  const loadLink = async () => {
    if (!link.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const text = await fetchGameFromLink(link);
      setPgn(text);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const startReview = () => {
    if (!game) {
      setError(parsed.error || "Сначала добавь PGN с ходами партии.");
      return;
    }
    setError(null);
    onStart(pgn, depth);
  };

  const chooseSample = (samplePgn: string) => {
    setPgn(samplePgn);
    setError(null);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void onFile(event.dataTransfer.files?.[0]);
  };

  const plies = game?.moves.length ?? 0;
  const fullMoves = Math.ceil(plies / 2);
  const white = game?.headers.White || "Белые";
  const black = game?.headers.Black || "Чёрные";

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#20231f] text-[#f0f2eb]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-56 left-[16%] h-[520px] w-[520px] rounded-full bg-[#78a84b]/[0.09] blur-[120px]" />
        <div className="absolute right-[-12%] top-[30rem] h-[420px] w-[420px] rounded-full bg-[#a2c96c]/[0.035] blur-[110px]" />
        <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.7) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
      </div>

      <div className="relative mx-auto w-full max-w-[1440px] px-4 pb-10 pt-7 sm:px-6 sm:pt-9 xl:px-10">
        <section className="relative mb-7 overflow-hidden rounded-[28px] border border-[#566348]/45 bg-gradient-to-br from-[#303b2a] via-[#272e25] to-[#242722] p-5 shadow-[0_24px_70px_rgba(0,0,0,.22)] sm:p-8 lg:p-9">
          <div className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full border border-white/[0.06]" />
          <div className="pointer-events-none absolute -right-10 -top-16 h-52 w-52 rounded-full border border-white/[0.06]" />
          <div className="relative grid items-center gap-7 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="max-w-3xl">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-[#a8c986]/25 bg-[#a8c986]/10 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#c5e3a4]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#a6d36e] shadow-[0_0_10px_#a6d36e]" />
                  Game review studio
                </span>
                {info && (
                  <>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/15 px-3 py-1.5 text-[10px] font-semibold text-[#d0d4c9]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#a6d36e]" />
                      Stockfish 19 · {info.variant === "full" ? "Full" : "Lite"}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#a8c986]/20 bg-[#a8c986]/10 px-3 py-1.5 text-[10px] font-semibold text-[#c5e3a4]">
                      {info.device === "desktop"
                        ? `ПК MAX · ${info.threads} поток(а) · ${info.hashMb} МБ Hash`
                        : "Мобильный режим · оптимизирован"}
                    </span>
                  </>
                )}
              </div>
              <h1 className="max-w-3xl text-3xl font-black leading-[1.04] tracking-[-0.045em] text-white sm:text-4xl lg:text-[3.45rem]">
                Каждая партия
                <span className="block text-[#b4d58a]">может стать сильнее.</span>
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-[#c1c8b8] sm:text-base sm:leading-7">
                Найди неточности, разберись в решающих моментах и посмотри лучшие продолжения.
                Stockfish анализирует партию прямо в твоём браузере.
              </p>
              <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[11px] font-semibold text-[#c2cbb8]">
                <span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#a9d276]" />Локальный анализ</span>
                <span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#a9d276]" />Без регистрации</span>
                <span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#a9d276]" />Stockfish 19</span>
              </div>
            </div>

            <div className="relative mx-auto hidden w-full max-w-[260px] lg:block">
              <div className="absolute -inset-5 rounded-[28px] bg-[#a8ca82]/[0.07] blur-2xl" />
              <div className="relative rounded-[22px] border border-white/10 bg-[#171b16]/75 p-3 shadow-2xl shadow-black/30">
                <div className="mb-3 flex items-center justify-between px-1">
                  <span className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#859078]">Starting position</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-[#9fcd69]" />
                </div>
                <div className="grid aspect-square grid-cols-8 overflow-hidden rounded-lg border border-black/20">
                  {PIECES.flatMap((rank, row) => rank.map((piece, col) => (
                    <div key={row * 8 + col} className={`flex items-center justify-center ${(row + col) % 2 === 0 ? "bg-[#d6dfc3]" : "bg-[#73905d]"}`}>
                      <span className={`select-none text-[21px] leading-none sm:text-[23px] ${row < 2 ? "text-[#252a22] drop-shadow-[0_1px_0_rgba(255,255,255,.25)]" : "text-[#f8f9ec] drop-shadow-[0_1px_1px_rgba(0,0,0,.35)]"}`}>{piece}</span>
                    </div>
                  )))}
                </div>
                <div className="mt-3 flex items-center justify-between px-1">
                  <span className="text-[10px] font-semibold text-[#c5cdb9]">64 squares</span>
                  <span className="text-[10px] font-semibold text-[#9bbd75]">Ready to review</span>
                </div>
              </div>
              <div className="absolute -bottom-4 -left-8 rounded-xl border border-[#8aa96d]/30 bg-[#283225] px-3 py-2 shadow-xl">
                <div className="text-[9px] font-bold uppercase tracking-[0.13em] text-[#8e9b7e]">Engine</div>
                <div className="mt-0.5 text-xs font-extrabold text-[#d5e8bf]">Stockfish 19</div>
              </div>
            </div>
          </div>
        </section>

        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#849078]">Start a new review</div>
            <h2 className="mt-1 text-xl font-black tracking-[-0.03em] text-white sm:text-2xl">Добавь свою партию</h2>
          </div>
          {game && (
            <div className="inline-flex items-center gap-2 rounded-full border border-[#7b9d5d]/30 bg-[#6b8b4d]/10 px-3 py-1.5 text-[10px] font-bold text-[#c4e3a4]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#a6d36e]" />
              PGN распознан
            </div>
          )}
        </div>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(330px,.85fr)]">
          <section className="overflow-hidden rounded-[24px] border border-[#464e40] bg-[#292d27] shadow-[0_18px_55px_rgba(0,0,0,.2)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4 sm:px-6">
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-[0.17em] text-[#8d9a80]">01 / Import</div>
                <h3 className="mt-1 text-base font-extrabold text-white">PGN партии</h3>
              </div>
              <div className="flex items-center gap-1.5 rounded-lg bg-[#1e221d] p-1">
                <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-[11px] font-bold text-[#d7ddce] transition hover:bg-white/[0.07]">
                  <UploadIcon />Файл
                </button>
                <button type="button" onClick={() => void pastePgn()} className="inline-flex items-center gap-2 rounded-md bg-[#3a4931] px-3 py-2 text-[11px] font-bold text-[#d9e9c9] transition hover:bg-[#465b39]">
                  <PasteIcon />Вставить
                </button>
              </div>
              <input ref={fileRef} type="file" accept=".pgn,.txt,text/plain" hidden onChange={(event) => { void onFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
            </div>

            <div className="p-4 sm:p-6">
              <div
                onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
                onDrop={handleDrop}
                className={`relative overflow-hidden rounded-2xl border transition-colors ${dragging ? "border-[#a8d77d] bg-[#43583a]/30" : "border-[#4c5545] bg-[#1d211c]"}`}
              >
                <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#8e9a82]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#91bc68]" />
                    Вставь PGN или перетащи файл
                  </div>
                  {pgn && (
                    <button type="button" onClick={() => { setPgn(""); setError(null); }} className="text-[10px] font-bold text-[#969f8d] transition hover:text-white">
                      Очистить
                    </button>
                  )}
                </div>
                {dragging && (
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[#293823]/95 text-sm font-extrabold text-[#d9edc8] backdrop-blur-sm">
                    Отпусти файл, чтобы загрузить партию
                  </div>
                )}
                <textarea
                  value={pgn}
                  onChange={(event) => { setPgn(event.target.value); setError(null); }}
                  spellCheck={false}
                  aria-label="PGN партии"
                  placeholder={'[Event "Название партии"]\n[White "Белые"]\n[Black "Чёрные"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 …'}
                  className="min-h-[270px] w-full resize-y bg-transparent px-4 py-4 font-mono text-[12px] leading-[1.8] text-[#e7eddf] outline-none placeholder:text-[#677160] sm:min-h-[320px] sm:px-5 sm:py-5 sm:text-[13px]"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-4 py-2.5 text-[10px] text-[#788270] sm:px-5">
                  <span>{pgn.length > 0 ? `${pgn.length.toLocaleString("ru-RU")} символов` : "PGN поддерживает стандартную шахматную нотацию"}</span>
                  <span className="font-semibold text-[#9caf86]">.pgn · .txt</span>
                </div>
              </div>

              {game && (
                <div className="mt-3 rounded-xl border border-[#78995a]/25 bg-[#35432d]/35 p-3.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#9bb77f]">Распознанная партия</span>
                    <span className="text-[10px] font-bold text-[#b6d495]">{formatResult(game.headers.Result)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm font-extrabold text-white">
                    <span className="min-w-0 truncate">{white}</span>
                    <span className="shrink-0 text-[10px] font-bold text-[#84917a]">VS</span>
                    <span className="min-w-0 truncate">{black}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[#9aa58e]">
                    <span>{fullMoves} {fullMoves === 1 ? "ход" : fullMoves >= 2 && fullMoves <= 4 ? "хода" : "ходов"}</span>
                    {game.headers.Date && <span>{game.headers.Date}</span>}
                    {game.headers.ECO && <span>ECO {game.headers.ECO}</span>}
                  </div>
                </div>
              )}

              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="lichess-link" className="text-[11px] font-bold text-[#c8d0bd]">Или загрузи партию по ссылке</label>
                  <span className="text-[9px] font-bold uppercase tracking-[0.13em] text-[#7d8a73]">Lichess</span>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-[#454e3f] bg-[#1f231e] px-3 focus-within:border-[#83a95f]">
                    <LinkIcon className="h-4 w-4 shrink-0 text-[#8c9c7d]" />
                    <input
                      id="lichess-link"
                      value={link}
                      onChange={(event) => setLink(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Enter") void loadLink(); }}
                      placeholder="lichess.org/…"
                      className="h-11 min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-[#687260]"
                    />
                  </div>
                  <button type="button" onClick={() => void loadLink()} disabled={!link.trim() || busy} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#59654d] bg-[#34412d] px-4 text-xs font-extrabold text-[#d7e6c8] transition hover:bg-[#405137] disabled:cursor-not-allowed disabled:opacity-40">
                    {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#d7e6c8]/30 border-t-[#d7e6c8]" /> : <ArrowRight />}
                    {busy ? "Загружаю…" : "Загрузить"}
                  </button>
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-[#77816f]">Chess.com не отдаёт PGN напрямую браузеру. Для него скопируй PGN на странице партии и вставь в поле выше.</p>
              </div>

              {displayError && (
                <div role="alert" className="mt-4 flex items-start gap-2.5 rounded-xl border border-[#b85c52]/35 bg-[#6f302a]/20 px-3.5 py-3 text-xs leading-relaxed text-[#f0b2a9]">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[#df8d80] text-[10px] font-black">!</span>
                  <span>{displayError}</span>
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-5">
            <section className="rounded-[24px] border border-[#464e40] bg-[#292d27] p-5 shadow-[0_18px_55px_rgba(0,0,0,.18)] sm:p-6">
              <div className="mb-4">
                <div className="text-[10px] font-extrabold uppercase tracking-[0.17em] text-[#8d9a80]">02 / Analysis setup</div>
                <h3 className="mt-1 text-base font-extrabold text-white">Глубина анализа</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-[#87917e]">Выбери, насколько подробно движок проверит позиции.</p>
              </div>
              <div className="space-y-2">
                {DEPTHS.map((item) => {
                  const active = depth === item.depth;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setDepth(item.depth)}
                      aria-pressed={active}
                      className={`group flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-all ${active ? "border-[#8eaf68] bg-gradient-to-r from-[#3b4d31] to-[#303b2a] shadow-[inset_0_0_0_1px_rgba(169,210,128,.08)]" : "border-[#434b3e] bg-[#222620] hover:border-[#69785b] hover:bg-[#2c3328]"}`}
                    >
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-mono text-xs font-black ${active ? "bg-[#a7cb7d] text-[#1b2516]" : "bg-[#343b30] text-[#9ca891]"}`}>{item.level}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className={`text-sm font-extrabold ${active ? "text-white" : "text-[#d4dacd]"}`}>{item.title}</span>
                          {item.id === "deep" && <span className="rounded-full bg-[#a5c87b]/15 px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-[0.12em] text-[#bad89b]">Советуем</span>}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-[#909a87]">{item.desc}</span>
                      </span>
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${active ? "border-[#b6d992] bg-[#a7cb7d] text-[#1b2516]" : "border-[#5b6554] text-transparent"}`}>
                        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden="true"><path d="m3 8 3.1 3.1L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 rounded-xl border border-[#8eaf68]/20 bg-[#20241e] px-3.5 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="review-depth-slider" className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#9aa58f]">Точная глубина</label>
                  <span className="font-mono text-base font-black tabular-nums text-[#c5e3a4]">{depth}<span className="ml-1 text-[9px] font-bold uppercase tracking-wider text-[#87947c]">/ 245</span></span>
                </div>
                <input
                  id="review-depth-slider"
                  aria-label="Целевая глубина анализа"
                  type="range"
                  min={8}
                  max={245}
                  step={1}
                  value={depth}
                  onChange={(event) => setDepth(Number(event.target.value))}
                  className="mt-3 w-full cursor-pointer accent-[#a7cb7d]"
                />
                <div className="mt-1 flex justify-between text-[9px] font-semibold text-[#77816f]">
                  <span>8 · быстрее</span>
                  <span>245 · предел Stockfish</span>
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-[#77816f]">Это целевая глубина, а не обещание достигнуть её: движок остановится по лимиту времени или при достижении глубины.</p>
              </div>

              <div className="mt-4 rounded-xl border border-white/[0.06] bg-[#20241e] px-3.5 py-3">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#9aa58f]">
                  <SparkIcon className="h-3.5 w-3.5 text-[#a8ce7e]" />
                  Выбранный режим
                </div>
                <div className="mt-1.5 flex items-end justify-between gap-2">
                  <div className="text-sm font-extrabold text-white">{selectedDepth?.title ?? "Пользовательская"}</div>
                  <div className="font-mono text-lg font-black tabular-nums text-[#b5d98e]">{depth}<span className="ml-1 text-[9px] font-bold uppercase tracking-wider text-[#87947c]">depth</span></div>
                </div>
                <div className="mt-1 text-[10px] text-[#87917e]">{selectedDepth?.note ?? "Глубина настроена вручную"}</div>
              </div>

              <button
                type="button"
                onClick={startReview}
                disabled={!game}
                className="group mt-4 flex w-full items-center justify-between rounded-2xl bg-gradient-to-r from-[#a5ce78] to-[#8dbb61] px-5 py-4 text-left text-[#172013] shadow-[0_8px_26px_rgba(133,181,91,.17)] transition hover:from-[#b6dc8a] hover:to-[#9bc96e] disabled:cursor-not-allowed disabled:from-[#4a5740] disabled:to-[#414d38] disabled:text-[#9ba792] disabled:shadow-none"
              >
                <span>
                  <span className="block text-sm font-black tracking-tight">Начать анализ</span>
                  <span className="mt-0.5 block text-[10px] font-semibold opacity-70">{game ? `${plies} полуходов готовы к проверке` : "Добавь PGN, чтобы продолжить"}</span>
                </span>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/10 transition group-hover:translate-x-0.5">
                  <ArrowRight className="h-5 w-5" />
                </span>
              </button>
              <p className="mt-3 text-center text-[9px] leading-relaxed text-[#77816f]">Текст партии обрабатывается локально. Ссылка Lichess загружается напрямую с площадки.</p>
            </section>

            <section className="rounded-[22px] border border-[#424a3d] bg-gradient-to-br from-[#2d3428] to-[#252a23] p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#91b56c]/20 bg-[#8dbb61]/10 text-[#b5d98e]">
                  <SparkIcon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-extrabold text-white">Движок готов к работе</div>
                  <div className="mt-0.5 text-[10px] text-[#98a28e]">Stockfish 19 · {info?.variant === "lite" ? "Lite-сборка" : "полная сборка"}</div>
                </div>
                <span className="h-2 w-2 rounded-full bg-[#a6d36e] shadow-[0_0_10px_#a6d36e]" />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-[#1f241d]/75 p-3">
                  <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#77836f]">Вычисления</div>
                  <div className="mt-1 text-xs font-extrabold text-[#d5dfca]">{info?.threaded ? `${info.threads} потоков` : "1 поток"}</div>
                </div>
                <div className="rounded-xl bg-[#1f241d]/75 p-3">
                  <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#77836f]">Движок</div>
                  <div className="mt-1 text-xs font-extrabold text-[#d5dfca]">{info?.variant === "full" ? "Full NNUE" : "Lite NNUE"}</div>
                </div>
              </div>
            </section>
          </aside>
        </div>

        <section className="mt-9">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#849078]">Learn from the legends</div>
              <h2 className="mt-1 text-xl font-black tracking-[-0.03em] text-white sm:text-2xl">Попробуй на известных партиях</h2>
              <p className="mt-1 text-xs text-[#8b9582]">Выбери пример — он появится в редакторе PGN.</p>
            </div>
            <span className="rounded-full border border-[#46523d] bg-[#2a3026] px-3 py-1.5 text-[10px] font-bold text-[#a9bd91]">{SAMPLE_GAMES.length} готовых примера</span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {SAMPLE_GAMES.map((sample, index) => {
              const meta = [
                { tag: "Комбинация", year: "1858", sub: "Жертвы и матовая атака", mark: "M" },
                { tag: "Атака", year: "1851", sub: "Романтика шахмат XIX века", mark: "A" },
                { tag: "Тактика", year: "1999", sub: "Динамика и королевская охота", mark: "K" },
              ][index] ?? { tag: "Классика", year: "", sub: "Проверенная партия", mark: "♞" };
              return (
                <button
                  key={sample.title}
                  type="button"
                  onClick={() => chooseSample(sample.pgn)}
                  className="group relative overflow-hidden rounded-2xl border border-[#424a3d] bg-[#292e27] p-4 text-left transition hover:-translate-y-0.5 hover:border-[#7f9f60] hover:bg-[#30372b] sm:p-5"
                >
                  <div className="absolute -right-4 -top-8 text-[100px] font-black leading-none text-white/[0.025] transition group-hover:text-[#b6d98f]/[0.07]">{meta.mark}</div>
                  <div className="relative flex items-start justify-between gap-3">
                    <div>
                      <span className="inline-flex rounded-md border border-[#819d62]/25 bg-[#86a960]/10 px-2 py-1 text-[9px] font-extrabold uppercase tracking-[0.13em] text-[#adca8c]">{meta.tag}</span>
                      <h3 className="mt-3 text-sm font-extrabold leading-snug text-white">{sample.title}</h3>
                      <p className="mt-1.5 text-[10px] text-[#8d9884]">{meta.sub}</p>
                    </div>
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.035] text-[#a9c786] transition group-hover:border-[#91b36b]/40 group-hover:bg-[#91b36b]/10">
                      <ArrowRight />
                    </span>
                  </div>
                  <div className="relative mt-5 flex items-center justify-between border-t border-white/[0.06] pt-3 text-[9px] font-bold uppercase tracking-[0.12em] text-[#72806a]">
                    <span>{meta.year}</span>
                    <span className="text-[#a9c786]">Загрузить пример</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <footer className="mt-8 flex flex-col gap-3 border-t border-white/[0.07] pt-5 text-[10px] text-[#77816f] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#8eb76b]" />
            <span>Локальный кэш позиций: <b className="font-mono text-[#aebba1]">{cacheCount.toLocaleString("ru-RU")}</b></span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <button type="button" className="transition hover:text-[#cbd8bd]" onClick={async () => { await clearPositionCache(); setCacheCount(0); }}>
              Очистить кэш анализа
            </button>
            <button type="button" className="transition hover:text-[#cbd8bd]" onClick={async () => {
              if (confirm("Удалить скачанный движок из кэша? Он будет загружен заново при следующем запуске.")) {
                await clearEngineCache();
                location.reload();
              }
            }}>
              Сбросить кэш движка
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
