import { useEffect, useMemo, useState } from "react";
import type { Color, GameReview } from "../types";
import { useEngine } from "../hooks/useEngine";
import { reviewGame, type AnalyzeProgress } from "../lib/analyze";

interface Props {
  gameKey: string;
  pgn: string;
  playerColor: Color;
  onAnalyzed: (review: GameReview, color: Color) => void;
  onOpenReview: (review: GameReview) => void;
  onClose: () => void;
}

export function GameFinishedReviewOverlay({
  gameKey,
  pgn,
  playerColor,
  onAnalyzed,
  onOpenReview,
  onClose,
}: Props) {
  const { engine, status, start, computeProfile } = useEngine();
  const [progress, setProgress] = useState<AnalyzeProgress | null>(null);
  const [review, setReview] = useState<GameReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Онлайн-игра не обязана заранее загружать Stockfish. Поднимем движок,
    // когда открылся послематчевый экран.
    if (!engine && status === "idle") void start();
  }, [engine, status, start]);

  useEffect(() => {
    if (status === "error" && !engine) {
      setError("Stockfish не загрузился. Перезапусти страницу и открой анализ ещё раз.");
      return;
    }
    if (!engine || !pgn.trim()) return;
    const controller = new AbortController();
    let current = true;
    setProgress(null);
    setReview(null);
    setError(null);

    // Быстрый предварительный проход: полный отчёт будет готов к нажатию кнопки.
    void reviewGame(pgn, 300, engine, (next) => {
      if (current) setProgress(next);
    }, controller.signal, computeProfile)
      .then((result) => {
        if (!current || controller.signal.aborted) return;
        setReview(result);
        onAnalyzed(result, playerColor);
      })
      .catch((reason: unknown) => {
        if (!current || controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [engine, pgn, playerColor, gameKey, computeProfile, onAnalyzed]);

  const ownMoves = useMemo(
    () => review?.moves.filter((move) => move.color === playerColor) ?? [],
    [review, playerColor],
  );
  const counts = useMemo(() => ownMoves.reduce(
    (result, move) => {
      result[move.cls] += 1;
      return result;
    },
    { best: 0, brilliant: 0, great: 0, blunder: 0 },
  ), [ownMoves]);
  const total = progress?.total ?? 1;
  const done = progress?.done ?? 0;
  const depthProgress = progress?.targetDepth
    ? Math.min(1, progress.depth / progress.targetDepth)
    : 0;
  const percent = review ? 100 : Math.min(99, Math.round(((done + depthProgress) / total) * 100));
  const elapsedSeconds = Math.max(0, Math.floor((progress?.elapsedMs ?? 0) / 1000));

  return (
    <div className="cm-game-review-overlay" role="dialog" aria-modal="true" aria-labelledby="cm-postgame-title">
      <div className="cm-game-review-backdrop" />
      <section className="cm-game-review-card">
        <div className="cm-game-review-orb cm-game-review-orb-one" />
        <div className="cm-game-review-orb cm-game-review-orb-two" />
        <header className="cm-game-review-header">
          <span className="cm-game-review-mark">♟</span>
          <div>
            <div className="cm-game-review-eyebrow">CHESSMART · GAME REVIEW</div>
            <h2 id="cm-postgame-title">Партия завершена</h2>
          </div>
          <button type="button" className="cm-game-review-close" onClick={onClose} aria-label="Закрыть">×</button>
        </header>

        <div className="cm-game-review-intro">
          <span className="cm-game-review-spark">✦</span>
          <div>
            <strong>{review ? "Предварительный анализ готов" : "Разбираем твои ходы"}</strong>
            <p>{review ? "Вот качество твоей игры в этой партии." : status === "idle" || status === "checking" || status === "loading" ? "Подготавливаем Stockfish и проверяем только твои ходы." : "Stockfish проверяет только твои ходы. Кнопка станет доступна сразу после проверки."}</p>
          </div>
        </div>

        <div className="cm-game-review-stats" aria-live="polite">
          <div className="best"><strong>{review ? counts.best : "—"}</strong><span>Лучшие</span></div>
          <div className="brilliant"><strong>{review ? counts.brilliant : "—"}</strong><span>Блестящие</span></div>
          <div className="great"><strong>{review ? counts.great : "—"}</strong><span>Сильные</span></div>
          <div className="blunder"><strong>{review ? counts.blunder : "—"}</strong><span>Зевки</span></div>
        </div>

        <div className="cm-game-review-progress">
          <div className="cm-game-review-progress-label">
            <span>{error ? "Не удалось завершить проверку" : review ? "Проверка завершена" : "Stockfish 19 анализирует"}</span>
            <b>{review ? "100%" : `${percent}%`}</b>
          </div>
          <div className="cm-game-review-progress-track"><span style={{ width: `${percent}%` }} /></div>
          {error
            ? <p className="cm-game-review-error">{error}</p>
            : <small>{review ? `${ownMoves.length} твоих ходов проверено · быстрый анализ` : `${done} / ${total} позиций · ${elapsedSeconds} сек.`}</small>}
        </div>

        <button
          type="button"
          className="cm-game-review-cta"
          disabled={!review}
          onClick={() => { if (review) onOpenReview(review); }}
        >
          <span>{review ? "Анализировать партию" : "Готовим анализ…"}</span>
          <b>→</b>
        </button>
        <button type="button" className="cm-game-review-later" onClick={onClose}>Вернуться к результатам</button>
        <p className="cm-game-review-footnote">Личная статистика учитывает только ходы твоей стороны.</p>
      </section>
    </div>
  );
}
