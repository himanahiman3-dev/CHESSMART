import { useEffect, useState } from "react";
import type { PlayerProfile } from "../lib/playerProfile";
import type { AccountProfile } from "../lib/accountProfile";
import type { ShellRoute } from "./ChessmartShellScreens";
import { GameBoard } from "./GameBoard";
import { loadGameplayPreferences } from "../lib/gameplayPreferences";

type Navigate = (route: ShellRoute) => void;

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Strict two-column chess play workspace. */
export function PlayHubScreen({ profile, accountProfile, onNavigate }: {
  profile: PlayerProfile;
  accountProfile: AccountProfile | null;
  onNavigate: Navigate;
}) {
  const username = accountProfile?.username ?? profile.name;

  return (
    <div className="cm-replica-page cm-play-page">
      <div className="cm-replica-play-layout">
        <section className="cm-replica-board-column" aria-label="Шахматная доска">
          <div className="cm-replica-player-strip cm-opponent-strip">
            <span className="cm-play-square-avatar cm-play-square-avatar-empty" aria-hidden="true">♟</span>
            <div className="cm-replica-player-copy"><strong>Противник</strong></div>
          </div>
          <div className="cm-replica-board-frame">
            <GameBoard
              fen={START_FEN}
              orientation="white"
              interactive={false}
              theme="classic"
              showLegalMoves={false}
              highlightLastMove={false}
              animations={false}
            />
          </div>
          <div className="cm-replica-player-strip cm-replica-own-player-strip">
            {accountProfile?.avatar_url
              ? <img className="cm-play-square-avatar" src={accountProfile.avatar_url} alt="" />
              : <span className="cm-play-square-avatar cm-play-square-avatar-own" aria-hidden="true">{username.slice(0, 1).toUpperCase()}</span>}
            <div className="cm-replica-player-copy"><strong>{username}</strong></div>
            <span className="cm-replica-rating">{accountProfile?.rapid_rating ?? profile.rating}</span>
          </div>
        </section>

        <aside className="cm-replica-play-panel">
          <div className="cm-replica-play-panel-heading">
            <span aria-hidden="true">♟</span>
            <h1>Играть в шахматы</h1>
          </div>
          <div className="cm-replica-play-actions">
            <button type="button" className="cm-replica-play-action" onClick={() => onNavigate("online")}>
              <span className="cm-replica-action-icon cm-play-icon-yellow" aria-hidden="true">⚡</span>
              <span className="cm-replica-action-copy"><strong>Играть по сети</strong><small>Играть с противником того же уровня</small></span>
            </button>
            <button type="button" className="cm-replica-play-action" onClick={() => onNavigate("play")}>
              <span className="cm-replica-action-icon cm-play-icon-blue" aria-hidden="true">♟</span>
              <span className="cm-replica-action-copy"><strong>Боты</strong><small>Играть с ботами от начинающих до мастеров</small></span>
            </button>
            <button type="button" className="cm-replica-play-action" onClick={() => onNavigate("coach")}>
              <span className="cm-replica-action-icon cm-play-icon-green" aria-hidden="true">♙</span>
              <span className="cm-replica-action-copy"><strong>Играть с тренером</strong><small>Учиться, играя и рассуждая с тренером</small></span>
            </button>
            <button type="button" className="cm-replica-play-action" onClick={() => onNavigate("online")}>
              <span className="cm-replica-action-icon cm-play-icon-purple" aria-hidden="true">♟</span>
              <span className="cm-replica-action-copy"><strong>Играть с другом</strong><small>Пригласить друга на партию в шахматы</small></span>
            </button>
            <button type="button" className="cm-replica-play-action" onClick={() => onNavigate("battle")}>
              <span className="cm-replica-action-icon cm-play-icon-orange" aria-hidden="true">🏆</span>
              <span className="cm-replica-action-copy"><strong>Турниры</strong><small>Присоединиться к арене, где победа означает многое</small></span>
            </button>
            <button type="button" className="cm-replica-play-action" onClick={() => onNavigate("openings")}>
              <span className="cm-replica-action-icon cm-play-icon-cyan" aria-hidden="true">◆</span>
              <span className="cm-replica-action-copy"><strong>Варианты шахмат</strong><small>Откройте для себя новые виды шахмат</small></span>
            </button>
          </div>
          <div className="cm-replica-panel-footer">
            <button type="button" onClick={() => onNavigate("profile")}>▤ Архив партий</button>
            <button type="button" onClick={() => onNavigate("battle")}>♜ Таблица лидеров</button>
          </div>
        </aside>
      </div>
    </div>
  );
}

