import { useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import type { StockfishEngine } from "../lib/engine";
import { BOT_DIFFICULTIES, botStrengthForElo, recordBotGame } from "../lib/playerProfile";
import type { BoardMove } from "./GameBoard";
import { GameBoard } from "./GameBoard";
import type { PlayerProfile } from "../lib/playerProfile";
import { chooseBotMove, botMistakeLabel } from "../lib/botBrain";
import { resolvePremove, type Premove, formatPremove, MAX_PREMOVE_QUEUE } from "../lib/premoves";
import { loadGameplayPreferences, updateGameplayPreferences, getBoardOrientation, type GameplayPreferences } from "../lib/gameplayPreferences";
import { playSound, preloadSounds, setSoundEnabled, soundForSan } from "../lib/sound";
import { buildPgnFromSan, copyText, downloadTextFile, formatSanMoveList, pgnFilename } from "../lib/gameNotation";
import { replaySanHistory, getPositionInsights, formatMaterialBalance, gamePhaseLabel, terminalStateLabel, isNearFiftyMoveRule } from "../lib/gameInsights";
import type { Color, GameReview } from "../types";
import { GameFinishedReviewOverlay } from "./GameFinishedReviewOverlay";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

type Result = "win" | "loss" | "draw";

interface Props {
  engine: StockfishEngine;
  profile: PlayerProfile;
  onFinished: (updatedProfile: PlayerProfile) => void;
  onPersonalReviewReady: (review: GameReview, color: Color) => void;
  onOpenReview: (review: GameReview, color: Color) => void;
  onBack: () => void;
}

function resultText(result: Result): string {
  return result === "win" ? "Ты победил!" : result === "loss" ? "Победил Stockfish." : "Ничья.";
}

export function PlayScreen({ engine, profile, onFinished, onPersonalReviewReady, onOpenReview, onBack }: Props) {
  const [botElo, setBotElo] = useState<number>(BOT_DIFFICULTIES[1].elo);
  const [playerColor, setPlayerColor] = useState<"w" | "b">("w");
  const [fen, setFen] = useState(START_FEN);
  const [started, setStarted] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [finished, setFinished] = useState<Result | null>(null);
  const [completedPgn, setCompletedPgn] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState("");
  const [engineError, setEngineError] = useState<string | null>(null);
  const [lastSan, setLastSan] = useState<string[]>([]);
  const [redoSan, setRedoSan] = useState<string[]>([]);
  const [premoves, setPremoves] = useState<Premove[]>([]);
  const [premoveMessage, setPremoveMessage] = useState("");
  const [preferences, setPreferences] = useState<GameplayPreferences>(() => loadGameplayPreferences());
  const [boardFlipped, setBoardFlipped] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  const finishedRef = useRef(false);
  const terminalSoundPlayedRef = useRef(false);
  // Rebuild the full move history when possible. Loading only the current FEN
  // discards repetition counters, so a genuine threefold draw would be missed.
  const game = useMemo(() => {
    try {
      const replayed = replaySanHistory(lastSan);
      if (replayed.fen() === fen) return replayed;
    } catch {
      // Fall back to the authoritative local FEN if a stored move list is inconsistent.
    }
    return new Chess(fen);
  }, [fen, lastSan]);
  const botColor = playerColor === "w" ? "b" : "w";
  const strength = useMemo(() => botStrengthForElo(botElo), [botElo]);
  // While a premove is waiting to execute, lock manual input so it cannot race
  // the automatic move when Stockfish hands the turn back.
  const disabled = !started || thinking || !!finished || game.isGameOver() || game.turn() !== playerColor || premoves.length > 0;
  const updatePreference = <K extends keyof GameplayPreferences>(key: K, value: GameplayPreferences[K]) => {
    const next = updateGameplayPreferences(preferences, { [key]: value });
    setPreferences(next);
    setSoundEnabled(next.soundEnabled);
    if (key === "premovesEnabled" && value === false) {
      setPremoves([]);
      setPremoveMessage("Очередь premove очищена.");
    }
  };

  useEffect(() => { setSoundEnabled(preferences.soundEnabled); }, [preferences.soundEnabled]);

  const begin = () => {
    engine.newGame();
    finishedRef.current = false;
    terminalSoundPlayedRef.current = false;
    setFen(START_FEN);
    setLastSan([]);
    setRedoSan([]);
    setPremoves([]);
    setPremoveMessage("");
    setExportNotice("");
    setBoardFlipped(false);
    setFinished(null);
    setCompletedPgn(null);
    setResultMessage("");
    setEngineError(null);
    setThinking(false);
    preloadSounds();
    playSound("game-start");
    setStarted(true);
  };

  const finish = (result: Result) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (!game.isCheckmate() && !terminalSoundPlayedRef.current) {
      terminalSoundPlayedRef.current = true;
      playSound("end");
    }
    setPremoves([]);
    setFinished(result);
    setStarted(false);
    const resultTag = result === "draw" ? "1/2-1/2" : result === "win"
      ? (playerColor === "w" ? "1-0" : "0-1")
      : (playerColor === "w" ? "0-1" : "1-0");
    try {
      const pgn = buildPgnFromSan(lastSan, {
        Event: "CHESSMART vs Stockfish",
        White: playerColor === "w" ? profile.name : "Stockfish",
        Black: playerColor === "b" ? profile.name : "Stockfish",
        WhiteElo: String(playerColor === "w" ? profile.rating : botElo),
        BlackElo: String(playerColor === "b" ? profile.rating : botElo),
        Result: resultTag,
      });
      setCompletedPgn(pgn);
    } catch (reason) {
      setEngineError(reason instanceof Error ? reason.message : String(reason));
    }
    const update = recordBotGame(profile, botElo, result);
    setResultMessage(update.message);
    onFinished(update.profile);
  };

  // После каждого хода игрока движок отвечает из новой FEN-позиции.
  useEffect(() => {
    if (!started || finished || game.isGameOver() || game.turn() !== botColor) return;
    let stale = false;
    const handle = engine.search({
      fen,
      depth: strength.depth,
      multipv: strength.multipv,
      movetimeMs: strength.movetimeMs,
      strength: {
        skillLevel: strength.skillLevel,
        limitStrength: strength.limitStrength,
        elo: strength.elo,
      },
    });
    setThinking(true);
    setEngineError(null);
    handle.promise
      .then(async (lines) => {
        if (stale) return;
        // Небольшая пауза после расчёта делает ответ бота визуально естественнее
        // и даёт игроку время заметить свой последний ход.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
        if (stale) return;
        const legalUci = game.moves({ verbose: true }).map((move) => move.from + move.to + (move.promotion ?? ""));
        const uci = chooseBotMove(lines, legalUci, botElo);
        if (!uci) {
          setEngineError("Stockfish не вернул ход. Попробуй перезапустить партию.");
          setThinking(false);
          return;
        }
        const next = new Chess(fen);
        const moved = next.move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci.length > 4 ? uci[4] : "q" });
        if (!moved) {
          setEngineError("Движок вернул нелегальный ход. Перезапусти партию.");
          setThinking(false);
          return;
        }
        setRedoSan([]);
        setLastSan((items) => [...items, moved.san]);
        setFen(next.fen());
        if (next.isGameOver()) terminalSoundPlayedRef.current = true;
        playSound(soundForSan(moved.san, next.isGameOver(), undefined, "opponent"));
        setThinking(false);
      })
      .catch((error: unknown) => {
        if (!stale) {
          setEngineError(error instanceof Error ? error.message : String(error));
          setThinking(false);
        }
      });
    return () => {
      stale = true;
      handle.stop();
    };
  }, [started, finished, fen, botColor, engine, strength, game, botElo]);

  // Execute only the first queued move after the bot's real reply.
  // Every remaining move waits for a later opponent turn and is revalidated then.
  useEffect(() => {
    const premove = premoves[0];
    if (!premove || !started || thinking || finished || game.isGameOver() || game.turn() !== playerColor) return;
    const resolved = resolvePremove(fen, playerColor, premove);
    if (!resolved) {
      setPremoves([]);
      setPremoveMessage("Очередь premove отменена: первый ход стал нелегальным после ответа Stockfish.");
      return;
    }
    const next = new Chess(fen);
    const moved = next.move({
      from: resolved.from as Square,
      to: resolved.to as Square,
      ...(resolved.promotion ? { promotion: resolved.promotion } : {}),
    });
    if (!moved) {
      setPremoves([]);
      setPremoveMessage("Очередь premove отменена: позиция изменилась.");
      return;
    }
    setPremoves((queue) => queue.slice(1));
    setPremoveMessage("Premove сыгран автоматически: " + moved.san);
    setRedoSan([]);
    setLastSan((items) => [...items, moved.san]);
    setFen(next.fen());
    if (next.isGameOver()) terminalSoundPlayedRef.current = true;
    playSound(soundForSan(moved.san, next.isGameOver(), undefined, "premove"));
  }, [premoves, started, thinking, finished, game, fen, playerColor]);

  // Фиксируем результат только один раз — в том числе если мат поставил бот.
  useEffect(() => {
    if (!started || finishedRef.current || !game.isGameOver()) return;
    let result: Result = "draw";
    if (!game.isDraw()) result = game.turn() === playerColor ? "loss" : "win";
    finish(result);
    // finish меняет stage и ставит started=false; повторное срабатывание блокирует finishedRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, started, playerColor]);

  const handlePlayerMove = (move: BoardMove): boolean => {
    if (disabled) return false;
    try {
      const next = new Chess(fen);
      const played = next.move({ from: move.from as Square, to: move.to as Square, promotion: move.uci.length > 4 ? move.uci[4] : undefined });
      if (!played) return false;
      setPremoves([]);
      setPremoveMessage("");
      setRedoSan([]);
      setLastSan((items) => [...items, played.san]);
      setFen(next.fen());
      if (next.isGameOver()) terminalSoundPlayedRef.current = true;
      playSound(soundForSan(played.san, next.isGameOver()));
      return true;
    } catch {
      return false;
    }
  };

  const resign = () => {
    if (preferences.confirmResign && !window.confirm("Сдаться в текущей партии?")) return;
    setPremoves([]);
    finish("loss");
  };
  const copyFen = async () => {
    const copied = await copyText(fen);
    setExportNotice(copied ? "FEN скопирован." : "Не удалось скопировать FEN.");
  };
  const exportPgn = () => {
    try {
      const pgn = buildPgnFromSan(lastSan, {
        Event: "CHESSMART vs Stockfish",
        White: playerColor === "w" ? profile.name : "Stockfish",
        Black: playerColor === "b" ? profile.name : "Stockfish",
        Result: finished === "win" ? (playerColor === "w" ? "1-0" : "0-1") : finished === "loss" ? (playerColor === "w" ? "0-1" : "1-0") : finished === "draw" ? "1/2-1/2" : "*",
      });
      downloadTextFile(pgn, pgnFilename("chessmart-stockfish"));
      setExportNotice("PGN скачан.");
    } catch (reason) { setEngineError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const copyPgn = async () => {
    try {
      const pgn = buildPgnFromSan(lastSan, { Event: "CHESSMART vs Stockfish", White: playerColor === "w" ? profile.name : "Stockfish", Black: playerColor === "b" ? profile.name : "Stockfish" });
      setExportNotice(await copyText(pgn) ? "PGN скопирован." : "Не удалось скопировать PGN.");
    } catch (reason) { setEngineError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const copyMoves = async () => {
    setExportNotice(await copyText(formatSanMoveList(lastSan)) ? "Список ходов скопирован." : "Не удалось скопировать ходы.");
  };
  const undoTurn = () => {
    if (!started || thinking || finished || premoves.length > 0 || !lastSan.length) return;
    try {
      const replay = replaySanHistory(lastSan);
      const count = Math.min(2, lastSan.length);
      const removed = lastSan.slice(-count);
      for (let i = 0; i < count; i++) replay.undo();
      setRedoSan((current) => [...removed, ...current]);
      setLastSan(lastSan.slice(0, -count));
      setFen(replay.fen());
      setPremoves([]);
      setPremoveMessage("Отменён последний ход и ответ Stockfish.");
    } catch (reason) {
      setEngineError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const redoTurn = () => {
    if (!started || thinking || finished || premoves.length > 0 || !redoSan.length) return;
    try {
      const replay = replaySanHistory(lastSan);
      const restored: string[] = [];
      for (const san of redoSan.slice(0, 2)) {
        const move = replay.move(san);
        if (!move) break;
        restored.push(move.san);
      }
      if (!restored.length) return;
      setLastSan((current) => [...current, ...restored]);
      setRedoSan(redoSan.slice(restored.length));
      setFen(replay.fen());
      setPremoves([]);
      setPremoveMessage("Ходы восстановлены.");
    } catch (reason) {
      setEngineError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const positionInsights = useMemo(() => {
    try { return getPositionInsights(fen, replaySanHistory(lastSan)); }
    catch { return getPositionInsights(fen); }
  }, [fen, lastSan]);
  const difficulty = BOT_DIFFICULTIES.find((item) => item.elo === botElo);
  const fullMove = Math.ceil(game.history().length / 2);

  return (
    <div className="min-h-screen bg-[#312e2b] p-3 text-white sm:p-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xl font-extrabold">Игра против Stockfish</div>
            <div className="text-sm text-[#a7a6a2]">Твой рейтинг: {profile.rating} Elo · {profile.name}</div>
          </div>
          <button onClick={onBack} className="rounded-lg bg-[#3d3a37] px-3 py-2 text-sm font-semibold hover:bg-[#4b4844]">Назад</button>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
          <div className="rounded-2xl bg-[#262421] p-3 sm:p-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-bold">{playerColor === "w" ? "Stockfish" : profile.name} · сверху</span>
              <span className="text-xs text-[#a7a6a2]">Ход {fullMove}</span>
            </div>
            <GameBoard
              fen={fen}
              orientation={getBoardOrientation(playerColor, boardFlipped)}
              lastMove={lastSan.length ? (() => {
                const history = game.history({ verbose: true });
                const move = history[history.length - 1];
                return move ? { from: move.from, to: move.to } : null;
              })() : null}
              animKey={lastSan.length}
              interactive={!disabled}
              allowedColor={playerColor}
              onMove={handlePlayerMove}
              premoveEnabled={preferences.premovesEnabled && started && !finished && game.turn() === botColor && !game.isGameOver()}
              premoves={premoves}
              onPremove={(next) => {
                setPremoves((queue) => queue.length < MAX_PREMOVE_QUEUE ? [...queue, next] : queue);
                setPremoveMessage("");
              }}
              onClearPremove={() => { setPremoves([]); setPremoveMessage("Очередь premove отменена."); }}
              theme={preferences.boardTheme}
              showLegalMoves={preferences.showLegalMoves}
              highlightLastMove={preferences.highlightLastMove}
              animations={preferences.boardAnimations}
              autoQueen={preferences.autoQueen}
            />
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="font-bold">{playerColor === "w" ? profile.name : "Stockfish"} · снизу</span>
              <span className="text-xs text-[#a7a6a2]">{thinking ? "Движок думает…" : game.isCheck() ? "Шах" : ""}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button onClick={undoTurn} disabled={!started || thinking || premoves.length > 0 || lastSan.length < 2} className="rounded-lg bg-[#3d3a37] px-3 py-2 text-xs font-bold disabled:opacity-40">Отменить ход</button>
              <button onClick={redoTurn} disabled={!started || thinking || premoves.length > 0 || !redoSan.length} className="rounded-lg bg-[#3d3a37] px-3 py-2 text-xs font-bold disabled:opacity-40">Повторить</button>
              <button onClick={() => setBoardFlipped((value) => !value)} className="rounded-lg bg-[#3d3a37] px-3 py-2 text-xs font-bold">Перевернуть доску</button>
              <button onClick={() => void copyFen()} className="rounded-lg bg-[#3d3a37] px-3 py-2 text-xs font-bold">Копировать FEN</button>
              <button onClick={() => void copyPgn()} disabled={!lastSan.length} className="rounded-lg bg-[#3d3a37] px-3 py-2 text-xs font-bold disabled:opacity-40">Копировать PGN</button>
              <button onClick={exportPgn} disabled={!lastSan.length} className="rounded-lg bg-[#3d3a37] px-3 py-2 text-xs font-bold disabled:opacity-40">Скачать PGN</button>
            </div>
            {premoves.length > 0 && (
              <div className="mt-3 rounded-lg border border-[#8b4444] bg-[#3c2928] px-3 py-2 text-xs text-[#ffd4d1]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b>Очередь premove · {premoves.length}/{MAX_PREMOVE_QUEUE}</b>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setPremoves((queue) => queue.slice(0, -1))} disabled={game.turn() === playerColor} className="rounded-md border border-[#a95a55] px-2 py-1 font-bold disabled:opacity-40">Убрать последний</button>
                    <button type="button" onClick={() => setPremoves([])} disabled={game.turn() === playerColor} className="rounded-md border border-[#a95a55] px-2 py-1 font-bold disabled:opacity-40">Очистить</button>
                  </div>
                </div>
                <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  {premoves.map((move, index) => <li key={index}><span className="text-[#ff9d95]">{index + 1}.</span> {formatPremove(move)}</li>)}
                </ol>
                <p className="mt-2 text-[10px] text-[#d5a6a0]">Каждый ход перепроверяется после ответа соперника.</p>
              </div>
            )}
            {premoveMessage && <p role="status" className="mt-2 text-xs text-[#d8c2a0]">{premoveMessage}</p>}
            {exportNotice && <p role="status" className="mt-2 text-xs text-[#a3d160]">{exportNotice}</p>}
          </div>

          <aside className="space-y-3">
            <div className="rounded-2xl bg-[#262421] p-4">
              <div className="mb-2 flex items-center justify-between text-sm font-extrabold"><span>Позиция сейчас</span><span className="text-[10px] font-semibold text-[#91ad76]">{gamePhaseLabel(positionInsights.phase)}</span></div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-[#1f1d1b] p-2"><div className="text-[#89877f]">Материал белых</div><b className="mt-1 block text-base">{positionInsights.whiteMaterial}</b></div>
                <div className="rounded-lg bg-[#1f1d1b] p-2"><div className="text-[#89877f]">Материал чёрных</div><b className="mt-1 block text-base">{positionInsights.blackMaterial}</b></div>
                <div className="rounded-lg bg-[#1f1d1b] p-2"><div className="text-[#89877f]">Легальных ходов</div><b className="mt-1 block text-base">{positionInsights.legalMoves}</b></div>
                <div className="rounded-lg bg-[#1f1d1b] p-2"><div className="text-[#89877f]">Счётчик 50 ходов</div><b className="mt-1 block text-base">{positionInsights.halfmoveClock}/100</b></div>
              </div>
              <div className="mt-2 rounded-lg bg-[#1f1d1b] p-2 text-xs text-[#b7b4aa]">{formatMaterialBalance(positionInsights.materialBalance)} · {terminalStateLabel(positionInsights.terminal)} · {positionInsights.castling}</div>
              {isNearFiftyMoveRule(fen) && <p className="mt-2 text-[10px] text-[#e7bd73]">При 100 полуходах без взятия или движения пешкой можно заявить ничью.</p>}
            </div>
            <div className="rounded-2xl bg-[#262421] p-4">
              <div className="mb-2 text-sm font-extrabold">Настройки партии</div>
              <div className="space-y-2 text-xs text-[#c2c0b8]">
                <label className="flex items-center justify-between gap-2"><span>Разрешить premove</span><input type="checkbox" checked={preferences.premovesEnabled} onChange={(e) => updatePreference("premovesEnabled", e.target.checked)} className="accent-[#81b64c]" /></label>
                <label className="flex items-center justify-between gap-2"><span>Автопревращение в ферзя</span><input type="checkbox" checked={preferences.autoQueen} onChange={(e) => updatePreference("autoQueen", e.target.checked)} className="accent-[#81b64c]" /></label>
<label className="flex items-center justify-between gap-2"><span>Звук ходов</span><input type="checkbox" checked={preferences.soundEnabled} onChange={(e) => updatePreference("soundEnabled", e.target.checked)} className="accent-[#81b64c]" /></label>
                <label className="flex items-center justify-between gap-2"><span>Подсветка возможных ходов</span><input type="checkbox" checked={preferences.showLegalMoves} onChange={(e) => updatePreference("showLegalMoves", e.target.checked)} className="accent-[#81b64c]" /></label>
                <label className="flex items-center justify-between gap-2"><span>Подсветка последнего хода</span><input type="checkbox" checked={preferences.highlightLastMove} onChange={(e) => updatePreference("highlightLastMove", e.target.checked)} className="accent-[#81b64c]" /></label>
                <label className="flex items-center justify-between gap-2"><span>Анимации фигур</span><input type="checkbox" checked={preferences.boardAnimations} onChange={(e) => updatePreference("boardAnimations", e.target.checked)} className="accent-[#81b64c]" /></label>
                <label className="flex items-center justify-between gap-2"><span>Подтверждать сдачу</span><input type="checkbox" checked={preferences.confirmResign} onChange={(e) => updatePreference("confirmResign", e.target.checked)} className="accent-[#81b64c]" /></label>
                <label className="flex items-center justify-between gap-2"><span>Цвет доски</span><select value={preferences.boardTheme} onChange={(e) => updatePreference("boardTheme", e.target.value as GameplayPreferences["boardTheme"])} className="rounded-md bg-[#1f1d1b] px-2 py-1"><option value="classic">Классическая</option><option value="blue">Синяя</option><option value="walnut">Ореховая</option><option value="violet">Фиолетовая</option></select></label>
              </div>
            </div>

            <div className="rounded-2xl bg-[#262421] p-4">
              <div className="mb-2 text-sm font-extrabold">Сложность соперника</div>
              <select
                value={botElo}
                onChange={(e) => setBotElo(Number(e.target.value))}
                disabled={started}
                className="w-full rounded-lg border border-[#4b4844] bg-[#1f1d1b] px-3 py-2.5 text-sm outline-none focus:border-[#81b64c] disabled:opacity-50"
              >
                {BOT_DIFFICULTIES.map((option) => <option key={option.id} value={option.elo}>{option.label}</option>)}
              </select>
              <div className="mt-2 rounded-lg bg-[#1f1d1b] p-3 text-xs leading-relaxed text-[#a7a6a2]">
                Бот: <b className="text-white">{difficulty?.elo ?? botElo} Elo</b>. {botMistakeLabel(botElo)}. Сила примерная, не официальный рейтинг FIDE или Chess.com.
              </div>
              <div className="mt-3 text-sm font-bold">За кого играешь?</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button disabled={started} onClick={() => setPlayerColor("w")} className={`rounded-lg border px-3 py-2 text-sm font-bold ${playerColor === "w" ? "border-[#81b64c] bg-[#2f3a28]" : "border-[#3d3a37] bg-[#2b2926]"}`}>Белыми</button>
                <button disabled={started} onClick={() => setPlayerColor("b")} className={`rounded-lg border px-3 py-2 text-sm font-bold ${playerColor === "b" ? "border-[#81b64c] bg-[#2f3a28]" : "border-[#3d3a37] bg-[#2b2926]"}`}>Чёрными</button>
              </div>
              {!started ? (
                <button onClick={begin} className="mt-3 w-full rounded-xl bg-[#81b64c] py-3 text-sm font-extrabold text-[#17210f] shadow-[0_3px_0_#45753c] hover:bg-[#95c75f]">{finished ? "Новая партия" : "Начать игру"}</button>
              ) : (
                <button onClick={resign} disabled={thinking} className="mt-3 w-full rounded-lg bg-[#3d3a37] py-2.5 text-sm font-bold hover:bg-[#4b4844] disabled:opacity-40">Сдаться</button>
              )}
            </div>

            {thinking && <div className="rounded-xl bg-[#2f3a28] p-3 text-sm text-[#cfe7ac]">Stockfish выбирает ход…</div>}
            {engineError && <div className="rounded-xl border border-[#ca3431]/50 bg-[#ca3431]/10 p-3 text-sm text-[#ffb4b2]">{engineError}</div>}
            {finished && (
              <div className="rounded-xl border border-[#81b64c]/40 bg-[#2f3a28] p-4">
                <div className="text-lg font-black">{resultText(finished)}</div>
                <div className="mt-1 text-sm text-[#cfe7ac]">{resultMessage}{finished === "win" && botElo < 700 ? " За победу над ботом ниже 700 Elo рейтинг не начисляется." : finished !== "win" ? " Рейтинг за поражение или ничью не меняется." : ""}</div>
              </div>
            )}
            <div className="rounded-xl bg-[#262421] p-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-[#a7a6a2]">Партия</div>
              <div className="max-h-56 overflow-y-auto text-sm leading-relaxed text-[#dcdbd7]">{lastSan.length ? lastSan.map((san, i) => <span key={i} className="mr-2 inline-block">{i % 2 === 0 ? `${Math.floor(i / 2) + 1}.` : ""} {san}</span>) : <span className="text-[#77746f]">Ходы появятся здесь.</span>}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => void copyMoves()} disabled={!lastSan.length} className="rounded-lg bg-[#3d3a37] px-3 py-2 text-xs font-bold disabled:opacity-40">Копировать ходы</button>
                <button onClick={() => downloadTextFile(formatSanMoveList(lastSan), "chessmart-moves.txt")} disabled={!lastSan.length} className="rounded-lg bg-[#3d3a37] px-3 py-2 text-xs font-bold disabled:opacity-40">Скачать ходы TXT</button>
              </div>
            </div>
          </aside>
        </div>
      </div>
      {finished && completedPgn && (
        <GameFinishedReviewOverlay
          gameKey={`bot:${botElo}:${finished}:${lastSan.length}`}
          pgn={completedPgn}
          playerColor={playerColor}
          onAnalyzed={onPersonalReviewReady}
          onOpenReview={(review, color) => onOpenReview(review, color)}
        />
      )}
    </div>
  );
}
