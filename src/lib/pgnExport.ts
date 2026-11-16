import type { GameReview } from "../types";
import { CLS_META } from "../types";

const STANDARD_START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function escapeTag(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}

function safeComment(value: string): string {
  return value.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

/** Создаёт совместимый PGN с комментариями тренера и лучшим вариантом движка. */
export function createAnnotatedPgn(review: GameReview): string {
  const headers: Record<string, string> = { ...review.headers };
  const result = ["1-0", "0-1", "1/2-1/2"].includes(headers.Result ?? "") ? headers.Result : "*";
  headers.Result = result;

  if (review.startFen && review.startFen !== STANDARD_START) {
    headers.SetUp = "1";
    headers.FEN = review.startFen;
  }

  const tags = Object.entries(headers)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `[${key} "${escapeTag(String(value))}"]`);

  const fenFields = (review.startFen || STANDARD_START).split(" ");
  let moveNumber = Math.max(1, Number.parseInt(fenFields[5] ?? "1", 10) || 1);
  let previousColor: "w" | "b" | null = fenFields[1] === "b" ? "b" : null;
  const moves: string[] = [];

  for (const move of review.moves) {
    if (move.color === "w") {
      moves.push(`${moveNumber}.`);
    } else if (previousColor !== "w") {
      moves.push(`${moveNumber}...`);
    }

    moves.push(move.san);
    const classification = CLS_META[move.cls]?.ru ?? move.cls;
    const commentParts = [classification, move.comment];
    if (move.bestSan && move.bestSan !== move.san) {
      commentParts.push(`Лучший ход Stockfish: ${move.bestSan}`);
    }
    moves.push(`{ ${safeComment(commentParts.filter(Boolean).join(". "))} }`);

    if (move.color === "b") moveNumber += 1;
    previousColor = move.color;
  }

  const movetext = [...moves, result].join(" ");
  return `${tags.join("\n")}\n\n${movetext}\n`;
}

/** Скачивает PGN локально, не отправляя партию на сервер. */
export function downloadAnnotatedPgn(review: GameReview): void {
  const pgn = createAnnotatedPgn(review);
  const blob = new Blob([pgn], { type: "application/x-chess-pgn;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const names = [review.headers.White ?? "White", review.headers.Black ?? "Black"]
    .map((name) => name.replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 32))
    .filter(Boolean);
  const date = (review.headers.Date ?? new Date().toISOString().slice(0, 10)).replace(/[^0-9-]/g, "");
  link.href = url;
  link.download = `ChessReview_${names.join("-") || "Game"}_${date || "analysis"}.pgn`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