type ProfileTab = "overview" | "games" | "stats" | "friends" | "awards" | "clubs";

interface OnlineArchiveGame {
  id: string;
  white_id: string;
  black_id: string | null;
  white_name: string;
  black_name: string | null;
  minutes: number;
  increment_seconds: number;
  rated: boolean;
  rating_type: "bullet" | "blitz" | "rapid";
  result: "white_win" | "black_win" | "draw" | null;
  reason: string | null;
  white_rating: number | null;
  black_rating: number | null;
  moves: Array<{ uci?: string; san?: string; color?: "w" | "b" }>;
  created_at: string;
}

function formatProfileDate(value: string | number | null | undefined, withTime = false): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", withTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { day: "numeric", month: "long", year: "numeric" });
}

function profileRatingClass(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "empty";
  return value >= 85 ? "good" : value >= 70 ? "average" : "poor";
}

function averagePhaseAccuracy(
  records: NonNullable<PlayerProfile["personalReviews"]>,
  phase: "opening" | "middlegame" | "endgame",
  ratingType?: "bullet" | "blitz" | "rapid",
): number | null {
  const relevant = records.filter((record) =>
    (!ratingType || record.ratingType === ratingType)
    && Number.isFinite(record.phaseAccuracy?.[phase]?.accuracy)
    && (record.phaseAccuracy?.[phase]?.moves ?? 0) > 0
  );
  if (!relevant.length) return null;
  const totalMoves = relevant.reduce((sum, record) => sum + (record.phaseAccuracy?.[phase]?.moves ?? 0), 0);
  if (!totalMoves) return null;
  return relevant.reduce((sum, record) =>
    sum + (record.phaseAccuracy?.[phase]?.accuracy ?? 0) * (record.phaseAccuracy?.[phase]?.moves ?? 0), 0
  ) / totalMoves;
}

function averageOverallAccuracy(
  records: NonNullable<PlayerProfile["personalReviews"]>,
  ratingType?: "bullet" | "blitz" | "rapid",
): number | null {
  const relevant = records.filter((record) => (!ratingType || record.ratingType === ratingType) && record.moves > 0);
  if (!relevant.length) return null;
  const moves = relevant.reduce((sum, record) => sum + record.moves, 0);
  return relevant.reduce((sum, record) => sum + record.accuracy * record.moves, 0) / moves;
}

function AccuracyValue({ value }: { value: number | null }) {
  if (value === null) return <span className="cm-accuracy-empty">—</span>;
  return <span className={"cm-accuracy-value " + profileRatingClass(value)}>{value.toFixed(1)}%</span>;
}

