import { useEngine } from "../hooks/useEngine";
import { getFileSet, type EngineVariant } from "../lib/engineFiles";

const mb = (b: number) => (b / 1048576).toFixed(1);

export function Logo({ size = 44 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-2xl border border-[#b8d79b]/20 bg-gradient-to-br from-[#a5ce78] to-[#6e994f] text-[#172013] shadow-[0_8px_24px_rgba(117,164,78,.22)]"
      style={{ width: size, height: size, fontSize: size * 0.62 }}
      aria-hidden="true"
    >
      ♞
    </div>
  );
}

export function EngineLoader() {
  const { status, progress, error, variant, setVariant, start, isolated, cachedVariants, computeProfile } = useEngine();
  const threadedMode = isolated && computeProfile.device === "desktop" && computeProfile.maxThreads > 1;
  const busy = status === "loading" || status === "checking";
  const pct = progress ? Math.min(100, (progress.loaded / progress.total) * 100) : 0;

  const options: { id: EngineVariant; title: string; desc: string; detail: string }[] = [
    {
      id: "full",
      title: "Stockfish 19 Full",
      desc: "Полная нейросеть NNUE и максимальная сила анализа.",
      detail: "≈ 99 МБ",
    },
    {
      id: "lite",
      title: "Stockfish 19 Lite",
      desc: "Компактная сборка. Быстрее загружается, немного слабее.",
      detail: "≈ 1.7 МБ",
    },
  ];

  return (
    <section aria-labelledby="engine-loader-title" className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#1d211c] px-4 py-8 text-[#f0f2eb]">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -left-32 -top-40 h-[500px] w-[500px] rounded-full bg-[#8dbb61]/[0.08] blur-[120px]" />
        <div className="absolute -bottom-40 -right-20 h-[420px] w-[420px] rounded-full bg-[#8dbb61]/[0.045] blur-[120px]" />
        <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
      </div>

      <div className="relative w-full max-w-5xl">
        <header className="mb-7 flex items-center gap-3">
          <Logo size={48} />
          <div>
            <div className="text-lg font-black tracking-[0.04em] text-white">CHESSMART</div>
            <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-[#849078]">Chess analysis studio</div>
          </div>
          <div className="ml-auto hidden items-center gap-2 rounded-full border border-[#8eaf68]/20 bg-[#2c3627] px-3 py-2 text-[10px] font-bold text-[#c3d9ac] sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[#a6d36e]" />
            Локальный движок
          </div>
        </header>

        <div className="grid overflow-hidden rounded-[28px] border border-[#414a3b] bg-[#272c25] shadow-[0_28px_90px_rgba(0,0,0,.32)] lg:grid-cols-[1.1fr_.9fr]">
          <section className="p-6 sm:p-9">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#8fa17f]">Первый запуск</div>
            <h1 id="engine-loader-title" className="mt-3 max-w-xl text-3xl font-black leading-[1.06] tracking-[-0.04em] text-white sm:text-4xl">
              Подготовим движок
              <span className="block text-[#b5d98e]">для твоих партий.</span>
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-[#aab4a0]">
              Stockfish работает прямо в браузере. Выбери сборку один раз — файлы сохранятся локально и не придётся скачивать их при каждом запуске.
            </p>

            {status === "checking" && (
              <div className="mt-6 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-[#20241e] px-4 py-3 text-xs text-[#a9b39f]">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#627456] border-t-[#b5d98e]" />
                Проверяю локальный кэш движка…
              </div>
            )}

            {!busy && status !== "ready" && (
              <>
                <div className="mt-7 space-y-3">
                  <div className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#87937c]">Выбери сборку</div>
                  {options.map((option) => {
                    const set = getFileSet(option.id, threadedMode);
                    const active = variant === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setVariant(option.id)}
                        aria-pressed={active}
                        className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-all ${active ? "border-[#91b56c] bg-gradient-to-r from-[#3a4b31] to-[#303a2a] shadow-[inset_0_0_0_1px_rgba(169,210,128,.07)]" : "border-[#434b3e] bg-[#222620] hover:border-[#69785b] hover:bg-[#2c3328]"}`}
                      >
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ${active ? "bg-[#a7cb7d] text-[#1b2516]" : "bg-[#343b30] text-[#9ca891]"}`}>♞</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-extrabold text-white">{option.title}</span>
                            {cachedVariants[option.id] && <span className="rounded-full bg-[#a5c87b]/15 px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-[0.1em] text-[#bad89b]">В кэше</span>}
                          </span>
                          <span className="mt-1 block text-[11px] leading-relaxed text-[#929d89]">{option.desc}</span>
                          <span className="mt-2 block text-[9px] font-bold uppercase tracking-[0.12em] text-[#829078]">{option.detail} · {mb(set.totalBytes)} МБ точный размер</span>
                        </span>
                        <span className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${active ? "border-[#b6d992] bg-[#a7cb7d] text-[#1b2516]" : "border-[#5b6554] text-transparent"}`}>
                          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden="true"><path d="m3 8 3.1 3.1L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </span>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => void start(variant)}
                  className="mt-6 flex w-full items-center justify-between rounded-2xl bg-gradient-to-r from-[#a5ce78] to-[#8dbb61] px-5 py-4 text-left text-[#172013] shadow-[0_8px_26px_rgba(133,181,91,.17)] transition hover:from-[#b6dc8a] hover:to-[#9bc96e]"
                >
                  <span>
                    <span className="block text-sm font-black">{cachedVariants[variant] ? "Запустить движок" : "Скачать и запустить"}</span>
                    <span className="mt-0.5 block text-[10px] font-semibold opacity-70">Выбран {variant === "full" ? "Full" : "Lite"} · Stockfish 19</span>
                  </span>
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/10 text-xl">→</span>
                </button>
              </>
            )}

            {status === "loading" && (
              <div className="mt-7 rounded-2xl border border-[#46513f] bg-[#20241e] p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-extrabold text-white">
                    {progress?.phase === "download" ? "Скачиваю файлы движка…" : progress?.fromCache ? "Загружаю из локального кэша…" : "Инициализация движка…"}
                  </span>
                  <span className="font-mono font-bold tabular-nums text-[#b5d98e]">{pct.toFixed(0)}%</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#394132]">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#83ad5f] to-[#b4d98b] transition-[width] duration-200" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap justify-between gap-2 text-[10px] tabular-nums text-[#87917e]">
                  <span>{progress ? `${mb(progress.loaded)} / ${mb(progress.total)} МБ` : "Подготовка…"}</span>
                  <span>{progress?.phase === "download" && progress.speed > 0 ? `${mb(progress.speed)} МБ/с` : progress?.file ?? ""}</span>
                </div>
                {progress && progress.loaded >= progress.total && <p className="mt-4 text-[10px] font-semibold text-[#b1c69a]">Компиляция WebAssembly и инициализация NNUE…</p>}
              </div>
            )}

            {status === "error" && (
              <div role="alert" className="mt-5 rounded-2xl border border-[#b85c52]/35 bg-[#6f302a]/20 p-4 text-xs leading-relaxed text-[#f0b2a9]">
                <b className="block text-sm">Не удалось запустить движок</b>
                <span className="mt-1 block">{error}</span>
                <span className="mt-2 block text-[10px] text-[#cf948b]">Проверь соединение. Можно выбрать Lite — он занимает гораздо меньше места.</span>
              </div>
            )}
          </section>

          <aside className="relative overflow-hidden border-t border-white/[0.06] bg-gradient-to-br from-[#20261e] to-[#1b201a] p-6 sm:p-9 lg:border-l lg:border-t-0">
            <div className="pointer-events-none absolute -right-16 -top-12 h-64 w-64 rounded-full border border-white/[0.045]" />
            <div className="pointer-events-none absolute -right-2 top-2 h-40 w-40 rounded-full border border-white/[0.045]" />
            <div className="relative">
              <div className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#829078]">System check</div>
              <h2 className="mt-2 text-lg font-black text-white">Готовность системы</h2>
              <p className="mt-1 text-xs leading-relaxed text-[#87917e]">Параметры, которые влияют на скорость анализа.</p>

              <div className="mt-6 space-y-3">
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#839078]">Многопоточность</span>
                    <span className={`rounded-full px-2.5 py-1 text-[9px] font-extrabold ${threadedMode ? "bg-[#8eb86b]/15 text-[#bce09a]" : "bg-[#c49c56]/15 text-[#e1c184]"}`}>{threadedMode ? "Используется" : "Однопоточный режим"}</span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-[#a1ab98]">
                    {threadedMode ? `ПК использует до ${computeProfile.maxThreads} потоков Stockfish.` : computeProfile.device === "mobile" ? "Телефон использует один поток, чтобы не перегревать устройство и не расходовать батарею." : "Для этого браузера используется однопоточная сборка Stockfish."}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4">
                  <div className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#839078]">Хранение файлов</div>
                  <div className="mt-2 text-sm font-extrabold text-white">IndexedDB + Cache API</div>
                  <p className="mt-1 text-[10px] leading-relaxed text-[#87917e]">Скачанные файлы движка остаются в браузере и используются повторно.</p>
                </div>
                <div className="rounded-2xl border border-[#71865c]/20 bg-[#32402b]/35 p-4">
                  <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.13em] text-[#b8d69a]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#a6d36e]" />
                    Приватность
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-[#a9b59e]">PGN анализируется локально. Сам текст партии не нужно отправлять на сервер.</p>
                </div>
              </div>

              <div className="mt-7 flex items-center justify-between border-t border-white/[0.07] pt-4 text-[9px] font-bold uppercase tracking-[0.15em] text-[#687362]">
                <span>Chessmart engine</span>
                <span>Version 19.0.1</span>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
