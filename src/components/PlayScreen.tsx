import { useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import type { StockfishEngine } from "../lib/engine";
import { BOT_DIFFICULTIES, botStrengthForElo, recordBotGame } from "../lib/playerProfile";
import type { BoardMove } from "./GameBoard";
import { GameBoard } from "./GameBoard";
import type { PlayerProfile } from "../lib/playerProfile";
import { chooseBotMove, botMistakeLabel } from "../lib/botBrain";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

type Result = "win" | "loss" | "draw";

interface Props {
  engine: StockfishEngine;
  profile: PlayerProfile;
  onFinished: (updatedProfile: PlayerProfile) => void;
  onBack: () => void;
}

function resultText(result: Result): string {
  return result === "win" ? "Ты победил!" : result === "loss" ? "Победил Stockfish." : "Ничья.";
}

export function PlayScreen({ engine, profile, onFinished, onBack }: Props) {
  const [botElo, setBotElo] = useState<number>(BOT_DIFFICULTIES[2].elo);
  const [playerColor, setPlayerColor] = useState<"w" | "b">("w");
  const [fen, setFen] = useState(START_FEN);
  const [started, setStarted] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [finished, setFinished] = useState<Result | null>(null);
  const [resultMessage, setResultMessage] = useState("");
  const [engineError, setEngineError] = useState<string | null>(null);
  const [lastSan, setLastSan] = useState<string[]>([]);
  const finishedRef = useRef(false);
  const game = useMemo(() => new Chess(fen), [fen]);
  const botColor = playerColor === "w" ? "b" : "w";
  const strength = useMemo(() => botStrengthForElo(botElo), [botElo]);
  const disabled = !started || thinking || !!finished || game.isGameOver() || game.turn() !== playerColor;

  const begin = () => {
    engine.newGame();
    finishedRef.current = false;
    setFen(START_FEN);
    setLastSan([]);
    setFinished(null);
    setResultMessage("");
    setEngineError(null);
    setThinking(false);
    setStarted(true);
  };

  const finish = (result: Result) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setFinished(result);
    setStarted(false);
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
      .then((lines) => {
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
        setLastSan((items) => [...items, moved.san]);
        setFen(next.fen());
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
      setLastSan((items) => [...items, played.san]);
      setFen(next.fen());
      return true;
    } catch {
      return false;
    }
  };

  const resign = () => finish("loss");
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
              orientation={playerColor === "w" ? "white" : "black"}
              lastMove={lastSan.length ? (() => {
                const history = game.history({ verbose: true });
                const move = history[history.length - 1];
                return move ? { from: move.from, to: move.to } : null;
              })() : null}
              animKey={lastSan.length}
              interactive={!disabled}
              allowedColor={playerColor}
              onMove={handlePlayerMove}
            />
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="font-bold">{playerColor === "w" ? profile.name : "Stockfish"} · снизу</span>
              <span className="text-xs text-[#a7a6a2]">{thinking ? "Движок думает…" : game.isCheck() ? "Шах" : ""}</span>
            </div>
          </div>

          <aside className="space-y-3">
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
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
