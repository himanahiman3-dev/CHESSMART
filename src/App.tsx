import { useCallback, useRef, useState } from "react";
import { EngineProvider, useEngine } from "./hooks/useEngine";
import { EngineLoader } from "./components/EngineLoader";
import { ImportScreen } from "./components/ImportScreen";
import { AnalyzingScreen } from "./components/AnalyzingScreen";
import { ReviewScreen } from "./components/ReviewScreen";
import { reviewGame, type AnalyzeProgress } from "./lib/analyze";
import type { GameReview } from "./types";

type Stage = "import" | "analyzing" | "review";

function Main() {
  const { engine, status } = useEngine();
  const [stage, setStage] = useState<Stage>("import");
  const [progress, setProgress] = useState<AnalyzeProgress | null>(null);
  const [review, setReview] = useState<GameReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(
    async (pgn: string, depth: number) => {
      if (!engine) return;
      const ac = new AbortController();
      abortRef.current = ac;
      setError(null);
      setProgress(null);
      setStage("analyzing");
      try {
        const r = await reviewGame(pgn, depth, engine, setProgress, ac.signal);
        setReview(r);
        setStage("review");
      } catch (e) {
        if (ac.signal.aborted) {
          setStage("import");
        } else {
          setError(e instanceof Error ? e.message : String(e));
          setStage("import");
        }
      }
    },
    [engine]
  );

  if (status !== "ready" || !engine) return <EngineLoader />;

  if (stage === "analyzing")
    return (
      <AnalyzingScreen
        progress={progress}
        onCancel={() => {
          abortRef.current?.abort();
        }}
      />
    );

  if (stage === "review" && review) return <ReviewScreen review={review} onNew={() => setStage("import")} />;

  return (
    <>
      {error && (
        <div className="fixed inset-x-0 top-0 z-50 bg-[#ca3431] px-4 py-2 text-center text-sm font-semibold text-white">
          Ошибка анализа: {error}
        </div>
      )}
      <ImportScreen onStart={(pgn, depth) => void start(pgn, depth)} />
    </>
  );
}

export default function App() {
  return (
    <EngineProvider>
      <Main />
    </EngineProvider>
  );
}
