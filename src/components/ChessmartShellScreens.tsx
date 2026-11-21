import { useEffect, useMemo, useState } from "react";
import type { PlayerProfile } from "../lib/playerProfile";
import { updatePlayerName } from "../lib/playerProfile";
import type { AccountProfile } from "../lib/accountProfile";
import { loadGameplayPreferences, updateGameplayPreferences, type GameplayPreferences, type GameBoardTheme } from "../lib/gameplayPreferences";

export type ShellRoute = "home" | "playHub" | "review" | "online" | "play" | "coach" | "puzzles" | "battle" | "openings" | "lessons" | "academy" | "profile" | "profileDetails" | "stats" | "settings" | "news" | "daily" | "mistakes" | "endgame" | "lab" | "diagnostics" | "systems";
type Navigate = (route: ShellRoute) => void;
const HOME_BOARD_POSITION = [
  "♜♞♝♛♚♝♞♜",
  "♟♟♟♟♟♟♟♟",
  "........", "........", "........", "........",
  "♙♙♙♙♙♙♙♙",
  "♖♘♗♕♔♗♘♖",
];
const BOARD_COLORS: Record<GameBoardTheme, { light: string; dark: string }> = {
  classic: { light: "#EEEED2", dark: "#769656" }, blue: { light: "#e8edf5", dark: "#6b83a5" },
  walnut: { light: "#ead7ba", dark: "#9a6748" }, violet: { light: "#ece4f4", dark: "#856a9b" },
};
function Avatar({ profile, localName, size = "large" }: { profile: AccountProfile | null; localName: string; size?: "small" | "large" }) {
  const className = size === "large" ? "cm-avatar cm-avatar-large" : "cm-avatar cm-avatar-small";
  if (profile?.avatar_url) return <img className={className} src={profile.avatar_url} alt={profile.username} />;
  return <div className={className}>{(profile?.username ?? localName ?? "И").trim().slice(0, 1).toUpperCase() || "И"}</div>;
}
function RatingBadge({ label, value, games }: { label: string; value: number; games: number }) {
  return <div className="cm-rating-badge"><span className="cm-rating-label">{label}</span><strong>{value || 1200}</strong><small>{games} партий</small></div>;
}
function PlayAction({ icon, title, subtitle, onClick, accent = false }: { icon: string; title: string; subtitle: string; onClick: () => void; accent?: boolean }) {
  return <button type="button" className={accent ? "cm-play-action cm-play-action-accent" : "cm-play-action"} onClick={onClick}><span className="cm-play-action-icon" aria-hidden="true">{icon}</span><span className="cm-play-action-copy"><strong>{title}</strong><small>{subtitle}</small></span><span className="cm-play-action-arrow" aria-hidden="true">›</span></button>;
}

