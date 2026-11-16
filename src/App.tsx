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
import { reviewGame, type AnalyzeProgress } from "./lib/analyze";
import {
  loadPlayerProfile,
  savePlayerProfile,
  recordReviewedGame,
  type PlayerProfile,
} from "./lib/playerProfile";
import type { GameReview } from "./types";

type Stage = "import" | "analyzing" | "review";
type MainMode = "review" | "play" | "profile" | "puzzles" | "endgame";

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
    <div className="sticky top-0 z-40 border-b border-[#4b4844] bg-[#262421]/95 px-3 py-2 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold text-[#a7a6a2]">{profile.name} · {profile.rating} Elo</div>
        <div className="flex flex-wrap gap-1 rounded-lg bg-[#1f1d1b] p-1">
          {([
            ["review", "Обзор"],
            ["play", "Играть"],
            ["profile", "Профиль"],
            ["puzzles", "Мои задачи"],
            ["endgame", "Эндшпиль"],
          ] as const).map(([id, label]) => (
            <button key={id} onClick={() => changeMode(id)} className={`rounded-md px-2.5 py-1.5 text-xs font-bold ${mode === id ? "bg-[#4b4844] text-white" : "text-[#a7a6a2] hover:text-white"}`}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );

  if (status !== "ready" || !engine) return <EngineLoader />;
  if (stage === "analyzing") return <AnalyzingScreen progress={progress} onCancel={() => abortRef.current?.abort()} />;

  if (mode === "play") return <>{nav}<PlayScreen engine={engine} profile={profile} onFinished={setProfile} onBack={() => changeMode("review")} /></>;
  if (mode === "profile") return <>{nav}<ProfileScreen profile={profile} onChange={setProfile} onBack={() => changeMode("review")} /></>;
  if (mode === "puzzles") return <>{nav}<MistakeTrainerScreen profile={profile} onChange={setProfile} onBack={() => changeMode("review")} /></>;
  if (mode === "endgame") return <>{nav}<EndgameTrainingScreen engine={engine} onBack={() => changeMode("review")} /></>;

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
