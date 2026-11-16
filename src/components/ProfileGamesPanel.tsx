import { useEffect, useRef, useState } from "react";
import {
  fetchProfileGames,
  type ChessPlatform,
  type ProfileGame,
  type ProfileGamesProgress,
} from "../lib/profileGames";

interface Props {
  onSelectGame: (pgn: string) => void;
}

const outcomeText = (value: ProfileGame["outcome"]) => {
  if (value === "win") return { label: "Победа", className: "text-[#a3d160]" };
  if (value === "loss") return { label: "Поражение", className: "text-[#f08b83]" };
  if (value === "draw") return { label: "Ничья", className: "text-[#d9c17b]" };
  return { label: "Неизвестно", className: "text-[#a7a6a2]" };
};

export function ProfileGamesPanel({ onSelectGame }: Props) {
  const [platform, setPlatform] = useState<ChessPlatform>("lichess");
  const [profileInput, setProfileInput] = useState("");
  const [games, setGames] = useState<ProfileGame[]>([]);
  const [progress, setProgress] = useState<ProfileGamesProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "win" | "loss" | "draw">("all");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const load = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setGames([]);
    setProgress({ done: 0, total: 0, label: "Подключаюсь к профилю…" });
    try {
      const found = await fetchProfileGames(profileInput, platform, controller.signal, setProgress);
      if (!controller.signal.aborted) setGames(found);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const visible = filter === "all" ? games : games.filter((game) => game.outcome === filter);
  const wins = games.filter((g) => g.outcome === "win").length;
  const losses = games.filter((g) => g.outcome === "loss").length;
  const draws = games.filter((g) => g.outcome === "draw").length;

  return (
    <section className="mx-auto mt-5 max-w-3xl rounded-2xl bg-[#262421] p-5 text-white shadow-xl shadow-black/30 sm:p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-extrabold">История профиля</h2>
          <p className="text-xs text-[#a7a6a2]">Загрузи публичные партии по нику или ссылке профиля</p>
        </div>
        <span className="rounded-full bg-[#1f1d1b] px-3 py-1 text-[11px] text-[#a7a6a2]">Lichess · Chess.com</span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-[150px_1fr_auto]">
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as ChessPlatform)}
          className="rounded-lg border-2 border-[#3d3a37] bg-[#1f1d1b] px-3 py-2 text-sm text-white outline-none focus:border-[#81b64c]"
        >
          <option value="lichess">Lichess</option>
          <option value="chesscom">Chess.com</option>
        </select>
        <input
          value={profileInput}
          onChange={(e) => setProfileInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) void load();
          }}
          placeholder={platform === "lichess" ? "Ник или lichess.org/@/username" : "Ник или chess.com/member/username"}
          className="min-w-0 rounded-lg border-2 border-[#3d3a37] bg-[#1f1d1b] px-3 py-2 text-sm outline-none placeholder:text-[#6b6964] focus:border-[#81b64c]"
        />
        <button
          onClick={() => void load()}
          disabled={!profileInput.trim() || busy}
          className="rounded-lg bg-[#81b64c] px-4 py-2 text-sm font-extrabold text-[#17210f] hover:bg-[#95c75f] disabled:opacity-40"
        >
          {busy ? "Загружаю…" : "Показать партии"}
        </button>
      </div>

      {busy && (
        <div className="mt-3 rounded-lg bg-[#1f1d1b] px-3 py-2 text-sm text-[#a7a6a2]">
          <div>{progress?.label ?? "Загружаю историю…"}</div>
          {progress && progress.total > 0 && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#3d3a37]">
              <div className="h-full bg-[#81b64c]" style={{ width: `${Math.min(100, (progress.done / progress.total) * 100)}%` }} />
            </div>
          )}
        </div>
      )}
      {error && <div className="mt-3 rounded-lg border border-[#ca3431]/50 bg-[#ca3431]/10 p-3 text-sm text-[#ffb4b2]">{error}</div>}

      {games.length > 0 && (
        <>
          <div className="mt-4 grid grid-cols-4 gap-2 text-center">
            <div className="rounded-lg bg-[#1f1d1b] p-2"><div className="text-lg font-black tabular-nums">{games.length}</div><div className="text-[10px] text-[#a7a6a2]">Всего</div></div>
            <div className="rounded-lg bg-[#1f1d1b] p-2"><div className="text-lg font-black tabular-nums text-[#a3d160]">{wins}</div><div className="text-[10px] text-[#a7a6a2]">Победы</div></div>
            <div className="rounded-lg bg-[#1f1d1b] p-2"><div className="text-lg font-black tabular-nums text-[#f08b83]">{losses}</div><div className="text-[10px] text-[#a7a6a2]">Поражения</div></div>
            <div className="rounded-lg bg-[#1f1d1b] p-2"><div className="text-lg font-black tabular-nums text-[#d9c17b]">{draws}</div><div className="text-[10px] text-[#a7a6a2]">Ничьи</div></div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-bold">Партии профиля</div>
            <div className="flex gap-1 rounded-lg bg-[#1f1d1b] p-1">
              {(["all", "win", "loss", "draw"] as const).map((key) => (
                <button key={key} onClick={() => setFilter(key)} className={`rounded px-2 py-1 text-xs ${filter === key ? "bg-[#4b4844] text-white" : "text-[#a7a6a2] hover:text-white"}`}>
                  {key === "all" ? "Все" : key === "win" ? "+" : key === "loss" ? "−" : "="}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 max-h-[430px] overflow-y-auto rounded-lg border border-[#3d3a37]">
            {visible.map((game, index) => {
              const outcome = outcomeText(game.outcome);
              return (
                <div key={`${game.id}-${index}`} className="flex items-center gap-3 border-b border-[#3d3a37] px-3 py-2.5 last:border-0 hover:bg-white/[0.025]">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{game.opponent}</div>
                    <div className="mt-0.5 text-[11px] text-[#8b8987]">{game.date} · {game.moves} {game.moves === 1 ? "ход" : game.moves >= 2 && game.moves <= 4 ? "хода" : "ходов"} · {game.color === "white" ? "белыми" : game.color === "black" ? "чёрными" : "цвет неизвестен"}</div>
                  </div>
                  <div className={`shrink-0 text-xs font-extrabold ${outcome.className}`}>{outcome.label}</div>
                  <button onClick={() => onSelectGame(game.pgn)} className="shrink-0 rounded-md bg-[#3d3a37] px-3 py-1.5 text-xs font-bold hover:bg-[#4b4844]">Обзор</button>
                </div>
              );
            })}
            {visible.length === 0 && <div className="p-4 text-center text-sm text-[#a7a6a2]">В этой категории партий нет.</div>}
          </div>
          <div className="mt-2 text-[10px] leading-relaxed text-[#77746f]">Показываются публичные партии, доступные через API площадки. Приватные и скрытые игры не загружаются.</div>
        </>
      )}
    </section>
  );
}