function ProfileStatsTab({ profile, accountProfile }: { profile: PlayerProfile; accountProfile: AccountProfile | null }) {
  const [period, setPeriod] = useState<"90" | "30" | "all">("90");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const cutoff = period === "all" ? 0 : Date.now() - Number(period) * 86_400_000;
  const records = (profile.personalReviews ?? []).filter((record) => record.at >= cutoff);
  const variants = [
    { id: "bullet" as const, label: "Пуля", icon: "●", rating: accountProfile?.bullet_rating ?? null },
    { id: "rapid" as const, label: "Рапид", icon: "◷", rating: accountProfile?.rapid_rating ?? null },
    { id: "blitz" as const, label: "Блиц", icon: "⚡", rating: accountProfile?.blitz_rating ?? null },
  ];
  const brilliant = records.reduce((sum, record) => sum + (record.counts.brilliant ?? 0), 0);
  const brilliantByPhase = {
    opening: records.reduce((sum, record) => sum + (record.phaseBrilliant?.opening ?? 0), 0),
    middlegame: records.reduce((sum, record) => sum + (record.phaseBrilliant?.middlegame ?? 0), 0),
    endgame: records.reduce((sum, record) => sum + (record.phaseBrilliant?.endgame ?? 0), 0),
  };
  const qualityKeys = [
    ["best", "Лучшие"],
    ["brilliant", "Блестящие"],
    ["great", "Сильные"],
    ["good", "Хорошие"],
    ["inaccuracy", "Неточности"],
    ["miss", "Упущенные возможности"],
    ["mistake", "Ошибки"],
    ["blunder", "Зевки"],
  ] as const;
  const showAccuracy = filter === "all" || filter === "accuracy";
  const showQuality = filter === "all" || filter === "quality";

  return (
    <section className="cm-profile-stats-tab">
      <div className="cm-profile-stats-filters">
        <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Вид статистики">
          <option value="all">Полная статистика</option>
          <option value="accuracy">Точность</option>
          <option value="quality">Качество ходов</option>
        </select>
        <div className="cm-profile-period">
          <button type="button" className={period === "90" ? "active" : ""} onClick={() => setPeriod("90")}>90 дней</button>
          <button type="button" className={period === "30" ? "active" : ""} onClick={() => setPeriod("30")}>30 дней</button>
          <button type="button" className={period === "all" ? "active" : ""} onClick={() => setPeriod("all")}>Всё время</button>
        </div>
      </div>

      {showAccuracy && (
        <div className="cm-profile-stats-table-wrap">
          <table className="cm-profile-stats-table">
            <thead><tr>
              <th>Вариант</th><th>Рейтинг</th><th>Дебют</th><th>Миттельшпиль / Комбинации</th><th>Стратегия</th><th>Эндшпиль</th>
            </tr></thead>
            <tbody>
              {variants.map((variant) => (
                <tr key={variant.id}>
                  <th><span className={"cm-variant-icon cm-variant-" + variant.id}>{variant.icon}</span>{variant.label}</th>
                  <td>{variant.rating ?? "—"}</td>
                  <td><AccuracyValue value={averagePhaseAccuracy(records, "opening", variant.id)} /></td>
                  <td><AccuracyValue value={averagePhaseAccuracy(records, "middlegame", variant.id)} /></td>
                  <td><AccuracyValue value={averageOverallAccuracy(records, variant.id)} /></td>
                  <td><AccuracyValue value={averagePhaseAccuracy(records, "endgame", variant.id)} /></td>
                </tr>
              ))}
              <tr className="cm-brilliant-stat-row">
                <th><span className="cm-variant-icon cm-variant-brilliant">✦</span>Блестящие ходы</th>
                <td>{brilliant}</td>
                <td>{brilliantByPhase.opening || "—"}</td>
                <td>{brilliantByPhase.middlegame || "—"}</td>
                <td>—</td>
                <td>{brilliantByPhase.endgame || "—"}</td>
              </tr>
            </tbody>
          </table>
          {!records.length && <p className="cm-profile-stats-note">После разбора сетевых партий здесь появится реальная точность по дебюту, миттельшпилю и эндшпилю. Рейтинги отображаются отдельно от статистики точности.</p>}
        </div>
      )}

      {showQuality && (
        <section className="cm-profile-quality-breakdown">
          <h2>Качество ходов</h2>
          <div className="cm-profile-quality-grid">
            {qualityKeys.map(([key, label]) => (
              <div key={key}><span>{label}</span><strong>{records.reduce((sum, record) => sum + (record.counts[key] ?? 0), 0)}</strong></div>
            ))}
          </div>
        </section>
      )}

      <button type="button" className="cm-profile-show-more" onClick={() => setExpanded((value) => !value)}>
        {expanded ? "Скрыть дополнительную статистику" : "Показать больше статистики"}
      </button>
      {expanded && (
        <div className="cm-profile-stats-extra">
          <div><span>Разобрано сетевых партий</span><strong>{records.length}</strong></div>
          <div><span>Ходов проанализировано</span><strong>{records.reduce((sum, record) => sum + record.moves, 0)}</strong></div>
          <div><span>Средняя точность</span><strong>{records.length
            ? (records.reduce((sum, record) => sum + record.accuracy * record.moves, 0) / Math.max(1, records.reduce((sum, record) => sum + record.moves, 0))).toFixed(1) + "%"
            : "—"}</strong></div>
          <div><span>Всего блестящих ходов</span><strong>{brilliant}</strong></div>
        </div>
      )}
    </section>
  );
}

