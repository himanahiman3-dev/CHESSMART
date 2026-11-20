import type { PlayerProfile } from "../lib/playerProfile";
import type { AccountProfile } from "../lib/accountProfile";
import type { ShellRoute } from "./ChessmartShellScreens";
import { GameBoard } from "./GameBoard";
import { loadGameplayPreferences } from "../lib/gameplayPreferences";

type Navigate = (route: ShellRoute) => void;

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function Avatar({ accountProfile, name, size = "medium" }: {
  accountProfile: AccountProfile | null;
  name: string;
  size?: "small" | "medium" | "large";
}) {
  const className = `cm-replica-avatar cm-replica-avatar-${size}`;
  if (accountProfile?.avatar_url) {
    return <img className={className} src={accountProfile.avatar_url} alt={accountProfile.username} />;
  }
  return <span className={className}>{(accountProfile?.username ?? name ?? "И").trim().slice(0, 1).toUpperCase() || "И"}</span>;
}

function PlayAction({ icon, title, subtitle, onClick, featured = false }: {
  icon: string;
  title: string;
  subtitle: string;
  onClick: () => void;
  featured?: boolean;
}) {
  return (
    <button type="button" className={featured ? "cm-replica-play-action featured" : "cm-replica-play-action"} onClick={onClick}>
      <span className="cm-replica-action-icon" aria-hidden="true">{icon}</span>
      <span className="cm-replica-action-copy"><strong>{title}</strong><small>{subtitle}</small></span>
      <span className="cm-replica-action-arrow" aria-hidden="true">›</span>
    </button>
  );
}

function PageHeading({ eyebrow, title, subtitle, action }: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="cm-replica-page-heading">
      <div><span>{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>
      {action}
    </header>
  );
}

