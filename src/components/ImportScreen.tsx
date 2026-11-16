import { useEffect, useRef, useState } from "react";
import { Logo } from "./EngineLoader";
import { useEngine } from "../hooks/useEngine";
import { SAMPLE_GAMES, fetchGameFromLink } from "../lib/importers";
import { parseGame } from "../lib/analyze";
import { clearPositionCache, positionCacheSize } from "../lib/db";
import { clearEngineCache } from "../lib/engineFiles";

export const DEPTHS = [
  { id: "fast", depth: 14, title: "Быстрый", desc: "Глубина 14" },
  { id: "deep", depth: 18, title: "Глубокий", desc: "Глубина 18" },
  { id: "max", depth: 22, title: "Максимальный", desc: "Глубина 22+" },
] as const;

export function ImportScreen({ onStart }: { onStart: (pgn: string, depth: number) => void }) {
  const { info } = useEngine();
  const [pgn, setPgn] = useState("");
  const [link, setLink] = useState("");
  const [depthId, setDepthId] = useState<(typeof DEPTHS)[number]["id"]>("fast");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cacheCount, setCacheCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void positionCacheSize().then(setCacheCount);
  }, []);

  const go = (text: string) => {
    try {
      const g = parseGame(text);
      setError(null);
      onStart(text, DEPTHS.find((d) => d.id === depthId)!.depth);
      return g;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const loadLink = async () => {
    setBusy(true);
    setError(null);
    try {
      const text = await fetchGameFromLink(link);
      setPgn(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setPgn(await f.text());
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#312e2b] p-4 text-white sm:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo />
            <div>
              <h1 className="text-2xl font-extrabold leading-tight">Chess Review</h1>
              <p className="text-sm text-[#a7a6a2]">Обзор партии как на Chess.com — бесплатно и локально</p>
            </div>
          </div>
          {info && (
            <div className="rounded-full bg-[#262421] px-3 py-1.5 text-xs text-[#a7a6a2]">
              <span className="mr-1 text-[#81b64c]">●</span>
              Stockfish 19 · {info.variant === "full" ? "Полная" : "Lite"} · {info.threaded ? `${info.threads} потоков` : "1 поток"}
              {info.fromCache ? " · из кэша" : ""}
            </div>
          )}
        </header>

        <section className="rounded-2xl bg-[#262421] p-5 shadow-xl shadow-black/30 sm:p-6">
          <label className="mb-2 block text-sm font-bold text-[#c7c6c2]">PGN партии</label>
          <textarea
            value={pgn}
            onChange={(e) => setPgn(e.target.value)}
            placeholder={'[Event "…"]\n[White "…"]\n\n1. e4 e5 2. Nf3 Nc6 …'}
            className="h-44 w-full resize-y rounded-lg border-2 border-[#3d3a37] bg-[#1f1d1b] p-3 font-mono text-sm text-white outline-none placeholder:text-[#6b6964] focus:border-[#81b64c]"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => fileRef.current?.click()} className="rounded-lg bg-[#3d3a37] px-4 py-2 text-sm font-semibold hover:bg-[#4b4844]">
              📂 Загрузить .pgn
            </button>
            <input ref={fileRef} type="file" accept=".pgn,.txt,text/plain" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
            {pgn && (
              <button onClick={() => setPgn("")} className="rounded-lg bg-[#3d3a37] px-4 py-2 text-sm font-semibold hover:bg-[#4b4844]">
                Очистить
              </button>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Ссылка на партию (lichess.org/…)"
              className="flex-1 rounded-lg border-2 border-[#3d3a37] bg-[#1f1d1b] px-3 py-2 text-sm outline-none placeholder:text-[#6b6964] focus:border-[#81b64c]"
            />
            <button
              onClick={() => void loadLink()}
              disabled={!link.trim() || busy}
              className="rounded-lg bg-[#3d3a37] px-4 py-2 text-sm font-semibold hover:bg-[#4b4844] disabled:opacity-40"
            >
              {busy ? "Загрузка…" : "Загрузить по ссылке"}
            </button>
          </div>

          <div className="mt-5">
            <div className="mb-2 text-sm font-bold text-[#c7c6c2]">Глубина анализа</div>
            <div className="grid grid-cols-3 gap-2">
              {DEPTHS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setDepthId(d.id)}
                  className={`rounded-lg border-2 px-2 py-2.5 text-center transition ${
                    depthId === d.id ? "border-[#81b64c] bg-[#2f3a28]" : "border-[#3d3a37] bg-[#2b2926] hover:border-[#5d5a55]"
                  }`}
                >
                  <div className="text-sm font-bold">{d.title}</div>
                  <div className="text-xs text-[#a7a6a2]">{d.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {error && <div className="mt-4 rounded-lg border border-[#ca3431]/50 bg-[#ca3431]/10 p-3 text-sm text-[#ffb4b2]">{error}</div>}

          <button
            onClick={() => go(pgn)}
            disabled={!pgn.trim()}
            className="mt-5 w-full rounded-xl bg-[#81b64c] py-3.5 text-lg font-extrabold shadow-[0_4px_0_#45753c] transition hover:bg-[#95c75f] active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            🔍 Начать обзор партии
          </button>
        </section>

        <section className="mt-5 rounded-2xl bg-[#262421] p-5 sm:p-6">
          <div className="mb-3 text-sm font-bold text-[#c7c6c2]">Примеры партий</div>
          <div className="space-y-2">
            {SAMPLE_GAMES.map((g) => (
              <button
                key={g.title}
                onClick={() => {
                  setPgn(g.pgn);
                  setError(null);
                }}
                className="flex w-full items-center justify-between rounded-lg bg-[#2b2926] px-4 py-3 text-left text-sm hover:bg-[#35322e]"
              >
                <span>{g.title}</span>
                <span className="text-[#81b64c]">Вставить →</span>
              </button>
            ))}
          </div>
        </section>

        <footer className="mt-5 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-[#8b8987]">
          <span>В кэше позиций (IndexedDB): {cacheCount}</span>
          <span className="flex gap-3">
            <button
              className="underline hover:text-white"
              onClick={async () => {
                await clearPositionCache();
                setCacheCount(0);
              }}
            >
              Очистить кэш позиций
            </button>
            <button
              className="underline hover:text-white"
              onClick={async () => {
                if (confirm("Удалить скачанный движок из кэша? Он будет загружен заново при следующем запуске.")) {
                  await clearEngineCache();
                  location.reload();
                }
              }}
            >
              Удалить кэш движка
            </button>
          </span>
        </footer>
      </div>
    </div>
  );
}
