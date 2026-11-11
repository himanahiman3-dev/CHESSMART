"use client";

import { useEffect, useRef, useState } from "react";
import type { EngineSettings } from "@/lib/types";
import { recommendedSettings } from "@/lib/engine";

export interface HistoryItem {
  id: number;
  white: string;
  black: string;
  result: string;
  plies: number;
  depth: number;
  whiteAccuracy: number;
  blackAccuracy: number;
  createdAt: string;
}

export const SAMPLE_PGN = `[Event "Opera Game"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

const MODES = [
  { id: "quick", label: "Quick", depth: 14, hint: "Depth 14 – fastest" },
  { id: "standard", label: "Standard", depth: 20, hint: "Depth 20 – standard review" },
  { id: "deep", label: "Deep", depth: 24, hint: "Depth 24 – deep review (slow)" },
] as const;

interface Props {
  onStart: (text: string, settings: EngineSettings) => void;
  history: HistoryItem[];
  onLoad: (id: number) => void;
  onDelete: (id: number) => void;
  error: string | null;
  busy: boolean;
}

export function InputPanel({ onStart, history, onLoad, onDelete, error, busy }: Props) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<(typeof MODES)[number]["id"]>("standard");
  const [settings, setSettings] = useState<EngineSettings>({ variant: "full", depth: 20, multiPv: 4, threads: 1, hashMb: 1024 });
  const [cores, setCores] = useState(2);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // hydrate machine-specific defaults after mount
    setSettings((s) => ({ ...s, ...recommendedSettings() }));
    setCores(navigator.hardwareConcurrency || 2);
  }, []);

  const depth = MODES.find((m) => m.id === mode)!.depth;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="rounded-xl bg-[#262421] p-5 shadow-xl shadow-black/30 sm:p-6">
        <h2 className="text-xl font-bold text-white">Analyze a game</h2>
        <p className="mt-1 text-sm text-[#a7a6a2]">
          Paste a PGN (any site: Chess.com, Lichess, OTB) or a single FEN. Everything is analysed locally in your browser by Stockfish 19 – unlimited and free.
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          placeholder={'[Event "Casual game"]\n\n1. e4 e5 2. Nf3 Nc6 …   or   rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'}
          className="mt-4 h-56 w-full resize-y rounded-lg border border-[#3c3a37] bg-[#1d1c1a] p-3 font-mono text-sm text-[#e8e8e4] outline-none placeholder:text-[#5f5d5a] focus:border-[#81b64c]"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={() => setText(SAMPLE_PGN)} className="rounded-md bg-[#3c3a37] px-3 py-1.5 text-sm font-semibold text-[#e8e8e4] hover:bg-[#4b4947]">
            Load sample (Opera Game)
          </button>
          <button onClick={() => fileRef.current?.click()} className="rounded-md bg-[#3c3a37] px-3 py-1.5 text-sm font-semibold text-[#e8e8e4] hover:bg-[#4b4947]">
            Upload .pgn
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pgn,.txt"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setText(await f.text());
              e.target.value = "";
            }}
          />
          {text && (
            <button onClick={() => setText("")} className="rounded-md px-3 py-1.5 text-sm text-[#a7a6a2] hover:text-white">
              Clear
            </button>
          )}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-bold uppercase tracking-wide text-[#a7a6a2]">Review depth</label>
            <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-lg bg-[#1d1c1a] p-1">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  title={m.hint}
                  onClick={() => setMode(m.id)}
                  className={`rounded-md px-2 py-1.5 text-sm font-semibold ${mode === m.id ? "bg-[#81b64c] text-white" : "text-[#a7a6a2] hover:text-white"}`}
                >
                  {m.label} · {m.depth}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-wide text-[#a7a6a2]">Network</label>
            <select
              value={settings.variant}
              onChange={(e) => setSettings({ ...settings, variant: e.target.value as "full" | "lite" })}
              className="mt-1.5 w-full rounded-lg border border-[#3c3a37] bg-[#1d1c1a] px-3 py-2 text-sm text-white"
            >
              <option value="full">Stockfish 19 · full NNUE (~100 MB)</option>
              <option value="lite">Stockfish 19 · Lite NNUE (~2 MB, faster load)</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-wide text-[#a7a6a2]">Threads (auto = cores − 1)</label>
            <input
              type="number"
              min={1}
              max={Math.max(1, cores)}
              value={settings.threads}
              onChange={(e) => setSettings({ ...settings, threads: Math.max(1, Math.min(cores, Number(e.target.value) || 1)) })}
              className="mt-1.5 w-full rounded-lg border border-[#3c3a37] bg-[#1d1c1a] px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-wide text-[#a7a6a2]">Hash</label>
            <select
              value={settings.hashMb}
              onChange={(e) => setSettings({ ...settings, hashMb: Number(e.target.value) })}
              className="mt-1.5 w-full rounded-lg border border-[#3c3a37] bg-[#1d1c1a] px-3 py-2 text-sm text-white"
            >
              <option value={256}>256 MB</option>
              <option value={512}>512 MB</option>
              <option value={1024}>1024 MB (max for WASM)</option>
            </select>
          </div>
        </div>

        <p className="mt-3 text-xs text-[#8b8987]">
          MultiPV 4 · NNUE enabled · WebAssembly engines are 32-bit, so Hash is capped at about 1 GB (a 2 GB table does not fit in WASM memory). Multi-threading needs a cross-origin-isolated page; otherwise the single-threaded build is used automatically.
        </p>

        {error && <div className="mt-4 rounded-lg border border-[#ca3431]/60 bg-[#ca3431]/15 px-3 py-2 text-sm text-[#ffb4b2]">{error}</div>}

        <button
          disabled={busy}
          onClick={() => onStart(text, { ...settings, depth, multiPv: 4 })}
          className="mt-5 w-full rounded-lg bg-[#81b64c] py-3 text-lg font-extrabold text-white shadow-[0_4px_0_#4e7837] transition hover:bg-[#95c25e] active:translate-y-0.5 active:shadow-none disabled:opacity-60"
        >
          Start Game Review
        </button>
      </section>

      <aside className="rounded-xl bg-[#262421] p-5 shadow-xl shadow-black/30">
        <h3 className="text-sm font-bold uppercase tracking-wide text-[#a7a6a2]">Saved reviews</h3>
        {history.length === 0 && <p className="mt-3 text-sm text-[#8b8987]">Finished reviews are stored here so you can reopen them instantly without re-analysing.</p>}
        <ul className="mt-3 space-y-2">
          {history.map((h) => (
            <li key={h.id} className="group flex items-center gap-2 rounded-lg bg-[#1d1c1a] p-2.5 hover:bg-[#32302d]">
              <button onClick={() => onLoad(h.id)} className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-semibold text-white">
                  {h.white} <span className="text-[#8b8987]">vs</span> {h.black}
                </div>
                <div className="mt-0.5 text-xs text-[#8b8987]">
                  {h.result} · {Math.ceil(h.plies / 2)} moves · d{h.depth} · {h.whiteAccuracy.toFixed(0)}% / {h.blackAccuracy.toFixed(0)}%
                </div>
              </button>
              <button onClick={() => onDelete(h.id)} title="Delete" className="rounded p-1 text-[#8b8987] opacity-0 hover:text-[#ca3431] group-hover:opacity-100">
                ✕
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
