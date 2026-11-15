import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import type { AnalyzeProgress } from "../lib/analyze";

export function AnalyzingScreen({ progress, onCancel }: { progress: AnalyzeProgress | null; onCancel: () => void }) {
  const total = progress?.total ?? 1;
  const done = progress?.done ?? 0;
  const depthFrac = progress && progress.targetDepth ? Math.min(1, progress.depth / progress.targetDepth) : 0;
  const pct = Math.min(100, ((done + depthFrac) / total) * 100);
  let fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  if (progress?.fen) {
    try {
      fen = new Chess(progress.fen).fen();
    } catch {
      /* keep */
    }
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#312e2b] p-4 text-white">
      <div className="w-full max-w-md rounded-2xl bg-[#262421] p-6 shadow-2xl shadow-black/50">
        <h2 className="mb-1 text-xl font-extrabold">Анализирую партию…</h2>
        <p className="mb-4 text-sm text-[#a7a6a2]">Stockfish 19 проверяет каждую позицию (MultiPV 2)</p>
        <div className="mx-auto mb-4 w-full max-w-[280px] overflow-hidden rounded">
          <Chessboard
            options={{
              position: fen,
              allowDragging: false,
              darkSquareStyle: { backgroundColor: "#779556" },
              lightSquareStyle: { backgroundColor: "#ebecd0" },
              showNotation: false,
              animationDurationInMs: 100,
            }}
          />
        </div>
        <div className="mb-2 flex justify-between text-sm">
          <span>
            Позиция {Math.min(done + 1, total)} из {total}
          </span>
          <span className="tabular-nums text-[#a7a6a2]">{pct.toFixed(0)}%</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-[#3d3a37]">
          <div className="h-full rounded-full bg-gradient-to-r from-[#81b64c] to-[#a3d160] transition-[width] duration-200" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-xs text-[#a7a6a2]">
          <span>
            Глубина: {progress?.depth ?? 0}/{progress?.targetDepth ?? "…"}
          </span>
          <span>Из кэша: {progress?.cached ?? 0}</span>
        </div>
        <button onClick={onCancel} className="mt-5 w-full rounded-lg bg-[#3d3a37] py-2.5 text-sm font-semibold hover:bg-[#4b4844]">
          Отмена
        </button>
      </div>
    </div>
  );
}