export function HomeScreen({ profile, accountProfile, onNavigate }: { profile: PlayerProfile; accountProfile: AccountProfile | null; onNavigate: Navigate }) {
  const colors = BOARD_COLORS[loadGameplayPreferences().boardTheme];
  const username = accountProfile?.username ?? profile.name;
  return <div className="cm-home-screen">
    <div className="cm-home-board-column">
      <div className="cm-opponent-bar"><div className="cm-opponent-avatar">♟</div><div><strong>Соперник</strong><small>Готов к партии</small></div><span className="cm-online-dot" /></div>
      <div className="cm-home-board" role="img" aria-label="Шахматная доска в начальной позиции">
        <div className="cm-preview-board">
          {HOME_BOARD_POSITION.map((row, rowIndex) => row.split("").map((piece, columnIndex) => {
            const lightSquare = (rowIndex + columnIndex) % 2 === 0;
            const isBlackPiece = rowIndex < 2;
            return <div key={`${rowIndex}-${columnIndex}`} className="cm-preview-square" style={{ backgroundColor: lightSquare ? colors.light : colors.dark }}>
              {piece !== "." && <span className={isBlackPiece ? "cm-preview-piece cm-preview-piece-black" : "cm-preview-piece cm-preview-piece-white"}>{piece}</span>}
            </div>;
          }))}
        </div>
      </div>
      <div className="cm-player-bar"><Avatar profile={accountProfile} localName={profile.name} size="small" /><div className="cm-player-name"><strong>{username}</strong><small>{accountProfile ? "Аккаунт CHESSMART" : "Локальный профиль"}</small></div><div className="cm-player-rating"><span>Рейтинг</span><b>{accountProfile?.rapid_rating ?? profile.rating}</b></div></div>
      <div className="cm-board-caption">Доска-превью · выбери режим справа, чтобы начать игру</div>
    </div>
    <aside className="cm-play-panel">
      <header><span aria-hidden="true">♞</span><h1>Играть в шахматы</h1></header>
      <div className="cm-play-actions">
        <PlayAction icon="⚡" title="Играть по сети" subtitle="Найти соперника своего уровня" accent onClick={() => onNavigate("online")} />
        <PlayAction icon="🤖" title="Боты" subtitle="Играть против Stockfish — от новичка до мастера" onClick={() => onNavigate("play")} />
        <PlayAction icon="🎓" title="Играть с тренером" subtitle="Тренировка с подсказками и разбором" onClick={() => onNavigate("coach")} />
        <PlayAction icon="🤝" title="Играть с другом" subtitle="Создать приглашение и поделиться кодом" onClick={() => onNavigate("online")} />
        <PlayAction icon="🏅" title="Puzzle Battle" subtitle="Соревнование на скорость и точность" onClick={() => onNavigate("battle")} />
        <PlayAction icon="📚" title="Дебюты и позиции" subtitle="Исследовать дебюты и планы" onClick={() => onNavigate("openings")} />
      </div>
      <div className="cm-play-panel-footer"><button type="button" onClick={() => onNavigate("profileDetails")}>▣ Архив и импорт партий</button><button type="button" onClick={() => onNavigate("stats")}>▥ Статистика игрока</button></div>
      <div className="cm-play-panel-hint"><span>♟</span><div><strong>Твой шахматный центр</strong><small>Игры, обучение и анализ — в одном месте.</small></div></div>
    </aside>
  </div>;
}

