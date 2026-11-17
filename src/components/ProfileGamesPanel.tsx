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
    <section className="mx-auto mt-8 w-full max-w-[1440px] rounded-[24px] border border-[#41493a] bg-[#292d27] p-5 text-white shadow-[0_18px_55px_rgba(0,0,0,.18)] sm:p-7">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#849078]">Import from your account</div>
          <h2 className="mt-1 text-xl font-black tracking-[-0.03em] text-white">Твои последние партии</h2>
          <p className="mt-1 text-xs text-[#929d89]">Загрузи публичную историю и выбери партию для подробного разбора.</p>
        </div>
        <span className="rounded-full border border-[#46523d] bg-[#22271f] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#a9bd91]">Lichess · Chess.com</span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-[150px_1fr_auto]">
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as ChessPlatform)}
          className="h-11 rounded-xl border border-[#454e3f] bg-[#1f231e] px-3 text-xs font-semibold text-white outline-none transition focus:border-[#83a95f]"
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
          className="h-11 min-w-0 rounded-xl border border-[#454e3f] bg-[#1f231e] px-3 text-xs text-white outline-none transition placeholder:text-[#687260] focus:border-[#83a95f]"
        />
        <button
          onClick={() => void load()}
          disabled={!profileInput.trim() || busy}
          className="h-11 rounded-xl bg-gradient-to-r from-[#a5ce78] to-[#8dbb61] px-5 text-xs font-black text-[#172013] shadow-[0_6px_18px_rgba(133,181,91,.12)] transition hover:from-[#b6dc8a] hover:to-[#9bc96e] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Загружаю…" : "Показать партии"}
        </button>
      </div>

      {busy && (
        <div className="mt-3 rounded-xl border border-[#46513f] bg-[#20241e] px-4 py-3 text-xs text-[#a7a6a2]">
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
          <div className="mt-5 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <div className="rounded-xl border border-white/[0.05] bg-[#20241e] p-3"><div className="text-xl font-black tabular-nums text-white">{games.length}</div><div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#829078]">Всего</div></div>
            <div className="rounded-xl border border-white/[0.05] bg-[#20241e] p-3"><div className="text-xl font-black tabular-nums text-[#a3d160]">{wins}</div><div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#829078]">Победы</div></div>
            <div className="rounded-xl border border-white/[0.05] bg-[#20241e] p-3"><div className="text-xl font-black tabular-nums text-[#f08b83]">{losses}</div><div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#829078]">Поражения</div></div>
            <div className="rounded-xl border border-white/[0.05] bg-[#20241e] p-3"><div className="text-xl font-black tabular-nums text-[#d9c17b]">{draws}</div><div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#829078]">Ничьи</div></div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-bold">Партии профиля</div>
            <div className="flex gap-1 rounded-xl border border-[#41493a] bg-[#20241e] p-1">
              {(["all", "win", "loss", "draw"] as const).map((key) => (
                <button key={key} onClick={() => setFilter(key)} className={`rounded-lg px-3 py-1.5 text-[10px] font-bold transition ${filter === key ? "bg-[#3b4931] text-[#d9e9c9]" : "text-[#8e9885] hover:text-white"}`}>
                  {key === "all" ? "Все" : key === "win" ? "+" : key === "loss" ? "−" : "="}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 max-h-[430px] overflow-y-auto rounded-lg border border-[#3d3a37]">
            {visible.map((game, index) => {
              const outcome = outcomeText(game.outcome);
              return (
                <div key={`${game.id}-${index}`} className="flex flex-wrap items-center gap-3 border-b border-white/[0.055] px-4 py-3.5 transition last:border-0 hover:bg-white/[0.025] sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{game.opponent}</div>
                    <div className="mt-1 text-[10px] text-[#899382]">{game.date} · {game.moves} {game.moves === 1 ? "ход" : game.moves >= 2 && game.moves <= 4 ? "хода" : "ходов"} · {game.color === "white" ? "белыми" : game.color === "black" ? "чёрными" : "цвет неизвестен"}</div>
                  </div>
                  <div className={`shrink-0 text-xs font-extrabold ${outcome.className}`}>{outcome.label}</div>
                  <button onClick={() => onSelectGame(game.pgn)} className="shrink-0 rounded-lg border border-[#56634a] bg-[#35412d] px-4 py-2 text-[10px] font-extrabold text-[#d5e5c6] transition hover:border-[#8aa96a] hover:bg-[#405137]">Обзор</button>
                </div>
              );
            })}
            {visible.length === 0 && <div className="p-4 text-center text-sm text-[#a7a6a2]">В этой категории партий нет.</div>}
          </div>
          <div className="mt-3 text-[10px] leading-relaxed text-[#788270]">Показываются публичные партии, доступные через API площадки. Приватные и скрытые игры не загружаются.</div>
        </>
      )}
    </section>
  );
}
