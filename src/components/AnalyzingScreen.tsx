import { memo, useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import type { AnalyzeProgress } from "../lib/analyze";
import { Logo } from "./EngineLoader";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const AnalyzingBoard = memo(function AnalyzingBoard({ fen }: { fen: string }) {
  const options = useMemo(() => ({
    position: fen,
    allowDragging: false,
    darkSquareStyle: { backgroundColor: "#73905d" },
    lightSquareStyle: { backgroundColor: "#d6dfc3" },
    showNotation: true,
    animationDurationInMs: 120,
  }), [fen]);

  return <Chessboard options={options} />;
});

export function AnalyzingScreen({ progress, onCancel }: { progress: AnalyzeProgress | null; onCancel: () => void }) {
  const total = progress?.total ?? 1;
  const done = progress?.done ?? 0;
  const depthFrac = progress && progress.targetDepth ? Math.min(1, progress.depth / progress.targetDepth) : 0;
  const pct = Math.min(100, ((done + depthFrac) / total) * 100);
  const [screenElapsedSeconds, setScreenElapsedSeconds] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const update = () => setScreenElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = Math.max(screenElapsedSeconds, Math.floor((progress?.elapsedMs ?? 0) / 1000));
  const mins = Math.floor(elapsed / 60);
  const secs = String(elapsed % 60).padStart(2, "0");
  const fen = useMemo(() => {
    if (!progress?.fen) return START_FEN;
    try {
      return new Chess(progress.fen).fen();
    } catch {
      return START_FEN;
    }
  }, [progress?.fen]);

  return (
    <main className="analyzing-screen relative flex min-h-screen items-center justify-center overflow-hidden bg-[#1d211c] px-4 py-8 text-[#f0f2eb]">
      <div className="pointer-events-none absolute -left-32 -top-40 h-[480px] w-[480px] rounded-full bg-[#8dbb61]/[0.07] blur-[120px]" />
      <div className="relative w-full max-w-5xl">
        <header className="mb-6 flex items-center gap-3">
          <Logo size={42} />
          <div>
            <div className="text-sm font-black tracking-[0.04em] text-white">CHESSMART</div>
            <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-[#839078]">Game review session</div>
          </div>
          <div className="ml-auto inline-flex items-center gap-2 rounded-full border border-[#8eaf68]/20 bg-[#2c3627] px-3 py-2 text-[9px] font-extrabold uppercase tracking-[0.12em] text-[#c3d9ac]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#a6d36e]" />
            {progress?.stage === "prepare" ? "Подготовка Stockfish" : "Stockfish работает"}
          </div>
        </header>

        <section className="overflow-hidden rounded-[28px] border border-[#414a3b] bg-[#272c25] shadow-[0_28px_90px_rgba(0,0,0,.32)]">
          <div className="border-b border-white/[0.06] px-5 py-5 sm:px-8">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#8fa17f]">{progress?.stage === "prepare" ? "Подготовка движков" : "Параллельный анализ партии"}</div>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-black tracking-[-0.04em] text-white sm:text-3xl">{progress?.stage === "prepare" ? "Запускаем четыре движка." : "Разбираем каждый ход."}</h1>
                <p className="mt-1.5 text-xs leading-relaxed text-[#929d89]">{progress?.stage === "prepare" ? "Загружаем и проверяем каждый воркер перед первым ходом. Поиск ещё не начат." : "Движок оценивает позиции и ищет лучшие продолжения."}</p>
              </div>
              <div className="font-mono text-2xl font-black tabular-nums text-[#b5d98e]">{pct.toFixed(0)}<span className="ml-1 text-sm text-[#839078]">%</span></div>
            </div>
          </div>

          <div className="analyzing-grid grid gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(280px,.8fr)_minmax(0,1.2fr)]">
            <div className="analyzing-board rounded-2xl border border-white/[0.06] bg-[#20241e] p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between px-1">
                <span className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#839078]">Позиция на доске</span>
                <span className="rounded-full bg-[#34432b] px-2 py-1 text-[8px] font-bold text-[#b5d98e]">LIVE</span>
              </div>
              <div className="mx-auto w-full max-w-[360px] overflow-hidden rounded-xl border border-black/20 shadow-2xl shadow-black/20">
                <AnalyzingBoard fen={fen} />
              </div>
              <div className="mt-3 flex items-center justify-between px-1 text-[9px] text-[#7f8a76]">
                <span>Текущая FEN-позиция</span>
                <span className="font-mono">SF 19</span>
              </div>
            </div>

            <div className="flex flex-col">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-white/[0.05] bg-[#20241e] p-3">
                  <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#77836f]">Позиция</div>
                  <div className="mt-1.5 text-lg font-black tabular-nums text-white">{progress?.stage === "prepare" ? "Пул" : Math.min(done + 1, total)}<span className="ml-1 text-[10px] font-bold text-[#7f8b75]">{progress?.stage === "prepare" ? "4 воркера" : "/ " + total}</span></div>
                </div>
                <div className="rounded-xl border border-white/[0.05] bg-[#20241e] p-3">
                  <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#77836f]">Активные воркеры</div>
                  <div className="mt-1.5 text-lg font-black tabular-nums text-white">{progress?.activeWorkers ?? 0}<span className="ml-1 text-[10px] font-bold text-[#7f8b75]">шт.</span></div>
                </div>
                <div className="col-span-2 rounded-xl border border-white/[0.05] bg-[#20241e] p-3 sm:col-span-1">
                  <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#77836f]">Время</div>
                  <div className="mt-1.5 text-lg font-black tabular-nums text-white">{mins}:{secs}</div>
                </div>
              </div>

              <div className="mt-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-extrabold text-white">{progress?.stage === "prepare" ? "Проверяем пул воркеров" : progress?.stage === "verify" ? "Проверка критических ходов" : progress?.stage === "finalize" ? "Формирование отчёта" : "Параллельный проход"}</div>
                    <div className="mt-1 text-[10px] text-[#87917e]">{progress?.stage === "prepare" ? "Каждый движок должен вернуть полноценный поисковый результат" : "Независимые позиции распределяются между воркерами Stockfish"}</div>
                  </div>
                  <span className="text-[10px] font-bold tabular-nums text-[#b5d98e]">{done} / {total}</span>
                </div>
                <div
                  className="mt-3 h-2.5 overflow-hidden rounded-full bg-[#3b4433]"
                  role="progressbar"
                  aria-label="Прогресс анализа партии"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(pct)}
                >
                  <div className="h-full rounded-full bg-gradient-to-r from-[#83ad5f] to-[#b4d98b] transition-[width] duration-200" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap justify-between gap-2 text-[9px] text-[#7f8a76]">
                  <span>{progress?.stage === "prepare" ? "Первый поиск ещё не запущен" : (progress?.cached ?? 0) + " позиций взято из кэша"}</span>
                  <span>{progress?.stage === "prepare" ? "Инициализация и проверка" : "MultiPV 1 · лимит узлов · локальный WASM"}</span>
                </div>
              </div>

              <div className="analyzing-explanation mt-6 rounded-xl border border-[#71865c]/20 bg-[#32402b]/35 p-4">
                <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.13em] text-[#b8d69a]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#a6d36e]" />
                  Что происходит
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#a9b59e]">
                  {progress?.stage === "prepare"
                    ? "Сначала загружаются файлы и запускаются четыре независимых однопоточных Web Worker. Если один из них падает во время партии, его незавершённая позиция передаётся оставшимся живым движкам."
                    : "Независимые позиции распределяются между отдельными однопоточными Web Worker. Основной проход использует MultiPV 1 и лимит узлов с защитным таймаутом; затем критические позиции перепроверяются с MultiPV 2. Анализ остаётся локальным в браузере."}
                </p>
              </div>

              <button type="button" onClick={onCancel} className="mt-auto flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.035] px-4 py-3 text-xs font-extrabold text-[#c7d0be] transition hover:border-[#849a70]/40 hover:bg-white/[0.07] sm:w-auto sm:self-end">
                Отменить анализ
              </button>
            </div>
          </div>
        </section>
        <p className="analyzing-footer mt-4 text-center text-[9px] font-semibold uppercase tracking-[0.14em] text-[#687362]">Твой PGN остаётся в браузере · Chessmart</p>
      </div>
    </main>
  );
}
