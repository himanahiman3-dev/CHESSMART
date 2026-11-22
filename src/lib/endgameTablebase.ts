import { Chess } from "chess.js";

export interface SyzygyMove {
  uci: string;
  san: string;
  category?: string;
  dtz?: number | null;
  dtm?: number | null;
}

export interface SyzygyResult {
  category: string;
  dtz?: number | null;
  dtm?: number | null;
  checkmate?: boolean;
  stalemate?: boolean;
  moves: SyzygyMove[];
}

export function countPositionPieces(fen: string): number {
  const placement = fen.trim().split(/\s+/)[0] ?? "";
  return (placement.match(/[pnbrqk]/gi) ?? []).length;
}

/**
 * Query the Lichess-hosted Syzygy 7-piece tablebase.
 * A 404 means the position is outside the available tablebase (or unsupported).
 */
export async function lookupSyzygy(fen: string, signal?: AbortSignal): Promise<SyzygyResult | null> {
  const chess = new Chess(fen);
  const normalizedFen = chess.fen();
  const pieceCount = countPositionPieces(normalizedFen);
  if (pieceCount > 7) throw new Error("Syzygy поддерживает не более семи фигур на доске.");
  if (pieceCount < 2) throw new Error("Для таблицы окончаний нужна корректная позиция с двумя королями.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (signal?.aborted) controller.abort();

  try {
    const queryFen = normalizedFen.replace(/\s+/g, "_");
    const response = await fetch(
      "https://tablebase.lichess.ovh/standard?fen=" + encodeURIComponent(queryFen),
      { signal: controller.signal, headers: { Accept: "application/json" } },
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(response.status === 429
        ? "Lichess временно ограничил частоту запросов к Syzygy."
        : "Сервис Syzygy ответил HTTP " + response.status + ".");
    }
    const payload = await response.json() as Partial<SyzygyResult>;
    if (typeof payload.category !== "string" || !Array.isArray(payload.moves)) {
      throw new Error("Сервис Syzygy вернул ответ неизвестного формата.");
    }
    return {
      category: payload.category,
      dtz: typeof payload.dtz === "number" ? payload.dtz : null,
      dtm: typeof payload.dtm === "number" ? payload.dtm : null,
      checkmate: payload.checkmate === true,
      stalemate: payload.stalemate === true,
      moves: payload.moves.filter((move): move is SyzygyMove =>
        !!move && typeof move.uci === "string" && typeof move.san === "string"),
    };
  } catch (error) {
    if (signal?.aborted) throw new Error("Проверка Syzygy отменена.");
    if (controller.signal.aborted) throw new Error("Syzygy не ответила за 8 секунд.");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
