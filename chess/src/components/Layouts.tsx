import { useEffect, useState } from "react";
import { ArrowLeftRight, Crown, Plus, RotateCcw } from "lucide-react";
import type { ReviewApp } from "../hooks/useReviewApp";
import Board from "./Board";
import { ImportCard, ProgressCard } from "./forms";
import {
  CoachCard,
  Controls,
  EvalBar,
  EvalGraph,
  MoveList,
  MoveStrip,
  PlayerStrip,
  SummaryCard,
} from "./parts";
import { cn } from "../utils/cn";

function useNames(app: ReviewApp) {
  const h = app.review?.headers ?? {};
  const ok = (v?: string | null) => (v && v !== "?" ? v : undefined);
  const result = ok(h.Result);
  const split = result && result.includes("-") ? result.split("-") : null;
  return {
    white: { name: ok(h.White) ?? "Белые", rating: ok(h.WhiteElo), result: split?.[0] },
    black: { name: ok(h.Black) ?? "Чёрные", rating: ok(h.BlackElo), result: split?.[1] },
  };
}

function Logo({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={cn(
          "flex items-center justify-center rounded-lg bg-[#81b64c] text-white shadow-[0_3px_0_#457524]",
          small ? "h-8 w-8" : "h-9 w-9"
        )}
      >
        <Crown size={small ? 18 : 20} strokeWidth={2.6} />
      </div>
      <div className="leading-none">
        <div className={cn("font-extrabold tracking-tight text-white", small ? "text-[17px]" : "text-[20px]")}>
          Chess<span className="text-[#81b64c]">Review</span>
        </div>
      </div>
    </div>
  );
}

const hint = "Бесплатно · без лимитов · Stockfish 19";

