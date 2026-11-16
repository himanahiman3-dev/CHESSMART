import { useCallback, useEffect, useRef, useState } from "react";
import { EngineProvider, useEngine } from "./hooks/useEngine";
import { EngineLoader } from "./components/EngineLoader";
import { ImportScreen } from "./components/ImportScreen";
import { AnalyzingScreen } from "./components/AnalyzingScreen";
import { ReviewScreen } from "./components/ReviewScreen";
import { ProfileGamesPanel } from "./components/ProfileGamesPanel";
import { PlayScreen } from "./components/PlayScreen";
import { ProfileScreen } from "./components/ProfileScreen";
import { MistakeTrainerScreen } from "./components/MistakeTrainerScreen";
import { EndgameTrainingScreen } from "./components/EndgameTrainingScreen";
import { OpeningExplorerScreen } from "./components/OpeningExplorerScreen";
import { reviewGame, type AnalyzeProgress } from "./lib/analyze";
import {
  loadPlayerProfile,
  savePlayerProfile,
  recordReviewedGame,
  type PlayerProfile,
} from "./lib/playerProfile";
import type { GameReview } from "./types";

type Stage = "import" | "analyzing" | "review";
type MainMode = "review" | "play" | "profile" | "puzzles" | "endgame" | "openings";

function Main() {
  const { engine, status } = useEngine();
  const [stage, setStage] = useState<Stage>("import");
  const [mode, setMode] = useState<MainMode>("review");
  const [progress, setProgress] = useState<AnalyzeProgress | null>(null);
  const [review, setReview] = useState<GameReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<PlayerProfile>(() => loadPlayerProfile());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => savePlayerProfile(profile), [profile]);

  const start = useCallback(async (pgn: string, depth: number) => {
    if (!engine) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setProgress(null);
    setStage("analyzing");
    try {
      const result = await reviewGame(pgn, depth, engine, setProgress, controller.signal);
      setReview(result);
      setProfile((current) => recordReviewedGame(current, result));
      setMode("review");
      setStage("review");
    } catch (reason) {
      if (controller.signal.aborted) setStage("import");
      else {
        setError(reason instanceof Error ? reason.message : String(reason));
        setStage("import");
      }
    }
  }, [engine]);

  const changeMode = useCallback((next: MainMode) => {
    setMode(next);
    setStage("import");
    setError(null);
  }, []);

  const nav = (
    <div className="sticky top-0 z-40 border-b border-[#3e3b36] bg-[#1d1c1a]/95 px-3 py-2.5 shadow-xl shadow-black/20 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#81b64c] text-xl text-[#17210f] shadow-[0_3px_0_#4e7537]">♞</span>
          <div className="min-w-0">
            <div className="text-xs font-black uppercase tracking-[0.16em] text-[#e9e6de]">Chess Review</div>
            <div className="truncate text-[10px] font-semibold text-[#85827b]">{profile.name} <span className="px-1 text-[#5b5953]">·</span> {profile.rating} Elo</div>
          </div>
        </div>
        <nav aria-label="Главная навигация" className="flex max-w-full flex-wrap gap-1 rounded-xl border border-[#3d3a35] bg-[#151513] p-1">
          {([
            ["review", "Обзор"],
            ["play", "Играть"],
            ["profile", "Профиль"],
            ["puzzles", "Мои задачи"],
            ["endgame", "Эндшпиль"],
            ["openings", "Дебюты"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => changeMode(id)}
              aria-current={mode === id ? "page" : undefined}
              className={`rounded-lg px-2.5 py-2 text-[11px] font-extrabold transition sm:px-3 sm:text-xs ${mode === id ? "bg-[#81b64c] text-[#17210f] shadow-[0_2px_0_#4e7537]" : "text-[#a7a6a2] hover:bg-[#302e2b] hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );

  if (status !== "ready" || !engine) return <EngineLoader />;
  if (stage === "analyzing") return <AnalyzingScreen progress={progress} onCancel={() => abortRef.current?.abort()} />;

  if (mode === "play") return <>{nav}<PlayScreen engine={engine} profile={profile} onFinished={setProfile} onBack={() => changeMode("review")} /></>;
  if (mode === "profile") return <>{nav}<ProfileScreen profile={profile} onChange={setProfile} onBack={() => changeMode("review")} /></>;
  if (mode === "puzzles") return <>{nav}<MistakeTrainerScreen profile={profile} onChange={setProfile} onBack={() => changeMode("review")} /></>;
  if (mode === "endgame") return <>{nav}<EndgameTrainingScreen engine={engine} onBack={() => changeMode("review")} /></>;
  if (mode === "openings") return <>{nav}<OpeningExplorerScreen onBack={() => changeMode("review")} /></>;

  if (stage === "review" && review) {
    return <>{nav}<ReviewScreen review={review} onNew={() => { setReview(null); setMode("review"); setStage("import"); }} /></>;
  }

  return (
    <>
      {nav}
      {error && <div className="fixed inset-x-0 top-12 z-50 bg-[#ca3431] px-4 py-2 text-center text-sm font-semibold text-white">Ошибка анализа: {error}</div>}
      <ImportScreen onStart={(pgn, depth) => void start(pgn, depth)} />
      <ProfileGamesPanel onSelectGame={(pgn) => void start(pgn, 14)} />
    </>
  );
}

export default function App() {
  return <EngineProvider><Main /></EngineProvider>;
}
