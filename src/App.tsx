import { Component, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { EngineProvider, useEngine } from "./hooks/useEngine";
import { EngineLoader } from "./components/EngineLoader";
import { ImportScreen } from "./components/ImportScreen";
import { AnalyzingScreen } from "./components/AnalyzingScreen";
import { ReviewScreen } from "./components/ReviewScreen";
import { ProfileGamesPanel } from "./components/ProfileGamesPanel";
import { PlayScreen } from "./components/PlayScreen";
import { OnlinePlayScreen } from "./components/OnlinePlayScreen";
import { ProfileScreen } from "./components/ProfileScreen";
import { MistakeTrainerScreen } from "./components/MistakeTrainerScreen";
import { PuzzleLibraryScreen } from "./components/PuzzleLibraryScreen";
import { DailyTrainingScreen } from "./components/DailyTrainingScreen";
import { LearningPathScreen } from "./components/LearningPathScreen";
import { PuzzleBattleScreen } from "./components/PuzzleBattleScreen";
import { EndgameTrainingScreen } from "./components/EndgameTrainingScreen";
import { OpeningExplorerScreen } from "./components/OpeningExplorerScreen";
import { PositionLabScreen } from "./components/PositionLabScreen";
import { Grandmaster300Screen } from "./components/Grandmaster300Screen";
import { TrainingAcademyScreen } from "./components/TrainingAcademyScreen";
import { PersonalCoachScreen } from "./components/PersonalCoachScreen";
import { SystemsHubScreen } from "./components/SystemsHubScreen";
import { applySuitePreferences, loadSuiteSettings } from "./lib/systemsSuite";
import { MotivationBanner } from "./components/MotivationBanner";
import { buildTrainingRecommendations } from "./lib/trainingAcademy";
import { reviewGame, type AnalyzeProgress } from "./lib/analyze";
import {
  loadPlayerProfile,
  savePlayerProfile,
  recordReviewedGame,
  recordPersonalGameReview,
  type PlayerProfile,
} from "./lib/playerProfile";
import type { Color, GameReview } from "./types";
import { ACCOUNT_PROFILE_EVENT, readAccountProfile, type AccountProfile } from "./lib/accountProfile";
import { SettingsScreen, NewsScreen, type ShellRoute } from "./components/ChessmartShellScreens";
import { PlayHubScreen, ProfileHubScreen } from "./components/ChessmartReplicaScreens";

type Stage = "import" | "analyzing" | "review";
type MainMode = ShellRoute | "daily" | "mistakes" | "endgame" | "lab" | "diagnostics" | "systems";
function BrandMark() {
  return (
    <svg viewBox="0 0 44 44" width="38" height="38" aria-hidden="true">
      <rect x="1" y="1" width="42" height="42" rx="12" fill="#81b64c" />
      <path d="M11 34h23v2H11zM14 31c.6-3.2 2.1-5.9 4.7-7.8-2.3-1.4-3.4-3.7-3.1-6.4.2-2.2 1.4-4.2 3.6-5.7l-1-4.1c3.2.5 5.3 2.1 6.3 4.8 3.4.1 5.6 2.3 6 5.3.4 3.5-1.1 6.4-3.4 8.6 1.4 1.8 2.3 3.6 2.8 5.3H14Z" fill="#1b2415" />
      <circle cx="22.8" cy="14.7" r="1.15" fill="#81b64c" />
      <path d="M18.8 24.2h10.5" stroke="#81b64c" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}


function SidebarIcon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
    play: <><path d="M7 4.5v15l12-7.5z" /></>,
    puzzle: <><path d="M8 4h3a2 2 0 1 1 4 0h3v5a2 2 0 1 1 0 4v7h-5a2 2 0 1 0-4 0H5v-6a2 2 0 1 1 0-4V4z" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21z" /><path d="M4 5.5v15.2M8 7h8M8 11h8" /></>,
    analysis: <><path d="M4 19V5M4 19h17" /><path d="m7 15 4-4 3 2 5-7" /></>,
    news: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h4v4H7zM14 8h4M14 12h4M7 16h11" /></>,
    online: <><path d="M5 12a10 10 0 0 1 14 0M8 15a6 6 0 0 1 8 0M11 18a2 2 0 0 1 2 0" /><circle cx="12" cy="20" r=".8" fill="currentColor" stroke="none" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
    lessons: <><path d="m2 9 10-5 10 5-10 5z" /><path d="M6 11v5c3.5 3 8.5 3 12 0v-5M22 9v7" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
    collapse: <><path d="M3 4h18M3 20h18M9 4v16M16 9l-3 3 3 3" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.5.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.5-.9l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.8L6.3 12l1.4-2.4 1.7.6a8 8 0 0 1 1.5-.9l.3-1.8H14l.3 1.8a8 8 0 0 1 1.5.9l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1-.1 1.9Z" transform="translate(0 -1)" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.6 2.6 0 1 1 4.7 1.5c-.8 1-2.2 1.3-2.2 3M12 17.5h.01" /></>,
  };
  return <svg className="cm-side-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? paths.more}</svg>;
}