/** Account profile, archive and statistics laid out in the requested classic chess profile structure. */
export function ProfileHubScreen({ profile, accountProfile, onNavigate, initialTab = "overview" }: {
  profile: PlayerProfile;
  accountProfile: AccountProfile | null;
  onNavigate: Navigate;
  initialTab?: ProfileTab;
}) {
  const [activeTab, setActiveTab] = useState<ProfileTab>(initialTab);
  const [friendSearch, setFriendSearch] = useState("");
  const [onlineGames, setOnlineGames] = useState<OnlineArchiveGame[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const username = accountProfile?.username ?? profile.name;
  const preferences = loadGameplayPreferences();
  const themeColors: Record<string, { light: string; dark: string }> = {
    classic: { light: "#EBECD0", dark: "#739552" },
    blue: { light: "#E8EDF5", dark: "#6B83A5" },
    walnut: { light: "#EAD7BA", dark: "#9A6748" },
    violet: { light: "#ECE4F4", dark: "#856A9B" },
  };
  const boardColors = themeColors[preferences.boardTheme] ?? themeColors.classic;
  const solvedPuzzles = (profile.puzzles ?? []).filter((puzzle) => !!puzzle.solvedAt).length;
  const qualityTotals = (profile.personalReviews ?? []).reduce((total, record) => {
    for (const key of Object.keys(total) as Array<keyof typeof total>) total[key] += record.counts[key] ?? 0;
    return total;
  }, { best: 0, brilliant: 0, great: 0, good: 0, excellent: 0, book: 0, forced: 0, inaccuracy: 0, miss: 0, mistake: 0, blunder: 0 });
  const localGames = [...(profile.history ?? [])].sort((a, b) => b.at - a.at);
  const archiveCount = localGames.length + onlineGames.length;

  useEffect(() => {
    if (!accountProfile?.user_id) {
      setOnlineGames([]);
      return;
    }
    const controller = new AbortController();
    const loadArchive = async () => {
      setArchiveLoading(true);
      try {
        const configuredUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
        const url = configuredUrl.replace(/\/$/, "");
        const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";
        if (!url || !key) return;
        const raw = localStorage.getItem("chessmart:account-session:v2");
        if (!raw) return;
        let saved = JSON.parse(raw) as { access_token: string; refresh_token: string; expires_at: number };
        if (!saved.access_token) return;
        if (saved.expires_at <= Date.now() + 60_000 && saved.refresh_token) {
          const refreshedResponse = await fetch(url + "/auth/v1/token?grant_type=refresh_token", {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: key },
            body: JSON.stringify({ refresh_token: saved.refresh_token }),
            signal: controller.signal,
          });
          const refreshed = await refreshedResponse.json();
          if (!refreshedResponse.ok || !refreshed.access_token) return;
          saved = { ...refreshed, expires_at: Date.now() + (refreshed.expires_in ?? 3600) * 1000 };
          localStorage.setItem("chessmart:account-session:v2", JSON.stringify(saved));
        }
        const response = await fetch(url + "/functions/v1/game-action", {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: key, Authorization: "Bearer " + saved.access_token },
          body: JSON.stringify({ action: "archive" }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Не удалось загрузить архив");
        const data = await response.json() as { games?: OnlineArchiveGame[] };
        if (!controller.signal.aborted) setOnlineGames(Array.isArray(data.games) ? data.games : []);
      } catch {
        // The profile remains usable when the optional online archive cannot be loaded.
      } finally {
        if (!controller.signal.aborted) setArchiveLoading(false);
      }
    };
    void loadArchive();
    return () => controller.abort();
  }, [accountProfile?.user_id]);

  const activityDays = new Set([
    ...localGames.map((game) => new Date(game.at).toDateString()),
    ...(profile.personalReviews ?? []).map((record) => new Date(record.at).toDateString()),
    ...(profile.puzzles ?? []).filter((puzzle) => puzzle.solvedAt).map((puzzle) => new Date(puzzle.solvedAt as number).toDateString()),
  ]);
  const today = new Date();
  const todayKey = today.toDateString();
  const cursor = new Date(today);
  if (!activityDays.has(todayKey)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (activityDays.has(cursor.toDateString()) && streak < 3650) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const onlineRows = onlineGames.map((game) => {
    const isWhite = game.white_id === accountProfile?.user_id;
    const opponent = isWhite ? (game.black_name ?? "Соперник") : game.white_name;
    const ownScore = game.result === "draw" ? "½" : (isWhite ? game.result === "white_win" : game.result === "black_win") ? "1" : "0";
    const opponentScore = game.result === "draw" ? "½" : ownScore === "1" ? "0" : "1";
    const report = (profile.personalReviews ?? []).find((record) =>
      record.opponent.toLowerCase() === opponent.toLowerCase()
      && record.ratingType === game.rating_type
      && Math.abs(record.at - new Date(game.created_at).getTime()) < 86_400_000
    );
    return {
      id: game.id,
      control: game.minutes + " мин" + (game.increment_seconds ? " +" + game.increment_seconds : ""),
      mode: game.rating_type === "bullet" ? "Пуля" : game.rating_type === "rapid" ? "Рапид" : "Блиц",
      whiteName: game.white_name,
      blackName: game.black_name ?? "Соперник",
      whiteRating: game.white_rating,
      blackRating: game.black_rating,
      whiteScore: isWhite ? ownScore : opponentScore,
      blackScore: isWhite ? opponentScore : ownScore,
      accuracy: report?.accuracy ?? null,
      moves: Array.isArray(game.moves) ? game.moves.length : 0,
      date: game.created_at,
      online: true,
      won: ownScore === "1",
    };
  });
  const localRows = localGames.map((game, index) => {
    const report = (profile.personalReviews ?? [])
      .filter((record) => Math.abs(record.at - game.at) < 86_400_000)
      .sort((a, b) => Math.abs(a.at - game.at) - Math.abs(b.at - game.at))[0];
    const opponent = report?.opponent ?? ("Stockfish · " + game.botElo);
    const ownWhite = report?.color !== "b";
    const ownScore = game.result === "draw" ? "½" : game.result === "win" ? "1" : "0";
    const opponentScore = game.result === "draw" ? "½" : ownScore === "1" ? "0" : "1";
    return {
      id: "local-" + game.at + "-" + index,
      control: "—",
      mode: "Боты",
      whiteName: ownWhite ? username : opponent,
      blackName: ownWhite ? opponent : username,
      whiteRating: ownWhite ? game.ratingAfter : game.botElo,
      blackRating: ownWhite ? game.botElo : game.ratingAfter,
      whiteScore: ownWhite ? ownScore : opponentScore,
      blackScore: ownWhite ? opponentScore : ownScore,
      accuracy: report?.accuracy ?? null,
      moves: report?.moves ?? 0,
      date: new Date(game.at).toISOString(),
      online: false,
      won: game.result === "win",
    };
  });
  const archiveRows = [...onlineRows, ...localRows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const awards = [
    { id: "first-game", icon: "♟", title: "Первая партия", detail: "Сыграй свою первую партию", value: profile.games + onlineGames.length, goal: 1 },
    { id: "ten-games", icon: "⚔", title: "Боец", detail: "Сыграй 10 партий", value: profile.games + onlineGames.length, goal: 10 },
    { id: "fifty-games", icon: "🏆", title: "Постоянство", detail: "Сыграй 50 партий", value: profile.games + onlineGames.length, goal: 50 },
    { id: "first-win", icon: "♛", title: "Первая победа", detail: "Одержи первую победу", value: profile.wins, goal: 1 },
    { id: "puzzles", icon: "◆", title: "Тактик", detail: "Реши 10 шахматных задач", value: solvedPuzzles, goal: 10 },
    { id: "brilliant", icon: "✦", title: "Блестящая идея", detail: "Найди блестящий ход в разборе", value: qualityTotals.brilliant, goal: 1 },
  ];
  const earnedAwards = awards.filter((award) => award.value >= award.goal).length;

  const renderArchiveRows = () => archiveRows.slice(0, 8).map((game) => (
    <tr key={game.id}>
      <td><div className="cm-archive-mode"><span className="cm-archive-mode-icon">{game.online ? "♟" : "♞"}</span><span><strong>{game.mode}</strong><small>{game.control}</small></span></div></td>
      <td><div className="cm-archive-players">
        <span><i className="cm-piece-mark white" />{game.whiteName}<small>{game.whiteRating ?? "—"}</small></span>
        <span><i className="cm-piece-mark black" />{game.blackName}<small>{game.blackRating ?? "—"}</small></span>
      </div></td>
      <td><div className="cm-archive-score">
        <span><i className={game.whiteScore === "1" ? "win" : game.whiteScore === "0" ? "loss" : "draw"} />{game.whiteScore}</span>
        <span><i className={game.blackScore === "1" ? "win" : game.blackScore === "0" ? "loss" : "draw"} />{game.blackScore}</span>
      </div></td>
      <td><div className="cm-archive-report"><span>{game.accuracy === null ? "—" : game.accuracy.toFixed(1) + "%"}</span><button type="button" onClick={() => onNavigate("profileDetails")}>Отчёт</button></div></td>
      <td>{game.moves || "—"}</td>
      <td>{formatProfileDate(game.date)}</td>
    </tr>
  ));

  return (
    <div className="cm-profile-page">
      <section className="cm-profile-header">
        <div className="cm-profile-avatar">
          {accountProfile?.avatar_url
            ? <img src={accountProfile.avatar_url} alt={"Аватар " + username} />
            : <span aria-hidden="true">♟</span>}
        </div>
        <div className="cm-profile-identity">
          <div className="cm-profile-name-row">
            <h1>{username}</h1><span className="cm-country-mark" title="Страна не указана">◎</span>
            <button type="button" className="cm-profile-emblem" onClick={() => onNavigate("settings")}>Добавить эмблему</button>
          </div>
          <button type="button" className="cm-profile-status" onClick={() => onNavigate("settings")}>Введите статус</button>
          <div className="cm-profile-meta">
            <span>Дата регистрации: {accountProfile?.created_at ? formatProfileDate(accountProfile.created_at) : "—"}</span>
            <span>0 друзей</span><span>Просмотры: —</span>
            <span className="cm-profile-online"><i />Сейчас онлайн</span>
          </div>
        </div>
        <button type="button" className="cm-replica-secondary-button cm-profile-edit" onClick={() => onNavigate("settings")}>Редактировать профиль</button>
      </section>

      <nav className="cm-profile-tabs" aria-label="Разделы профиля">
        {([
          ["overview", "Обзор"], ["games", "Партии"], ["stats", "Статистика"],
          ["friends", "Друзья"], ["awards", "Награды"], ["clubs", "Клубы"],
        ] as Array<[ProfileTab, string]>).map(([id, label]) => (
          <button key={id} type="button" className={activeTab === id ? "active" : ""} aria-current={activeTab === id ? "page" : undefined} onClick={() => setActiveTab(id)}>{label}</button>
        ))}
      </nav>

      {activeTab === "overview" && (
        <div className="cm-profile-overview">
          <main className="cm-profile-overview-main">
            <section className="cm-profile-ratings">
              {[
                { id: "bullet", label: "Пуля", icon: "●", value: accountProfile?.bullet_rating },
                { id: "rapid", label: "Рапид", icon: "◷", value: accountProfile?.rapid_rating },
                { id: "blitz", label: "Блиц", icon: "⚡", value: accountProfile?.blitz_rating },
              ].map((item) => (
                <article className="cm-profile-rating-card" key={item.id}>
                  <span className={"cm-profile-rating-icon " + item.id}>{item.icon}</span>
                  <div><small>{item.label}</small><strong>{item.value ?? "—"}</strong></div>
                  <span className="cm-profile-rating-delta">—</span>
                </article>
              ))}
            </section>

            <section className="cm-profile-panel cm-correspondence-panel">
              <div className="cm-profile-panel-title"><h2>Заочные партии (0)</h2></div>
              <div className="cm-correspondence-empty"><span>У тебя нет текущих заочных партий.</span><button type="button" onClick={() => onNavigate("online")}>Играть</button></div>
            </section>

            <section className="cm-profile-panel cm-profile-archive">
              <div className="cm-profile-panel-title"><h2>Архив партий ({archiveCount})</h2></div>
              <div className="cm-profile-archive-wrap">
                <table>
                  <thead><tr><th>Режим</th><th>Игроки</th><th>Результат</th><th>Точность / отчёт</th><th>Ходы</th><th>Дата</th></tr></thead>
                  <tbody>{renderArchiveRows()}</tbody>
                </table>
                {!archiveRows.length && <div className="cm-profile-archive-empty">{archiveLoading ? "Загружаем архив партий…" : "Здесь появятся сыгранные партии."}</div>}
              </div>
              <button type="button" className="cm-profile-more-link" onClick={() => setActiveTab("games")}>Подробнее &gt;</button>
            </section>
          </main>

          <aside className="cm-profile-overview-aside">
            <section className="cm-profile-panel cm-profile-streak">
              <div><span className="cm-profile-widget-icon">♨</span><h2>{streak}-дневная серия</h2></div>
              <p>Твоя активность в CHESSMART</p>
            </section>
            <section className="cm-profile-panel cm-profile-league">
              <div><span className="cm-profile-widget-icon">⬡</span><h2>Stone лига</h2></div>
              <p>Начни рейтинговые партии, чтобы подняться в лиге.</p>
            </section>
            <section className="cm-profile-panel cm-profile-theme">
              <h2>Твоя тема</h2>
              <div className="cm-profile-theme-board" aria-label="Предпросмотр темы доски">
                {[0, 1, 2, 3].map((square) => <span key={square} style={{ background: (Math.floor(square / 2) + square % 2) % 2 === 0 ? boardColors.light : boardColors.dark }} />)}
              </div>
              <small>Green · {preferences.boardTheme === "classic" ? "Классическая" : preferences.boardTheme}</small>
            </section>
            <section className="cm-profile-panel cm-profile-friends">
              <h2>Друзья</h2>
              <input value={friendSearch} onChange={(event) => setFriendSearch(event.target.value)} placeholder="Поиск друзей" aria-label="Поиск друзей" />
              <button type="button" onClick={() => setActiveTab("friends")}>Добавить в друзья</button>
            </section>
          </aside>
        </div>
      )}

      {activeTab === "games" && (
        <section className="cm-profile-panel cm-profile-games-tab">
          <div className="cm-profile-panel-title"><h2>Архив партий ({archiveCount})</h2><button type="button" className="cm-replica-secondary-button" onClick={() => onNavigate("online")}>Играть онлайн</button></div>
          <div className="cm-profile-archive-wrap">
            <table>
              <thead><tr><th>Режим</th><th>Игроки</th><th>Результат</th><th>Точность / отчёт</th><th>Ходы</th><th>Дата</th></tr></thead>
              <tbody>{archiveRows.map((game) => (
                <tr key={game.id}>
                  <td><div className="cm-archive-mode"><span className="cm-archive-mode-icon">{game.online ? "♟" : "♞"}</span><span><strong>{game.mode}</strong><small>{game.control}</small></span></div></td>
                  <td><div className="cm-archive-players"><span><i className="cm-piece-mark white" />{game.whiteName}<small>{game.whiteRating ?? "—"}</small></span><span><i className="cm-piece-mark black" />{game.blackName}<small>{game.blackRating ?? "—"}</small></span></div></td>
                  <td><div className="cm-archive-score"><span><i className={game.whiteScore === "1" ? "win" : game.whiteScore === "0" ? "loss" : "draw"} />{game.whiteScore}</span><span><i className={game.blackScore === "1" ? "win" : game.blackScore === "0" ? "loss" : "draw"} />{game.blackScore}</span></div></td>
                  <td><div className="cm-archive-report"><span>{game.accuracy === null ? "—" : game.accuracy.toFixed(1) + "%"}</span><button type="button" onClick={() => onNavigate("profileDetails")}>Отчёт</button></div></td>
                  <td>{game.moves || "—"}</td><td>{formatProfileDate(game.date, true)}</td>
                </tr>
              ))}</tbody>
            </table>
            {!archiveRows.length && <div className="cm-profile-archive-empty">{archiveLoading ? "Загружаем архив партий…" : "Пока нет сохранённых партий."}</div>}
          </div>
        </section>
      )}

      {activeTab === "stats" && <ProfileStatsTab profile={profile} accountProfile={accountProfile} />}

      {activeTab === "friends" && (
        <section className="cm-profile-panel cm-profile-empty-section">
          <h2>Друзья</h2>
          <p>У тебя пока нет друзей в CHESSMART.</p>
          <div className="cm-profile-friend-search"><input value={friendSearch} onChange={(event) => setFriendSearch(event.target.value)} placeholder="Поиск игроков по нику" /><button type="button" onClick={() => onNavigate("online")}>Добавить в друзья</button></div>
          <small>Поиск игроков и приглашения доступны в разделе «Играть по сети».</small>
        </section>
      )}

      {activeTab === "awards" && (
        <section className="cm-profile-panel cm-profile-awards-tab">
          <div className="cm-profile-panel-title"><h2>Награды</h2><strong>{earnedAwards} / {awards.length}</strong></div>
          <div className="cm-achievement-grid">
            {awards.map((award) => {
              const earned = award.value >= award.goal;
              const progress = Math.min(award.value, award.goal);
              return <article className={earned ? "cm-achievement-card earned" : "cm-achievement-card"} key={award.id}>
                <span className="cm-achievement-icon" aria-hidden="true">{award.icon}</span>
                <div className="cm-achievement-copy"><strong>{award.title}</strong><small>{award.detail}</small></div>
                <b className="cm-achievement-progress">{earned ? "Получено" : progress + " / " + award.goal}</b>
                <span className="cm-achievement-track"><i style={{ width: Math.round(progress / award.goal * 100) + "%" }} /></span>
              </article>;
            })}
          </div>
        </section>
      )}

      {activeTab === "clubs" && (
        <section className="cm-profile-panel cm-profile-empty-section">
          <h2>Клубы</h2><p>Ты пока не состоишь в клубах.</p>
          <button type="button" className="cm-replica-secondary-button" onClick={() => onNavigate("battle")}>Посмотреть соревнования</button>
        </section>
      )}
    </div>
  );
}