export function ProfileHubScreen({ profile, accountProfile, onNavigate }: { profile: PlayerProfile; accountProfile: AccountProfile | null; onNavigate: Navigate }) {
  const username = accountProfile?.username ?? profile.name;
  const totalReviews = profile.reviews?.length ?? 0;
  const totalBrilliant = (profile.reviews ?? []).reduce((sum, review) => sum + review.brilliantMoves.length, 0);
  const solvedPuzzles = (profile.puzzles ?? []).filter((puzzle) => !!puzzle.solvedAt).length;
  const totalOnlineGames = (accountProfile?.bullet_games ?? 0) + (accountProfile?.blitz_games ?? 0) + (accountProfile?.rapid_games ?? 0);
  const winRate = profile.games > 0 ? Math.round((profile.wins / profile.games) * 100) : 0;
  return <div className="cm-content-page">
    <div className="cm-page-heading"><div><span className="cm-eyebrow">Профиль игрока</span><h1>{username}</h1><p>Личная карточка, шахматные рейтинги и твой прогресс в CHESSMART</p></div><button className="cm-secondary-button" onClick={() => onNavigate("settings")}>⚙ Настройки</button></div>
    <section className="cm-profile-hero"><div className="cm-profile-identity"><Avatar profile={accountProfile} localName={profile.name} /><div><div className="cm-profile-title">{username}</div><div className="cm-profile-subtitle">{accountProfile ? "Онлайн-аккаунт CHESSMART" : "Локальный профиль · аккаунт не подключён"}</div><div className="cm-profile-status"><span className="cm-online-dot" /> {accountProfile ? "Профиль подключён" : "Данные хранятся на этом устройстве"}</div></div></div><div className="cm-profile-quick-stats"><div><strong>{profile.games}</strong><span>Партий против бота</span></div><div><strong>{totalReviews}</strong><span>Разобрано партий</span></div><div><strong>{solvedPuzzles}</strong><span>Решено задач</span></div></div></section>
    <div className="cm-section-title-row"><div><h2>Рейтинги</h2><p>Онлайн-рейтинги и локальный рейтинг против Stockfish учитываются отдельно</p></div><button className="cm-text-button" onClick={() => onNavigate("stats")}>Подробная статистика →</button></div>
    {accountProfile ? <div className="cm-rating-grid"><RatingBadge label="Bullet" value={accountProfile.bullet_rating} games={accountProfile.bullet_games} /><RatingBadge label="Blitz" value={accountProfile.blitz_rating} games={accountProfile.blitz_games} /><RatingBadge label="Rapid" value={accountProfile.rapid_rating} games={accountProfile.rapid_games} /><RatingBadge label="Всего онлайн" value={totalOnlineGames} games={totalOnlineGames} /></div> : <div className="cm-empty-account"><div className="cm-empty-account-icon">♙</div><div><strong>Подключи онлайн-аккаунт</strong><p>После входа появятся рейтинги Bullet, Blitz и Rapid, онлайн-партии и профиль соперников.</p></div><button className="cm-primary-button" onClick={() => onNavigate("online")}>Войти / регистрация</button></div>}
    <div className="cm-profile-stats-grid">
      <div className="cm-profile-stat-card"><span>Локальный Elo</span><strong>{profile.rating}</strong><small>Против Stockfish</small></div>
      <div className="cm-profile-stat-card"><span>Puzzle Rating</span><strong>{profile.puzzleRating}</strong><small>Решение задач</small></div>
      <div className="cm-profile-stat-card"><span>Процент побед</span><strong>{winRate}%</strong><small>{profile.wins} побед · {profile.losses} поражений · {profile.draws} ничьих</small></div>
      <div className="cm-profile-stat-card"><span>Блестящие ходы</span><strong>{totalBrilliant}</strong><small>По разобранным партиям</small></div>
    </div>
    <div className="cm-profile-actions"><button onClick={() => onNavigate("stats")}>▥ Открыть статистику</button><button onClick={() => onNavigate("profileDetails")}>▤ История и резервная копия</button><button onClick={() => onNavigate("online")}>♟ Управление онлайн-аккаунтом</button></div>
  </div>;
}