function AvatarPlaceholder({ accountProfile, name }: { accountProfile: AccountProfile | null; name: string }) {
  return accountProfile?.avatar_url
    ? <img className="cm-sidebar-avatar" src={accountProfile.avatar_url} alt="" />
    : <span className="cm-sidebar-avatar">{(accountProfile?.username ?? name).slice(0, 1).toUpperCase()}</span>;
}

function Main() {
  const { engine, computeProfile } = useEngine();
  const [stage, setStage] = useState<Stage>("import");
  const [mode, setMode] = useState<MainMode>("playHub");
  const [progress, setProgress] = useState<AnalyzeProgress | null>(null);
  const [review, setReview] = useState<GameReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [profile, setProfile] = useState<PlayerProfile>(() => loadPlayerProfile());
  const [mobileMore, setMobileMore] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("chessmart:sidebar-collapsed:v1") === "true"; }
    catch { return false; }
  });
  const [accountProfile, setAccountProfile] = useState<AccountProfile | null>(() => readAccountProfile());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => savePlayerProfile(profile), [profile]);

  useEffect(() => {
    try { localStorage.setItem("chessmart:sidebar-collapsed:v1", String(sidebarCollapsed)); }
    catch { /* local storage can be unavailable in private browsing */ }
  }, [sidebarCollapsed]);

  useEffect(() => {
    const applyPreferences = () => applySuitePreferences(loadSuiteSettings());
    applyPreferences();
    window.addEventListener("storage", applyPreferences);
    return () => window.removeEventListener("storage", applyPreferences);
  }, []);

  useEffect(() => {
    if (!mobileMore) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMore(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileMore]);

  useEffect(() => {
    const handleAccountProfile = (event: Event) => {
      setAccountProfile((event as CustomEvent<AccountProfile | null>).detail ?? null);
    };
    window.addEventListener(ACCOUNT_PROFILE_EVENT, handleAccountProfile);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "chessmart:account-profile:v1") setAccountProfile(readAccountProfile());
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(ACCOUNT_PROFILE_EVENT, handleAccountProfile);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  // Hydrate the signed-in identity even for accounts created before avatar/profile caching existed.
  useEffect(() => {
    let cancelled = false;
    const hydrateAccount = async () => {
      const configuredUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
      const url = configuredUrl.endsWith("/") ? configuredUrl.slice(0, -1) : configuredUrl;
      const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";
      if (!url || !key) return;
      try {
        const raw = localStorage.getItem("chessmart:account-session:v2");
        if (!raw) return;
        let saved = JSON.parse(raw) as { access_token: string; refresh_token: string; expires_at: number };
        if (!saved.access_token) return;
        if (saved.expires_at <= Date.now() + 60_000 && saved.refresh_token) {
          const refreshedResponse = await fetch(url + "/auth/v1/token?grant_type=refresh_token", {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: key },
            body: JSON.stringify({ refresh_token: saved.refresh_token }),
          });
          const refreshed = await refreshedResponse.json();
          if (!refreshedResponse.ok || !refreshed.access_token) return;
          saved = { ...refreshed, expires_at: Date.now() + (refreshed.expires_in ?? 3600) * 1000 };
          localStorage.setItem("chessmart:account-session:v2", JSON.stringify(saved));
        }
        const response = await fetch(url + "/functions/v1/game-action", {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: key, Authorization: "Bearer " + saved.access_token },
          body: JSON.stringify({ action: "profile" }),
        });
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled && data.profile?.user_id && data.profile?.username) {
          const profile = data.profile as AccountProfile;
          try { localStorage.setItem("chessmart:account-profile:v1", JSON.stringify(profile)); } catch { /* storage may be unavailable */ }
          setAccountProfile(profile);
        }
      } catch { /* offline or an expired session; OnlinePlayScreen handles its own reconnect flow */ }
    };
    void hydrateAccount();
    return () => { cancelled = true; };
  }, []);

  const persistPersonalReview = useCallback((result: GameReview, color: Color, ratingType?: "bullet" | "blitz" | "rapid") => {
    setProfile((current) => recordPersonalGameReview(current, result, color, ratingType));
  }, []);

  const openPersonalReview = useCallback((result: GameReview) => {
    abortRef.current?.abort();
    abortRef.current = null;
    setReview(result);
    setMode("review");
    setStage("review");
    setIsRefining(false);
    setError(null);
  }, []);

  const start = useCallback(async (pgn: string, timePerPositionMs: number) => {
    if (!engine) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setProgress(null);
    setIsRefining(false);
    setStage("analyzing");
    try {
      const result = await reviewGame(
        pgn,
        timePerPositionMs,
        engine,
        setProgress,
        controller.signal,
        computeProfile
      );
      if (controller.signal.aborted || abortRef.current !== controller) return;
      setReview(result);
      setProfile((current) => recordReviewedGame(current, result));
      setMode("review");
      setIsRefining(false);
      setStage("review");
      abortRef.current = null;
    } catch (reason) {
      if (abortRef.current !== controller) return;
      abortRef.current = null;
      setIsRefining(false);
      if (controller.signal.aborted) {
        setStage("import");
      } else {
        setError(reason instanceof Error ? reason.message : String(reason));
        setStage("import");
      }
    }
  }, [engine, computeProfile]);

  const changeMode = useCallback((next: MainMode) => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRefining(false);
    setMode(next);
    setMobileMore(false);
    setMoreOpen(false);
    setSearchOpen(false);
    setSearchTerm("");
    setStage("import");
    setError(null);
  }, []);

  if (stage === "analyzing") return <AnalyzingScreen progress={progress} onCancel={() => abortRef.current?.abort()} />;

  let page = null;
  if (mode === "home" || mode === "playHub") page = <PlayHubScreen profile={profile} accountProfile={accountProfile} onNavigate={changeMode} />;
  else if (mode === "profile" || mode === "stats") page = <ProfileHubScreen profile={profile} accountProfile={accountProfile} onNavigate={changeMode} initialTab={mode === "stats" ? "stats" : "overview"} />;
  else if (mode === "settings") page = <SettingsScreen profile={profile} accountProfile={accountProfile} onChangeProfile={setProfile} onNavigate={changeMode} />;
  else if (mode === "news") page = <NewsScreen />;
  else if (mode === "profileDetails") page = <ProfileScreen profile={profile} onChange={setProfile} onBack={() => changeMode("profile")} onOpenAccount={() => changeMode("online")} />;
  else if (mode === "play") page = engine
    ? <PlayScreen engine={engine} profile={profile} onFinished={setProfile} onPersonalReviewReady={persistPersonalReview} onOpenReview={openPersonalReview} onBack={() => changeMode("review")} />
    : <EngineLoader />;
  else if (mode === "online") page = <OnlinePlayScreen onBack={() => changeMode("review")} onPersonalReviewReady={persistPersonalReview} onOpenReview={openPersonalReview} />;
  else if (mode === "puzzles") page = <PuzzleLibraryScreen profile={profile} onChange={setProfile} onBack={() => changeMode("review")} />;
  else if (mode === "daily") page = <DailyTrainingScreen onBack={() => changeMode("review")} />;
  else if (mode === "battle") page = <PuzzleBattleScreen onBack={() => changeMode("review")} />;
  else if (mode === "lessons") page = <LearningPathScreen onBack={() => changeMode("review")} onNavigate={changeMode} />;
  else if (mode === "mistakes") page = <MistakeTrainerScreen profile={profile} onChange={setProfile} onBack={() => changeMode("review")} />;
  else if (mode === "coach") page = <PersonalCoachScreen profile={profile} onChange={setProfile} onBack={() => changeMode("review")} />;
  else if (mode === "academy") page = <TrainingAcademyScreen profile={profile} onBack={() => changeMode("review")} onNavigate={changeMode} />;
  else if (mode === "endgame") page = engine
    ? <EndgameTrainingScreen engine={engine} profile={profile} onChange={setProfile} onBack={() => changeMode("review")} />
    : <EngineLoader />;
  else if (mode === "openings") page = <OpeningExplorerScreen onBack={() => changeMode("review")} />;
  else if (mode === "lab") page = engine
    ? <PositionLabScreen engine={engine} onBack={() => changeMode("review")} />
    : <EngineLoader />;
  else if (mode === "diagnostics") page = <Grandmaster300Screen onBack={() => changeMode("review")} />;
  else if (mode === "systems") page = <SystemsHubScreen profile={profile} onBack={() => changeMode("review")} onNavigate={changeMode} />;
  else if (stage === "review" && review) page = (
    <ReviewScreen
      review={review}
      isRefining={isRefining}
      onNew={() => {
        abortRef.current?.abort();
        abortRef.current = null;
        setIsRefining(false);
        setReview(null);
        setMode("review");
        setStage("import");
      }}
    />
  );
  else {
    const nextRecommendation = buildTrainingRecommendations(profile)[0] ?? null;
    page = (
      <>
        {error && <div className="mx-auto mt-3 max-w-5xl rounded-lg border border-[#8c5049] bg-[#3e2926] px-4 py-2 text-sm text-[#ffd2cd]">Ошибка анализа: {error}</div>}
        <div className="mx-auto max-w-5xl px-4 pt-5 sm:px-6">
          <MotivationBanner />
          {engine && nextRecommendation && nextRecommendation.destination !== "review" && (
            <section className="mb-5 rounded-2xl border border-[#8eaf68]/25 bg-gradient-to-br from-[#2b3526] to-[#242b21] p-4 sm:p-5" aria-label="Персональная рекомендация">
              <div className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-[#9fbd82]">Следующий шаг · {nextRecommendation.durationMinutes} минут</div>
              <div className="mt-1 text-sm font-black text-white">{nextRecommendation.title}</div>
              <p className="mt-1 text-xs leading-relaxed text-[#b2bea8]">{nextRecommendation.reason}</p>
              <button type="button" onClick={() => changeMode(nextRecommendation.destination)} className="mt-3 rounded-lg bg-[#91bd69] px-3.5 py-2 text-xs font-extrabold text-[#172113] transition hover:bg-[#a5ce7f]">
                Начать тренировку →
              </button>
            </section>
          )}
        </div>
        {engine
          ? <>
              <ImportScreen onStart={(pgn, depth) => void start(pgn, depth)} />
              <ProfileGamesPanel onSelectGame={(pgn) => void start(pgn, 14)} />
            </>
          : <EngineLoader />}
      </>
    );
  }

  const searchTargets: Array<{ id: MainMode; label: string }> = [
    { id: "playHub", label: "Играть" },
    { id: "puzzles", label: "Задачи" },
    { id: "lessons", label: "Учёба" },
    { id: "online", label: "Играть по сети" },
    { id: "play", label: "Боты" },
    { id: "coach", label: "Тренер" },
    { id: "review", label: "Анализ партий" },
    { id: "battle", label: "Турниры" },
    { id: "openings", label: "Варианты шахмат" },
    { id: "profile", label: "Профиль" },
    { id: "stats", label: "Статистика" },
    { id: "settings", label: "Настройки" },
    { id: "news", label: "Новости проекта" },
  ];
  const filteredSearchTargets = searchTargets.filter((item) => item.label.toLowerCase().includes(searchTerm.trim().toLowerCase()));
  const communityActive = mode === "online" || mode === "battle";
  const mainNavigation: Array<{ id: MainMode; label: string; icon: string }> = [
    { id: "playHub", label: "Играть", icon: "play" },
    { id: "puzzles", label: "Задачи", icon: "puzzle" },
    { id: "lessons", label: "Учёба", icon: "lessons" },
  ];
  const mobileMoreNavigation: Array<{ id: MainMode; label: string; description: string }> = [
    { id: "review", label: "Анализ партий", description: "Разбор ходов и Stockfish" },
    { id: "online", label: "Играть по сети", description: "Живые партии и вызовы друзьям" },
    { id: "coach", label: "Тренер", description: "Персональные подсказки" },
    { id: "battle", label: "Турниры и соревнования", description: "Шахматные испытания" },
    { id: "academy", label: "Академия", description: "План обучения" },
    { id: "openings", label: "Варианты и дебюты", description: "Изучение дебютов" },
    { id: "stats", label: "Статистика", description: "Твои результаты" },
    { id: "news", label: "Новости", description: "Изменения CHESSMART" },
    { id: "settings", label: "Настройки", description: "Профиль и интерфейс" },
    { id: "systems", label: "Помощь", description: "Инструменты и диагностика" },
  ];

  return (
    <div className={sidebarCollapsed ? "cm-app-shell cm-sidebar-is-collapsed" : "cm-app-shell"}>
      <aside className="cm-sidebar">
        <button type="button" className="cm-brand" onClick={() => changeMode("playHub")} aria-label="CHESSMART — играть">
          <BrandMark /><span>CHESSMART</span>
        </button>

        <nav className="cm-sidebar-nav" aria-label="Главная навигация">
          {mainNavigation.map((item) => (
            <button key={item.id} type="button" onClick={() => changeMode(item.id)} aria-current={(mode === item.id || (item.id === "playHub" && mode === "home")) ? "page" : undefined} className={(mode === item.id || (item.id === "playHub" && mode === "home")) ? "cm-side-item active" : "cm-side-item"}>
              <span className="cm-side-icon"><SidebarIcon name={item.icon} /></span><span>{item.label}</span>
            </button>
          ))}
          <div className="cm-side-group cm-more-group">
            <button type="button" onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen} className={moreOpen ? "cm-side-item active" : "cm-side-item"}>
              <span className="cm-side-icon"><SidebarIcon name="more" /></span><span>Ещё</span><span className="cm-side-chevron">{moreOpen ? "⌃" : "⌄"}</span>
            </button>
            {moreOpen && <div className="cm-side-submenu">
              <button type="button" onClick={() => changeMode("review")}>Анализ партий</button>
              <button type="button" onClick={() => changeMode("online")} className={communityActive ? "active" : ""}>Играть по сети</button>
              <button type="button" onClick={() => changeMode("coach")}>Тренер</button>
              <button type="button" onClick={() => changeMode("battle")}>Турниры и соревнования</button>
              <button type="button" onClick={() => changeMode("academy")}>Академия</button>
              <button type="button" onClick={() => changeMode("openings")}>Варианты и дебюты</button>
              <button type="button" onClick={() => changeMode("stats")}>Статистика</button>
              <button type="button" onClick={() => changeMode("news")}>Новости</button>
            </div>}
          </div>
        </nav>

        <div className="cm-sidebar-bottom">
          {searchOpen && (
            <div className="cm-sidebar-search-panel">
              <input
                autoFocus
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") { setSearchOpen(false); setSearchTerm(""); }
                  if (event.key === "Enter" && filteredSearchTargets[0]) changeMode(filteredSearchTargets[0].id);
                }}
                placeholder="Поиск"
                aria-label="Поиск по CHESSMART"
              />
              <div className="cm-sidebar-search-results">
                {filteredSearchTargets.slice(0, 7).map((item) => (
                  <button type="button" key={item.id} onClick={() => changeMode(item.id)}>{item.label}</button>
                ))}
                {!filteredSearchTargets.length && <span>Ничего не найдено</span>}
              </div>
            </div>
          )}
          <button type="button" className="cm-sidebar-search" onClick={() => { setSearchOpen((open) => !open); setSearchTerm(""); }} aria-expanded={searchOpen}>
            <span className="cm-side-icon"><SidebarIcon name="search" /></span><span>Поиск</span>
          </button>
          <button type="button" className="cm-profile-shortcut" onClick={() => changeMode("profile")}>
            <AvatarPlaceholder accountProfile={accountProfile} name={profile.name} />
            <span><strong>{accountProfile?.username ?? profile.name}</strong></span>
          </button>
          <div className="cm-bottom-actions">
            <button type="button" className="cm-sidebar-toggle" onClick={() => setSidebarCollapsed((value) => !value)} title={sidebarCollapsed ? "Развернуть меню" : "Свернуть меню"} aria-label={sidebarCollapsed ? "Развернуть боковую панель" : "Свернуть боковую панель"} aria-pressed={sidebarCollapsed}><SidebarIcon name="collapse" /></button>
            <button type="button" onClick={() => changeMode("settings")} title="Настройки" aria-label="Настройки"><SidebarIcon name="settings" /></button>
            <button type="button" onClick={() => changeMode("systems")} title="Помощь" aria-label="Помощь"><SidebarIcon name="help" /></button>
          </div>
        </div>
      </aside>

      <div className="cm-main-column">
        <main className="cm-main-content mobile-app-main">{page}</main>
      </div>
      <nav className="cm-mobile-nav" aria-label="Мобильная навигация">
        <button type="button" onClick={() => changeMode("playHub")} className={mode === "playHub" || mode === "home" ? "active" : ""}><span>♟</span>Играть</button>
        <button type="button" onClick={() => changeMode("puzzles")} className={mode === "puzzles" ? "active" : ""}><span>◆</span>Задачи</button>
        <button type="button" onClick={() => changeMode("lessons")} className={mode === "lessons" ? "active" : ""}><span>♜</span>Учёба</button>
        <button type="button" onClick={() => changeMode("profile")} className={mode === "profile" ? "active" : ""}><span>♙</span>Профиль</button>
        <button type="button" onClick={() => { setMobileMore((open) => !open); setMoreOpen(false); }} className={mobileMore ? "active" : ""} aria-expanded={mobileMore} aria-haspopup="dialog"><span>•••</span>Ещё</button>
      </nav>
      {mobileMore && (
        <div className="cm-mobile-more-backdrop" onClick={() => setMobileMore(false)}>
          <section
            className="cm-mobile-more-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cm-mobile-more-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="cm-mobile-more-header">
              <div>
                <h2 id="cm-mobile-more-title">Ещё в CHESSMART</h2>
                <p>Разделы, инструменты и настройки</p>
              </div>
              <button type="button" onClick={() => setMobileMore(false)} aria-label="Закрыть меню">×</button>
            </header>
            <div className="cm-mobile-more-grid">
              {mobileMoreNavigation.map((item) => (
                <button type="button" key={item.id} onClick={() => changeMode(item.id)} className={mode === item.id ? "active" : ""}>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("CHESSMART render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#20251f", color: "#f2f1ed", fontFamily: "system-ui, sans-serif" }}>
          <section style={{ width: "min(100%, 620px)", padding: 28, border: "1px solid #59664d", borderRadius: 16, background: "#292f27", boxShadow: "0 24px 70px rgba(0,0,0,.35)" }}>
            <div style={{ color: "#a8d080", fontSize: 12, fontWeight: 900, letterSpacing: ".14em" }}>CHESSMART</div>
            <h1 style={{ margin: "12px 0 8px", fontSize: 24 }}>Не удалось отрисовать интерфейс</h1>
            <p style={{ margin: "0 0 16px", color: "#c0c5ba", fontSize: 14, lineHeight: 1.5 }}>Приложение поймало ошибку вместо пустого экрана. Обнови страницу — если проблема повторится, этот текст поможет её найти.</p>
            <pre style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap", padding: 12, borderRadius: 8, background: "#1d211c", color: "#e9c2b9", fontSize: 12 }}>{this.state.error}</pre>
            <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 12, padding: "10px 16px", border: 0, borderRadius: 8, background: "#9bc875", color: "#1c2417", fontWeight: 900 }}>Перезагрузить CHESSMART</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return <AppErrorBoundary><EngineProvider><Main /></EngineProvider></AppErrorBoundary>;
}