/** Chess.com-inspired /play layout: full-size board with true SVG chess pieces and a separate game-mode panel. */
export function PlayHubScreen({ profile, accountProfile, onNavigate }: {
  profile: PlayerProfile;
  accountProfile: AccountProfile | null;
  onNavigate: Navigate;
}) {
  const preferences = loadGameplayPreferences();
  const username = accountProfile?.username ?? profile.name;

  return (
    <div className="cm-replica-page cm-play-page">
      <PageHeading
        eyebrow="CHESSMART PLAY"
        title="Играть в шахматы"
        subtitle="Выбери режим, настрой контроль времени и начинай партию."
        action={<button type="button" className="cm-replica-secondary-button" onClick={() => onNavigate("settings")}>⚙ Настройки доски</button>}
      />
      <div className="cm-replica-play-layout">
        <section className="cm-replica-board-column" aria-label="Предпросмотр шахматной партии">
          <div className="cm-replica-player-strip cm-opponent-strip">
            <div className="cm-replica-opponent-avatar">♟</div>
            <div className="cm-replica-player-copy"><strong>Соперник</strong><small>Ожидает начала партии</small></div>
            <span className="cm-replica-rating">—</span>
            <span className="cm-replica-clock">10:00</span>
          </div>
          <div className="cm-replica-board-frame">
            <GameBoard
              fen={START_FEN}
              orientation="white"
              interactive={false}
              theme={preferences.boardTheme}
              showLegalMoves={false}
              highlightLastMove={false}
              animations={false}
            />
          </div>
          <div className="cm-replica-player-strip cm-own-player-strip">
            <Avatar accountProfile={accountProfile} name={profile.name} size="small" />
            <div className="cm-replica-player-copy"><strong>{username}</strong><small>{accountProfile ? "CHESSMART member" : "Локальный игрок"}</small></div>
            <span className="cm-replica-rating">{accountProfile?.rapid_rating ?? profile.rating}</span>
            <span className="cm-replica-clock">10:00</span>
          </div>
          <div className="cm-replica-board-tools">
            <span>Доска-превью</span>
            <span>Фигуры и цвета настраиваются в параметрах</span>
          </div>
        </section>
        <aside className="cm-replica-play-panel">
          <div className="cm-replica-play-panel-heading">
            <span className="cm-replica-panel-kicker">CHESSMART</span>
            <h2>Play Chess</h2>
            <p>Найди соперника или выбери свой способ игры.</p>
          </div>
          <div className="cm-replica-control-row">
            <span>Контроль времени</span><strong>10 мин <span>⌄</span></strong>
          </div>
          <div className="cm-replica-play-actions">
            <PlayAction icon="⚡" title="Играть онлайн" subtitle="Соперник твоего уровня" featured onClick={() => onNavigate("online")} />
            <PlayAction icon="♞" title="Играть с ботом" subtitle="От новичка до мастера" onClick={() => onNavigate("play")} />
            <PlayAction icon="🤝" title="Играть с другом" subtitle="Пригласи друга по ссылке" onClick={() => onNavigate("online")} />
            <PlayAction icon="🎓" title="Играть с тренером" subtitle="Подсказки и разбор ходов" onClick={() => onNavigate("coach")} />
            <PlayAction icon="🏆" title="Puzzle Battle" subtitle="Соревнование по решению задач" onClick={() => onNavigate("battle")} />
            <PlayAction icon="📖" title="Дебюты и позиции" subtitle="Изучай планы и варианты" onClick={() => onNavigate("openings")} />
          </div>
          <div className="cm-replica-panel-footer">
            <button type="button" onClick={() => onNavigate("profileDetails")}>История партий</button>
            <button type="button" onClick={() => onNavigate("stats")}>Статистика</button>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Chess.com-inspired home dashboard with quick pairing, recent games, training and personal stats. */
export function HomeDashboardScreen({ profile, accountProfile, onNavigate }: {
  profile: PlayerProfile;
  accountProfile: AccountProfile | null;
  onNavigate: Navigate;
}) {
  const username = accountProfile?.username ?? profile.name;
  const recentGames = [...(profile.history ?? [])].sort((a, b) => b.at - a.at).slice(0, 5);
  const solvedPuzzles = (profile.puzzles ?? []).filter((puzzle) => !!puzzle.solvedAt).length;
  const games = profile.wins + profile.losses + profile.draws;
  const winRate = games ? Math.round(profile.wins / games * 100) : 0;
  const onlineGames = accountProfile
    ? accountProfile.bullet_games + accountProfile.blitz_games + accountProfile.rapid_games
    : 0;

  return (
    <div className="cm-replica-page cm-dashboard-page">
      <header className="cm-dashboard-welcome">
        <div className="cm-dashboard-identity">
          <Avatar accountProfile={accountProfile} name={profile.name} size="large" />
          <div><span className="cm-replica-eyebrow">ТВОЯ ШАХМАТНАЯ ПЛАТФОРМА</span><h1>С возвращением, {username}</h1><p>Готов сыграть ещё одну партию?</p></div>
        </div>
        <div className="cm-dashboard-top-stats">
          <div><strong>{accountProfile?.rapid_rating ?? profile.rating}</strong><span>{accountProfile ? "Rapid" : "Локальный Elo"}</span></div>
          <div><strong>{profile.puzzleRating}</strong><span>Puzzle Rating</span></div>
          <div><strong>{accountProfile ? onlineGames : games}</strong><span>{accountProfile ? "Онлайн-партий" : "Партий против бота"}</span></div>
        </div>
      </header>

      <div className="cm-dashboard-layout">
        <main className="cm-dashboard-main">
          <section className="cm-replica-card cm-dashboard-quick-card">
            <div className="cm-replica-section-heading">
              <div><h2>Начать игру</h2><p>Выбери режим или запусти быструю партию</p></div>
              <button type="button" className="cm-replica-text-button" onClick={() => onNavigate("playHub")}>Все режимы →</button>
            </div>
            <div className="cm-dashboard-quick-grid">
              <button type="button" className="cm-dashboard-quick-tile tile-featured" onClick={() => onNavigate("online")}>
                <span className="cm-dashboard-tile-art">⚡</span><span className="cm-dashboard-tile-title">Играть 10 мин</span><small>Быстрый поиск соперника</small>
              </button>
              <button type="button" className="cm-dashboard-quick-tile" onClick={() => onNavigate("playHub")}>
                <span className="cm-dashboard-tile-art">♟</span><span className="cm-dashboard-tile-title">Новая партия</span><small>Выбрать контроль времени</small>
              </button>
              <button type="button" className="cm-dashboard-quick-tile" onClick={() => onNavigate("play")}>
                <span className="cm-dashboard-tile-art">♞</span><span className="cm-dashboard-tile-title">Против бота</span><small>Настроить силу Stockfish</small>
              </button>
              <button type="button" className="cm-dashboard-quick-tile" onClick={() => onNavigate("online")}>
                <span className="cm-dashboard-tile-art">♙</span><span className="cm-dashboard-tile-title">С другом</span><small>Создать приглашение</small>
              </button>
            </div>
          </section>

          <section className="cm-replica-card cm-dashboard-games-card">
            <div className="cm-replica-section-heading">
              <div><h2>Последние партии</h2><p>Твоя недавняя игровая активность</p></div>
              <button type="button" className="cm-replica-text-button" onClick={() => onNavigate("profileDetails")}>Все партии →</button>
            </div>
            {recentGames.length ? (
              <div className="cm-dashboard-game-list">
                {recentGames.map((game, index) => (
                  <div className="cm-dashboard-game-row" key={`${game.at}-${index}`}>
                    <span className={`cm-dashboard-result-dot ${game.result}`} />
                    <div className="cm-dashboard-game-opponent"><strong>Stockfish · {game.botElo}</strong><small>{new Date(game.at).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })}</small></div>
                    <span className={`cm-dashboard-result-label ${game.result}`}>{game.result === "win" ? "Победа" : game.result === "loss" ? "Поражение" : "Ничья"}</span>
                    <strong className="cm-dashboard-game-rating">{game.ratingAfter}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="cm-dashboard-empty-games"><span>♟</span><div><strong>Здесь появятся твои партии</strong><small>Сыграй первую игру против Stockfish или найди соперника онлайн.</small></div><button type="button" onClick={() => onNavigate("playHub")}>Начать игру</button></div>
            )}
          </section>

          <section className="cm-replica-card cm-dashboard-progress-card">
            <div className="cm-replica-section-heading"><div><h2>Твой прогресс</h2><p>Личные результаты и тренировки</p></div><button type="button" className="cm-replica-text-button" onClick={() => onNavigate("stats")}>Статистика →</button></div>
            <div className="cm-dashboard-progress-grid">
              <div><span>Победы</span><strong>{profile.wins}</strong><small>{winRate}% от локальных партий</small></div>
              <div><span>Разобрано партий</span><strong>{profile.reviews?.length ?? 0}</strong><small>Stockfish Review</small></div>
              <div><span>Решено задач</span><strong>{solvedPuzzles}</strong><small>Puzzle Library</small></div>
              <div><span>Блестящие ходы</span><strong>{(profile.reviews ?? []).reduce((sum, review) => sum + review.brilliantMoves.length, 0)}</strong><small>В разобранных партиях</small></div>
            </div>
          </section>
        </main>

        <aside className="cm-dashboard-aside">
          <section className="cm-replica-card cm-dashboard-daily-card">
            <div className="cm-replica-section-heading"><div><h2>Тренировка дня</h2><p>Поддерживай игровую форму</p></div><span className="cm-dashboard-daily-icon">♞</span></div>
            <div className="cm-dashboard-daily-stat"><strong>{solvedPuzzles}</strong><span>решённых задач</span></div>
            <p>Тактика, Puzzle Rush и персональные задания помогут закрепить навыки.</p>
            <button type="button" className="cm-replica-primary-button" onClick={() => onNavigate("puzzles")}>Решать задачи</button>
            <button type="button" className="cm-replica-secondary-wide" onClick={() => onNavigate("daily")}>Задача дня и Puzzle Rush</button>
          </section>

          <section className="cm-replica-card cm-dashboard-rating-card">
            <div className="cm-replica-section-heading"><div><h2>Рейтинги</h2><p>{accountProfile ? "Онлайн и локальная игра" : "Твой локальный рейтинг"}</p></div></div>
            {accountProfile ? (
              <div className="cm-dashboard-rating-list">
                <div><span>Bullet</span><strong>{accountProfile.bullet_rating}</strong></div>
                <div><span>Blitz</span><strong>{accountProfile.blitz_rating}</strong></div>
                <div><span>Rapid</span><strong>{accountProfile.rapid_rating}</strong></div>
              </div>
            ) : (
              <div className="cm-dashboard-rating-list">
                <div><span>Локальный Elo</span><strong>{profile.rating}</strong></div>
                <div><span>Puzzle Rating</span><strong>{profile.puzzleRating}</strong></div>
              </div>
            )}
            <button type="button" className="cm-replica-text-button" onClick={() => onNavigate("profile")}>Открыть профиль →</button>
          </section>

          <section className="cm-replica-card cm-dashboard-news-card">
            <div className="cm-replica-section-heading"><div><h2>Обновления CHESSMART</h2><p>Изменения проекта на GitHub</p></div></div>
            <p>Новые функции, исправления и улучшения платформы.</p>
            <button type="button" className="cm-replica-secondary-wide" onClick={() => onNavigate("news")}>Смотреть последние изменения</button>
          </section>
        </aside>
      </div>
    </div>
  );
}

/** Chess.com-style member page: identity, quick ratings, tabs, recent games and a stats rail. */
export function ProfileHubScreen({ profile, accountProfile, onNavigate }: {
  profile: PlayerProfile;
  accountProfile: AccountProfile | null;
  onNavigate: Navigate;
}) {
  const username = accountProfile?.username ?? profile.name;
  const recentGames = [...(profile.history ?? [])].sort((a, b) => b.at - a.at).slice(0, 8);
  const solvedPuzzles = (profile.puzzles ?? []).filter((puzzle) => !!puzzle.solvedAt).length;
  const totalOnlineGames = accountProfile
    ? accountProfile.bullet_games + accountProfile.blitz_games + accountProfile.rapid_games
    : 0;
  const games = profile.wins + profile.losses + profile.draws;
  const winRate = games ? Math.round(profile.wins / games * 100) : 0;

  return (
    <div className="cm-replica-page cm-member-page">
      <section className="cm-member-hero">
        <Avatar accountProfile={accountProfile} name={profile.name} size="large" />
        <div className="cm-member-identity">
          <span className="cm-replica-eyebrow">CHESSMART MEMBER</span>
          <h1>{username}</h1>
          <p>{accountProfile ? "Онлайн-игрок CHESSMART" : "Локальный профиль · данные сохранены на этом устройстве"}</p>
          <div className="cm-member-meta"><span>♟ {accountProfile ? `${totalOnlineGames} онлайн-партий` : `${profile.games} партий против бота`}</span><span>♙ {solvedPuzzles} решённых задач</span></div>
        </div>
        <div className="cm-member-actions">
          <button type="button" className="cm-replica-primary-button" onClick={() => onNavigate("online")}>Играть онлайн</button>
          <button type="button" className="cm-replica-secondary-button" onClick={() => onNavigate("settings")}>Настроить профиль</button>
        </div>
      </section>

      <nav className="cm-member-tabs" aria-label="Разделы профиля">
        <button type="button" className="active">Обзор</button>
        <button type="button" onClick={() => onNavigate("stats")}>Статистика</button>
        <button type="button" onClick={() => onNavigate("profileDetails")}>Партии</button>
        <button type="button" onClick={() => onNavigate("settings")}>Настройки</button>
      </nav>

      <div className="cm-member-layout">
        <main className="cm-member-main">
          <section className="cm-replica-card cm-member-ratings">
            <div className="cm-replica-section-heading"><div><h2>Рейтинги</h2><p>Результаты по разным режимам игры</p></div><button type="button" className="cm-replica-text-button" onClick={() => onNavigate("stats")}>Все рейтинги →</button></div>
            {accountProfile ? (
              <div className="cm-member-rating-grid">
                <div><span>Bullet</span><strong>{accountProfile.bullet_rating}</strong><small>{accountProfile.bullet_games} партий</small></div>
                <div><span>Blitz</span><strong>{accountProfile.blitz_rating}</strong><small>{accountProfile.blitz_games} партий</small></div>
                <div><span>Rapid</span><strong>{accountProfile.rapid_rating}</strong><small>{accountProfile.rapid_games} партий</small></div>
              </div>
            ) : (
              <div className="cm-member-rating-grid">
                <div><span>Локальный Elo</span><strong>{profile.rating}</strong><small>Против Stockfish</small></div>
                <div><span>Puzzle Rating</span><strong>{profile.puzzleRating}</strong><small>Решение задач</small></div>
                <div><span>Процент побед</span><strong>{winRate}%</strong><small>{games} партий</small></div>
              </div>
            )}
          </section>

          <section className="cm-replica-card cm-member-recent-games">
            <div className="cm-replica-section-heading"><div><h2>Последние партии</h2><p>История локальных партий против Stockfish</p></div><button type="button" className="cm-replica-text-button" onClick={() => onNavigate("profileDetails")}>Полная история →</button></div>
            {recentGames.length ? (
              <div className="cm-dashboard-game-list">
                {recentGames.map((game, index) => (
                  <div className="cm-dashboard-game-row" key={`${game.at}-${index}`}>
                    <span className={`cm-dashboard-result-dot ${game.result}`} />
                    <div className="cm-dashboard-game-opponent"><strong>Stockfish · {game.botElo}</strong><small>{new Date(game.at).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })}</small></div>
                    <span className={`cm-dashboard-result-label ${game.result}`}>{game.result === "win" ? "Победа" : game.result === "loss" ? "Поражение" : "Ничья"}</span>
                    <strong className="cm-dashboard-game-rating">{game.ratingAfter}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="cm-dashboard-empty-games"><span>♟</span><div><strong>История пока пуста</strong><small>После первых партий здесь появятся соперники, результаты и рейтинг.</small></div><button type="button" onClick={() => onNavigate("playHub")}>Сыграть партию</button></div>
            )}
          </section>
        </main>

        <aside className="cm-member-aside">
          <section className="cm-replica-card cm-member-stats-card">
            <div className="cm-replica-section-heading"><div><h2>Статистика</h2><p>Личные показатели</p></div><button type="button" className="cm-replica-text-button" onClick={() => onNavigate("stats")}>Подробнее →</button></div>
            <div className="cm-member-kpi"><span>Победы</span><strong>{profile.wins}</strong></div>
            <div className="cm-member-kpi"><span>Ничьи</span><strong>{profile.draws}</strong></div>
            <div className="cm-member-kpi"><span>Поражения</span><strong>{profile.losses}</strong></div>
            <div className="cm-member-winbar"><span style={{ width: `${winRate}%` }} /></div>
            <div className="cm-member-win-caption"><span>Процент побед</span><strong>{winRate}%</strong></div>
            <div className="cm-member-kpi"><span>Разобрано партий</span><strong>{profile.reviews?.length ?? 0}</strong></div>
            <div className="cm-member-kpi"><span>Блестящие ходы</span><strong>{(profile.reviews ?? []).reduce((sum, review) => sum + review.brilliantMoves.length, 0)}</strong></div>
          </section>
          <section className="cm-replica-card cm-member-training-card">
            <div className="cm-replica-section-heading"><div><h2>Тренировка</h2><p>Задачи и прогресс</p></div></div>
            <div className="cm-member-training-number">{solvedPuzzles}</div>
            <p>Решённых задач</p>
            <button type="button" className="cm-replica-secondary-wide" onClick={() => onNavigate("puzzles")}>Открыть Puzzle Library</button>
          </section>
        </aside>
      </div>
    </div>
  );
}