type StatsPeriod = "7" | "30" | "90" | "all";
export function StatsScreen({ profile, accountProfile, onNavigate }: { profile: PlayerProfile; accountProfile: AccountProfile | null; onNavigate: Navigate }) {
  const [period, setPeriod] = useState<StatsPeriod>("90");
  const cutoff = period === "all" ? 0 : Date.now() - Number(period) * 86400000;
  const history = useMemo(() => profile.history.filter((entry) => entry.at >= cutoff), [profile.history, cutoff]);
  const wins = history.filter((entry) => entry.result === "win").length;
  const losses = history.filter((entry) => entry.result === "loss").length;
  const draws = history.filter((entry) => entry.result === "draw").length;
  const games = wins + losses + draws;
  const winRate = games ? Math.round(wins / games * 100) : 0;
  const accuracyRecords = (profile.reviews ?? []).filter((entry) => entry.at >= cutoff);
  const averageAccuracy = accuracyRecords.length ? accuracyRecords.reduce((sum, entry) => sum + entry.accuracy.average, 0) / accuracyRecords.length : 0;
  const averageOpponent = history.length ? Math.round(history.reduce((sum, entry) => sum + entry.botElo, 0) / history.length) : 0;
  const bestWin = history.filter((entry) => entry.result === "win").sort((a, b) => b.botElo - a.botElo)[0];
  const ratings = [1000, ...history.map((entry) => entry.ratingAfter)];
  const minRating = Math.min(...ratings);
  const maxRating = Math.max(...ratings);
  const spread = Math.max(40, maxRating - minRating);
  const points = ratings.map((value, index) => {
    const x = ratings.length < 2 ? 300 : index / (ratings.length - 1) * 600;
    const y = 118 - ((value - (minRating - spread * .12)) / (spread * 1.24)) * 100;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return <div className="cm-content-page">
    <div className="cm-page-heading"><div><span className="cm-eyebrow">Игровая аналитика</span><h1>Статистика</h1><p>Результаты партий, динамика рейтинга и точность анализа</p></div><button className="cm-secondary-button" onClick={() => onNavigate("profile")}>← Профиль</button></div>
    <div className="cm-stats-toolbar"><div><strong>Игры против ботов</strong><small>История локальных партий, сохранённая в этом браузере</small></div><div className="cm-period-switch">{(["7", "30", "90", "all"] as StatsPeriod[]).map((value) => <button key={value} onClick={() => setPeriod(value)} className={period === value ? "active" : ""}>{value === "all" ? "Всё время" : `${value} дн.`}</button>)}</div></div>
    <div className="cm-stats-kpis"><div><span>Сыграно</span><strong>{games}</strong><small>по записанной истории</small></div><div><span>Процент побед</span><strong>{winRate}%</strong><small>{wins} побед</small></div><div><span>Средний соперник</span><strong>{averageOpponent || "—"}</strong><small>Bot Elo</small></div><div><span>Средняя точность</span><strong>{accuracyRecords.length ? `${averageAccuracy.toFixed(1)}%` : "—"}</strong><small>{accuracyRecords.length} разборов</small></div></div>
    <div className="cm-stats-main-grid">
      <section className="cm-data-card cm-rating-chart-card"><div className="cm-card-heading"><div><h2>Динамика рейтинга</h2><p>История рейтинга против Stockfish</p></div><strong>{profile.rating} Elo</strong></div>
        {history.length ? <svg viewBox="0 0 600 140" className="cm-rating-chart" role="img" aria-label="График локального рейтинга"><line x1="0" y1="70" x2="600" y2="70" stroke="rgba(255,255,255,.12)" strokeDasharray="5 6" /><polyline points={points} fill="none" stroke="#a6ce78" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />{ratings.map((rating, index) => <circle key={index} cx={ratings.length < 2 ? 300 : index / (ratings.length - 1) * 600} cy={118 - ((rating - (minRating - spread * .12)) / (spread * 1.24)) * 100} r="3" fill="#d7edbd" />)}</svg> : <div className="cm-chart-empty">График заполнится после партий против ботов.</div>}
        <div className="cm-chart-range"><span>{history.length} записей в выбранном периоде</span><span>{minRating}–{maxRating} Elo</span></div>
      </section>
      <section className="cm-data-card cm-results-card"><div className="cm-card-heading"><div><h2>Результаты</h2><p>Распределение партий</p></div></div><div className="cm-result-counts"><div><b className="win">{wins}</b><span>Победы</span></div><div><b className="draw">{draws}</b><span>Ничьи</span></div><div><b className="loss">{losses}</b><span>Поражения</span></div></div><div className="cm-result-bar"><i style={{ width: games ? `${wins / games * 100}%` : "0%" }} /><i style={{ width: games ? `${draws / games * 100}%` : "0%" }} /><i style={{ width: games ? `${losses / games * 100}%` : "0%" }} /></div><div className="cm-highlight-line"><span>Лучшая победа</span><strong>{bestWin ? `против ${bestWin.botElo} Elo` : "Пока нет"}</strong></div><div className="cm-highlight-line"><span>Текущий рейтинг</span><strong>{profile.rating} Elo</strong></div></section>
    </div>
    <section className="cm-data-card"><div className="cm-card-heading"><div><h2>Онлайн-рейтинги</h2><p>Отдельные рейтинги сетевых режимов CHESSMART</p></div><button className="cm-text-button" onClick={() => onNavigate("online")}>{accountProfile ? "Открыть онлайн-игру →" : "Подключить аккаунт →"}</button></div>
      {accountProfile ? <div className="cm-rating-grid cm-rating-grid-stats"><RatingBadge label="Bullet" value={accountProfile.bullet_rating} games={accountProfile.bullet_games} /><RatingBadge label="Blitz" value={accountProfile.blitz_rating} games={accountProfile.blitz_games} /><RatingBadge label="Rapid" value={accountProfile.rapid_rating} games={accountProfile.rapid_games} /></div> : <div className="cm-chart-empty">Войди в онлайн-аккаунт, чтобы видеть сетевые рейтинги и число партий.</div>}
    </section>
    <section className="cm-data-card"><div className="cm-card-heading"><div><h2>Последние партии против бота</h2><p>Последние записи в локальной истории</p></div></div>
      {history.length ? <div className="cm-history-list">{history.slice().reverse().slice(0, 15).map((entry, index) => <div className="cm-history-row" key={`${entry.at}-${index}`}><span className={`cm-result-pill ${entry.result}`}>{entry.result === "win" ? "Победа" : entry.result === "loss" ? "Поражение" : "Ничья"}</span><span>Stockfish · {entry.botElo} Elo</span><time>{new Date(entry.at).toLocaleDateString("ru-RU")}</time><b>{entry.ratingAfter} Elo</b></div>)}</div> : <div className="cm-chart-empty">Пока нет записанных партий за выбранный период.</div>}
    </section>
  </div>;
}

interface CommitRecord { sha: string; html_url: string; commit: { message: string; author?: { name?: string; date?: string } }; author?: { login?: string; avatar_url?: string }; }
export function NewsScreen() {
  const [commits, setCommits] = useState<CommitRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch("https://api.github.com/repos/himanahiman3-dev/CHESSMART/commits?per_page=20", { signal: controller.signal, headers: { Accept: "application/vnd.github+json" } })
      .then(async (response) => { if (!response.ok) throw new Error(response.status === 403 ? "GitHub временно ограничил запросы. Попробуй обновить ленту чуть позже." : `GitHub вернул ошибку ${response.status}.`); return await response.json() as CommitRecord[]; })
      .then((items) => { if (!controller.signal.aborted) { setCommits(items); setUpdatedAt(Date.now()); } })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось загрузить историю GitHub."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  return <div className="cm-content-page">
    <div className="cm-page-heading"><div><span className="cm-eyebrow">История проекта</span><h1>Новости CHESSMART</h1><p>Последние изменения прямо из GitHub — каждый коммит, который попал в репозиторий</p></div><button className="cm-secondary-button" onClick={() => setReload((value) => value + 1)} disabled={loading}>↻ Обновить</button></div>
    <div className="cm-news-summary"><span className="cm-github-mark">⌘</span><div><strong>himanahiman3-dev / CHESSMART</strong><small>{updatedAt ? `Обновлено ${new Date(updatedAt).toLocaleTimeString("ru-RU")}` : "Живая история репозитория"}</small></div><a href="https://github.com/himanahiman3-dev/CHESSMART/commits/main" target="_blank" rel="noreferrer">Открыть GitHub ↗</a></div>
    {loading && <div className="cm-chart-empty">Загружаем последние коммиты…</div>}
    {error && <div className="cm-inline-error" role="alert">{error}<button onClick={() => setReload((value) => value + 1)}>Повторить</button></div>}
    {!loading && !error && <div className="cm-news-feed">{commits.map((item) => { const message = item.commit.message.split("\n")[0]; const date = item.commit.author?.date ? new Date(item.commit.author.date) : null; return <article className="cm-news-item" key={item.sha}><div className="cm-news-timeline"><span /></div><div className="cm-news-content"><div className="cm-news-meta"><span>{date ? date.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" }) : "Дата не указана"}</span><code>{item.sha.slice(0, 7)}</code></div><h2>{message}</h2><p>{item.commit.author?.name ?? item.author?.login ?? "Разработчик"} · изменение в CHESSMART</p><a href={item.html_url} target="_blank" rel="noreferrer">Посмотреть коммит ↗</a></div></article>; })}{commits.length === 0 && <div className="cm-chart-empty">В репозитории пока нет коммитов.</div>}</div>}
  </div>;
}

interface UiPreferences { compact: boolean; largeText: boolean; reduceMotion: boolean; }
const UI_PREFERENCES_KEY = "chessmart:interface-preferences:v1";
const DEFAULT_UI_PREFERENCES: UiPreferences = { compact: false, largeText: false, reduceMotion: false };
function loadUiPreferences(): UiPreferences {
  try { const raw = localStorage.getItem(UI_PREFERENCES_KEY); return raw ? { ...DEFAULT_UI_PREFERENCES, ...JSON.parse(raw) } : { ...DEFAULT_UI_PREFERENCES }; }
  catch { return { ...DEFAULT_UI_PREFERENCES }; }
}
function ToggleRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="cm-setting-toggle"><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}

export function SettingsScreen({ profile, accountProfile, onChangeProfile, onNavigate }: { profile: PlayerProfile; accountProfile: AccountProfile | null; onChangeProfile: (profile: PlayerProfile) => void; onNavigate: Navigate }) {
  const [section, setSection] = useState("board");
  const [gameplay, setGameplay] = useState<GameplayPreferences>(() => loadGameplayPreferences());
  const [ui, setUi] = useState<UiPreferences>(() => loadUiPreferences());
  const [playerName, setPlayerName] = useState(profile.name);
  const [saved, setSaved] = useState("");
  const patchGameplay = (patch: Partial<GameplayPreferences>) => { setGameplay(updateGameplayPreferences(gameplay, patch)); setSaved("Настройки сохранены"); };
  const sections = [{ id: "board", label: "Доска и фигуры", icon: "♟" }, { id: "gameplay", label: "Игровой процесс", icon: "⚙" }, { id: "interface", label: "Интерфейс", icon: "▦" }, { id: "profile", label: "Профиль", icon: "♙" }, { id: "account", label: "Учётная запись", icon: "🔒" }];
  useEffect(() => {
    try { localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(ui)); } catch { /* storage may be unavailable */ }
    document.body.classList.toggle("chessmart-compact", ui.compact);
    document.body.classList.toggle("chessmart-large-text", ui.largeText);
    document.body.classList.toggle("chessmart-reduce-motion", ui.reduceMotion);
  }, [ui]);
  return <div className="cm-content-page">
    <div className="cm-page-heading"><div><span className="cm-eyebrow">Персонализация</span><h1>Настройки</h1><p>Настрой доску, игровой процесс и внешний вид CHESSMART</p></div><button className="cm-secondary-button" onClick={() => onNavigate("profile")}>← Профиль</button></div>
    <div className="cm-settings-layout">
      <nav className="cm-settings-nav" aria-label="Разделы настроек">{sections.map((item) => <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => { setSection(item.id); setSaved(""); }}><span>{item.icon}</span>{item.label}</button>)}</nav>
      <section className="cm-settings-panel">
        {section === "board" && <><div className="cm-settings-heading"><h2>Доска и фигуры</h2><p>Цвета доски, звук и поведение фигур во время партии</p></div>
          <label className="cm-setting-select"><span><strong>Тема доски</strong><small>Меняет цвета доски в игре и на главной</small></span><select value={gameplay.boardTheme} onChange={(event) => patchGameplay({ boardTheme: event.target.value as GameBoardTheme })}><option value="classic">Классическая · зелёная</option><option value="blue">Синяя</option><option value="walnut">Ореховая</option><option value="violet">Фиолетовая</option></select></label>
          <ToggleRow title="Звуки ходов" description="Ходы, взятия, уведомления и завершение партии" checked={gameplay.soundEnabled} onChange={(value) => patchGameplay({ soundEnabled: value })} />
          <ToggleRow title="Подсветка легальных ходов" description="Показывать доступные клетки при выборе фигуры" checked={gameplay.showLegalMoves} onChange={(value) => patchGameplay({ showLegalMoves: value })} />
          <ToggleRow title="Подсветка последнего хода" description="Показывать клетки, откуда и куда походила фигура" checked={gameplay.highlightLastMove} onChange={(value) => patchGameplay({ highlightLastMove: value })} />
          <ToggleRow title="Анимация фигур" description="Плавное перемещение фигур между клетками" checked={gameplay.boardAnimations} onChange={(value) => patchGameplay({ boardAnimations: value })} />
        </>}
        {section === "gameplay" && <><div className="cm-settings-heading"><h2>Игровой процесс</h2><p>Поведение во время онлайн- и бот-партий</p></div>
          <ToggleRow title="Автоматическое превращение в ферзя" description="Пешка автоматически превращается в ферзя, если не выбран другой вариант" checked={gameplay.autoQueen} onChange={(value) => patchGameplay({ autoQueen: value })} />
          <ToggleRow title="Premove" description="Разрешить заранее поставить ход, пока соперник думает" checked={gameplay.premovesEnabled} onChange={(value) => patchGameplay({ premovesEnabled: value })} />
          <ToggleRow title="Подтверждать сдачу" description="Показывать подтверждение перед завершением партии" checked={gameplay.confirmResign} onChange={(value) => patchGameplay({ confirmResign: value })} />
        </>}
        {section === "interface" && <><div className="cm-settings-heading"><h2>Интерфейс</h2><p>Плотность, читаемость и анимации интерфейса</p></div>
          <ToggleRow title="Компактный интерфейс" description="Уменьшить интервалы и высоту карточек" checked={ui.compact} onChange={(value) => setUi((current) => ({ ...current, compact: value }))} />
          <ToggleRow title="Крупный текст" description="Увеличить текст в интерфейсе" checked={ui.largeText} onChange={(value) => setUi((current) => ({ ...current, largeText: value }))} />
          <ToggleRow title="Уменьшить анимации" description="Отключить декоративные переходы интерфейса" checked={ui.reduceMotion} onChange={(value) => setUi((current) => ({ ...current, reduceMotion: value }))} />
        </>}
        {section === "profile" && <><div className="cm-settings-heading"><h2>Профиль</h2><p>Имя локального профиля и отображение игрока</p></div>
          <label className="cm-setting-input"><span><strong>Имя игрока</strong><small>Используется в локальной статистике и на главной</small></span><input value={playerName} maxLength={24} onChange={(event) => setPlayerName(event.target.value)} /></label>
          <button className="cm-primary-button cm-settings-save" onClick={() => { onChangeProfile(updatePlayerName(profile, playerName)); setSaved("Имя профиля сохранено"); }}>Сохранить профиль</button>
          <div className="cm-settings-note">Аватар и имя онлайн-аккаунта управляются отдельно в разделе «Играть по сети».</div>
        </>}
        {section === "account" && <><div className="cm-settings-heading"><h2>Учётная запись</h2><p>Состояние сетевого профиля и безопасность</p></div>
          <div className="cm-account-state"><span className={accountProfile ? "cm-account-state-dot online" : "cm-account-state-dot"} /><div><strong>{accountProfile ? `Вошёл как ${accountProfile.username}` : "Онлайн-аккаунт не подключён"}</strong><small>{accountProfile ? "Рейтинги и онлайн-партии синхронизируются через Supabase" : "Подключи аккаунт, чтобы играть с другими людьми и сохранять рейтинги"}</small></div></div>
          <button className="cm-primary-button cm-settings-save" onClick={() => onNavigate("online")}>{accountProfile ? "Открыть аккаунт" : "Войти или создать аккаунт"}</button>
          <div className="cm-settings-note">Секретные серверные ключи не хранятся в браузере. Для входа используется публичный ключ Supabase и персональная сессия.</div>
        </>}
        {saved && <div className="cm-settings-saved" role="status">✓ {saved}</div>}
      </section>
    </div>
  </div>;
}
