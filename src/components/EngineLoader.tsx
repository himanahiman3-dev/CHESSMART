import { useEngine } from "../hooks/useEngine";
import { getFileSet, type EngineVariant } from "../lib/engineFiles";

const mb = (b: number) => (b / 1048576).toFixed(1);

export function Logo({ size = 44 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl bg-[#81b64c] text-white shadow-[0_4px_0_#45753c]"
      style={{ width: size, height: size, fontSize: size * 0.62 }}
    >
      ♞
    </div>
  );
}

export function EngineLoader() {
  const { status, progress, error, variant, setVariant, start, isolated, cachedVariants } = useEngine();
  const busy = status === "loading" || status === "checking";
  const pct = progress ? Math.min(100, (progress.loaded / progress.total) * 100) : 0;

  const options: { id: EngineVariant; title: string; desc: string }[] = [
    {
      id: "full",
      title: "Stockfish 19 · Полная",
      desc: "Максимальная сила (большая NNUE-сеть). Скачивается один раз и кэшируется.",
    },
    { id: "lite", title: "Stockfish 19 · Lite", desc: "Компактная сеть, стартует мгновенно, чуть слабее." },
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#312e2b] p-4 text-white">
      <div className="w-full max-w-xl rounded-2xl bg-[#262421] p-6 shadow-2xl shadow-black/50 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <Logo />
          <div>
            <h1 className="text-2xl font-extrabold leading-tight">Chess Review</h1>
            <p className="text-sm text-[#a7a6a2]">Обзор партий со Stockfish 19 — всё работает в вашем браузере</p>
          </div>
        </div>

        {status === "checking" && <p className="mb-4 text-sm text-[#a7a6a2]">Проверяю локальный кэш движка…</p>}

        {!busy && status !== "ready" && (
          <>
            <div className="mb-4 space-y-3">
              {options.map((o) => {
                const set = getFileSet(o.id, isolated);
                const active = variant === o.id;
                return (
                  <button
                    key={o.id}
                    onClick={() => setVariant(o.id)}
                    className={`w-full rounded-xl border-2 p-4 text-left transition ${
                      active ? "border-[#81b64c] bg-[#2f3a28]" : "border-[#3d3a37] bg-[#2b2926] hover:border-[#5d5a55]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold">{o.title}</span>
                      <span className="flex items-center gap-2 text-xs">
                        {cachedVariants[o.id] && <span className="rounded bg-[#81b64c]/20 px-2 py-0.5 text-[#a3d160]">в кэше ✓</span>}
                        <span className="text-[#a7a6a2]">≈ {mb(set.totalBytes)} МБ</span>
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[#a7a6a2]">{o.desc}</p>
                  </button>
                );
              })}
            </div>
            <div className="mb-5 rounded-lg bg-[#2b2926] p-3 text-xs leading-relaxed text-[#a7a6a2]">
              <div>
                Режим:{" "}
                <b className={isolated ? "text-[#a3d160]" : "text-[#f7c045]"}>
                  {isolated ? "многопоточный (SharedArrayBuffer доступен)" : "однопоточный (fallback)"}
                </b>
              </div>
              {!isolated && (
                <div className="mt-1">
                  Страница не cross-origin isolated: сервер не отдал COOP/COEP, а Service Worker ещё не активен. После
                  перезагрузки страницы многопоточность включится автоматически, если Service Worker доступен.
                </div>
              )}
              <div className="mt-1">
                Веса нейросети NNUE встроены в .wasm-файл Stockfish.js 19, поэтому скачивается и кэшируется один комплект
                (IndexedDB + Cache API).
              </div>
            </div>
            <button
              onClick={() => void start(variant)}
              className="w-full rounded-xl bg-[#81b64c] py-3.5 text-lg font-extrabold shadow-[0_4px_0_#45753c] transition hover:bg-[#95c75f] active:translate-y-0.5 active:shadow-none"
            >
              {cachedVariants[variant] ? "Запустить движок" : "Скачать и запустить"}
            </button>
          </>
        )}

        {status === "loading" && (
          <div>
            <div className="mb-2 flex items-end justify-between text-sm">
              <span className="font-semibold">
                {progress?.phase === "download" ? "Скачивание движка…" : progress?.fromCache ? "Загрузка из локального кэша…" : "Подготовка движка…"}
              </span>
              <span className="tabular-nums text-[#a7a6a2]">{pct.toFixed(0)}%</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-[#3d3a37]">
              <div className="h-full rounded-full bg-gradient-to-r from-[#81b64c] to-[#a3d160] transition-[width] duration-200" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-xs tabular-nums text-[#a7a6a2]">
              <span>
                {progress ? `${mb(progress.loaded)} / ${mb(progress.total)} МБ` : "…"}
              </span>
              <span>{progress?.phase === "download" && progress.speed > 0 ? `${mb(progress.speed)} МБ/с` : progress?.file ?? ""}</span>
            </div>
            {progress && progress.loaded >= progress.total && (
              <p className="mt-3 animate-pulse text-sm text-[#a7a6a2]">Компиляция WebAssembly и инициализация NNUE…</p>
            )}
          </div>
        )}

        {status === "error" && (
          <div className="mt-4 rounded-lg border border-[#ca3431]/50 bg-[#ca3431]/10 p-3 text-sm text-[#ffb4b2]">
            <b>Не удалось запустить движок:</b> {error}
            <div className="mt-2 text-xs text-[#ffb4b2]/80">Проверьте соединение. Можно выбрать вариант Lite — он лежит прямо в приложении.</div>
          </div>
        )}
      </div>
    </div>
  );
}