/* =============================== ДЕСКТОП =============================== */
export function DesktopLayout({ app }: { app: ReviewApp }) {
  const { review, view, phase } = app;
  const names = useNames(app);
  const [tab, setTab] = useState<"moves" | "summary">("summary");
  useEffect(() => {
    if (phase === "done") setTab("summary");
  }, [phase]);
  useEffect(() => {
    if (app.ply > 0) setTab("moves");
  }, [app.ply]);

  const top = app.flipped ? names.white : names.black;
  const bottom = app.flipped ? names.black : names.white;
  const topColor = app.flipped ? "w" : "b";
  const bottomColor = app.flipped ? "b" : "w";
  const acc = (c: "w" | "b") => (review && phase === "done" ? review.accuracy[c] : undefined);

  return (
    <div className="min-h-screen bg-[#262421] text-white">
      <header className="flex h-14 items-center justify-between border-b border-black/30 bg-[#21201d] px-6">
        <Logo />
        <div className="rounded-full bg-[#81b64c]/15 px-3 py-1 text-[13px] font-bold text-[#a3d160]">{hint}</div>
      </header>

      <main className="mx-auto flex max-w-[1240px] items-stretch justify-center gap-6 px-6 py-5">
        {/* левая колонка: доска */}
        <div
          className="shrink-0"
          style={{ width: "clamp(340px, min(calc(100vh - 190px), calc(100vw - 520px)), 740px)" }}
        >
          <PlayerStrip {...top} color={topColor} accuracy={acc(topColor)} />
          <div className="flex gap-2.5">
            <EvalBar value={view.value} mate={view.mate} flipped={app.flipped} />
            <div className="min-w-0 flex-1">
              <Board
                fen={view.fen}
                orientation={app.flipped ? "black" : "white"}
                lastMove={app.lastMove}
                arrow={app.arrow}
                badge={app.badge}
              />
            </div>
          </div>
          <PlayerStrip {...bottom} color={bottomColor} accuracy={acc(bottomColor)} />
        </div>

        {/* правая панель */}
        <aside className="relative w-[400px] shrink-0 rounded-xl bg-[#21201d] shadow-lg">
          <div className="absolute inset-0 flex flex-col p-4">
            {phase === "input" && (
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <h1 className="text-[24px] font-extrabold leading-tight">Анализ партий</h1>
                <p className="mb-4 mt-1 text-[14px] text-[#a7a6a2]">
                  Stockfish 19 работает прямо в вашем браузере — без регистрации и ограничений.
                </p>
                <ImportCard app={app} />
              </div>
            )}
            {phase === "analyzing" && (
              <div className="flex flex-1 flex-col justify-center">
                <ProgressCard app={app} />
              </div>
            )}
            {phase === "done" && review && (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="text-[18px] font-extrabold">Обзор партии</div>
                    {review.opening && <div className="max-w-[260px] truncate text-[12px] text-[#a88865]">{review.opening}</div>}
                  </div>
                  <button
                    onClick={app.reset}
                    className="flex items-center gap-1.5 rounded-lg bg-[#81b64c] px-3 py-2 text-[13px] font-extrabold text-white shadow-[0_3px_0_#457524] active:translate-y-0.5 active:shadow-[0_1px_0_#457524]"
                  >
                    <Plus size={16} strokeWidth={3} /> Новый анализ
                  </button>
                </div>
                <CoachCard
                  move={view.move}
                  total={review.moves.length}
                  review={review}
                  ply={app.ply}
                  showBest={app.showBest}
                  onToggleBest={() => app.setShowBest(!app.showBest)}
                />
                <div className="mb-2 mt-3 grid grid-cols-2 gap-1 rounded-lg bg-[#2b2927] p-1">
                  {(["summary", "moves"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={cn(
                        "rounded-md py-1.5 text-[13px] font-bold",
                        tab === t ? "bg-[#403d39] text-white" : "text-[#a7a6a2] hover:text-white"
                      )}
                    >
                      {t === "summary" ? "Итоги" : "Ходы"}
                    </button>
                  ))}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto rounded-lg">
                  {tab === "summary" ? (
                    <SummaryCard review={review} />
                  ) : (
                    <MoveList moves={review.moves} ply={app.ply} onSelect={app.setPly} className="h-full" />
                  )}
                </div>
                <div className="mt-3 space-y-2">
                  <EvalGraph positions={review.positions} moves={review.moves} ply={app.ply} onSelect={app.setPly} />
                  <div className="flex gap-1.5">
                    <div className="flex-1">
                      <Controls ply={app.ply} max={review.moves.length} onSet={app.setPly} />
                    </div>
                    <button
                      onClick={() => app.setFlipped(!app.flipped)}
                      title="Перевернуть доску (F)"
                      className="flex h-10 w-11 items-center justify-center rounded-md bg-[#3d3a37] text-[#e8e7e5] hover:bg-[#4a4743]"
                    >
                      <ArrowLeftRight size={18} className="rotate-90" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}

/* =============================== ТЕЛЕФОН =============================== */
export function MobileLayout({ app }: { app: ReviewApp }) {
  const { review, view, phase } = app;
  const names = useNames(app);
  const [tab, setTab] = useState<"summary" | "moves">("summary");
  useEffect(() => {
    if (phase === "done") setTab("summary");
  }, [phase]);

  const top = app.flipped ? names.white : names.black;
  const bottom = app.flipped ? names.black : names.white;
  const topColor = app.flipped ? "w" : "b";
  const bottomColor = app.flipped ? "b" : "w";
  const acc = (c: "w" | "b") => (review && phase === "done" ? review.accuracy[c] : undefined);

  const swipe = (d: -1 | 1) => phase === "done" && app.setPly(app.ply + d);

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[640px] flex-col bg-[#262421] text-white">
      <header className="safe-top sticky top-0 z-30 border-b border-black/30 bg-[#21201d]/95 backdrop-blur">
        <div className="flex h-12 items-center justify-between px-3">
          <Logo small />
          {phase === "done" ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => app.setFlipped(!app.flipped)}
                aria-label="Перевернуть доску"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#3d3a37] text-[#e8e7e5] active:bg-[#4a4743]"
              >
                <RotateCcw size={17} />
              </button>
              <button
                onClick={app.reset}
                className="flex h-9 items-center gap-1 rounded-lg bg-[#81b64c] px-3 text-[13px] font-extrabold text-white shadow-[0_3px_0_#457524] active:translate-y-0.5 active:shadow-[0_1px_0_#457524]"
              >
                <Plus size={15} strokeWidth={3} /> Новый
              </button>
            </div>
          ) : (
            <span className="rounded-full bg-[#81b64c]/15 px-2.5 py-1 text-[11px] font-bold text-[#a3d160]">Бесплатно</span>
          )}
        </div>
      </header>

      {phase === "input" && (
        <main className="flex-1 space-y-4 px-4 pb-8 pt-5">
          <div>
            <h1 className="text-[26px] font-extrabold leading-tight">Анализ партий</h1>
            <p className="mt-1 text-[14px] leading-snug text-[#a7a6a2]">
              Stockfish 19 прямо в телефоне. {hint.split(" · ").slice(0, 2).join(" и ")}.
            </p>
          </div>
          <ImportCard app={app} mobile />
        </main>
      )}

      {phase !== "input" && (
        <main className={cn("flex-1", phase === "done" ? "pb-[92px]" : "pb-6")}>
          <div className="px-3 pt-2.5">
            <EvalBar horizontal value={view.value} mate={view.mate} flipped={app.flipped} />
          </div>
          <div className="px-3">
            <PlayerStrip {...top} color={topColor} accuracy={acc(topColor)} compact />
          </div>
          <div className="px-1.5">
            <Board
              fen={view.fen}
              orientation={app.flipped ? "black" : "white"}
              lastMove={app.lastMove}
              arrow={app.arrow}
              badge={app.badge}
              onSwipe={swipe}
            />
          </div>
          <div className="px-3">
            <PlayerStrip {...bottom} color={bottomColor} accuracy={acc(bottomColor)} compact />
          </div>

          {phase === "analyzing" && (
            <div className="px-3 pt-2">
              <ProgressCard app={app} />
            </div>
          )}

          {phase === "done" && review && (
            <div className="space-y-3 pt-1">
              <div className="px-3">
                <CoachCard
                  move={view.move}
                  total={review.moves.length}
                  review={review}
                  ply={app.ply}
                  showBest={app.showBest}
                  onToggleBest={() => app.setShowBest(!app.showBest)}
                />
              </div>
              <MoveStrip moves={review.moves} ply={app.ply} onSelect={app.setPly} />
              <div className="px-3">
                <EvalGraph positions={review.positions} moves={review.moves} ply={app.ply} onSelect={app.setPly} />
              </div>
              <div className="px-3">
                <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-[#2b2927] p-1">
                  {(["summary", "moves"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={cn(
                        "rounded-md py-2 text-[14px] font-bold",
                        tab === t ? "bg-[#403d39] text-white" : "text-[#a7a6a2]"
                      )}
                    >
                      {t === "summary" ? "Итоги" : "Все ходы"}
                    </button>
                  ))}
                </div>
                {tab === "summary" ? (
                  <SummaryCard review={review} />
                ) : (
                  <MoveList
                    moves={review.moves}
                    ply={app.ply}
                    onSelect={(p) => {
                      app.setPly(p);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="max-h-[420px] rounded-lg"
                  />
                )}
              </div>
            </div>
          )}
        </main>
      )}

      {phase === "done" && review && (
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[640px] border-t border-black/40 bg-[#21201d]/97 px-3 pt-2 backdrop-blur">
          <Controls ply={app.ply} max={review.moves.length} onSet={app.setPly} big />
        </nav>
      )}
    </div>
  );
}
