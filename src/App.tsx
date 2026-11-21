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
import { AccountAvatar } from "./components/AccountAvatar";

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
  const drawings: Record<string, ReactNode> = {
    play: <>
      <ellipse cx="18" cy="31" rx="12" ry="2.8" fill="#4e8538" opacity=".38" />
      <path d="M8 28.5c.7-2.9 3.5-4.5 6.5-5.3-2.3-1.8-3.5-4.1-3.5-6.7 0-3 1.5-5.2 4-6.4-.9-1.2-1.1-2.6-.5-4 2.5.8 4.1 2.4 4.8 4.6 3.1.2 5.1 2.5 5.1 5.7 0 2.7-1.4 5.2-3.7 6.9 3.2.9 5.2 2.5 6 5.2H8Z" fill="url(#cm-play-fill)" stroke="#d8e2d0" strokeWidth="1.1"/>
      <circle cx="18" cy="9.5" r="2.4" fill="#a4d85d" stroke="#527d36" strokeWidth="1"/>
      <path d="M11 29h14" stroke="#eaf2df" strokeWidth="1.2" strokeLinecap="round" opacity=".9"/>
    </>,
    puzzle: <>
      <path d="M8 7h7.3c-.1-2 1.1-3.5 2.9-3.5 1.9 0 3.1 1.5 3 3.5H28v7.4c2-.1 3.6 1.1 3.6 3 0 1.8-1.6 3-3.6 2.9V28h-7.3c.1-2-1.1-3.6-3-3.6-1.8 0-3 1.6-2.9 3.6H7.5v-7.4c-2 .1-3.5-1.1-3.5-2.9s1.5-3.1 3.5-3V7Z" fill="url(#cm-puzzle-fill)" stroke="#a95b28" strokeWidth="1.1"/>
      <path d="M9.5 9h5.2M10 11.2v3.6" stroke="#ffd39b" strokeWidth="1.2" strokeLinecap="round" opacity=".85"/>
    </>,
    lessons: <>
      <path d="m4 12.5 14-7 14 7-14 7-14-7Z" fill="url(#cm-learn-fill)" stroke="#3c669e" strokeWidth="1.1"/>
      <path d="M10 16v7.2c4.8 3.6 11.2 3.6 16 0V16" fill="#4a8bc4" stroke="#315d8c" strokeWidth="1"/>
      <path d="M31.5 13v9" stroke="#9dc9ec" strokeWidth="2" strokeLinecap="round"/>
      <circle cx="31.5" cy="23.5" r="1.8" fill="#e1b858"/>
    </>,
    train: <>
      <rect x="4" y="5" width="28" height="26" rx="5" fill="#344a68" stroke="#5879a0" strokeWidth="1"/>
      <path d="M9 25V19h4v6M16 25V14h4v11M23 25V10h4v15" fill="#63bdc7" stroke="#2e8290" strokeWidth=".8"/>
      <path d="m8 15 7-5 5 2 8-6" fill="none" stroke="#b9e18a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="28" cy="6" r="2" fill="#c4e98f"/>
    </>,
    news: <>
      <rect x="5" y="5" width="26" height="26" rx="3" fill="#dedbd3" stroke="#8c8981" strokeWidth="1.2"/>
      <path d="M9 10h18v3H9z" fill="#d46a4f"/>
      <rect x="9" y="16" width="7" height="7" rx="1" fill="#7f9b65"/>
      <path d="M19 16h8M19 19h8M9 26h18" stroke="#77756f" strokeWidth="1.4" strokeLinecap="round"/>
    </>,
    community: <>
      <circle cx="13" cy="12" r="5" fill="#d6a66e" stroke="#a9784b" strokeWidth="1"/>
      <circle cx="25" cy="13" r="4.2" fill="#8cb7d8" stroke="#547f9f" strokeWidth="1"/>
      <path d="M4.5 29c.5-5 3.6-8 8.5-8s8 3 8.5 8H4.5Z" fill="#9b765b" stroke="#74523e" strokeWidth="1"/>
      <path d="M19 28.5c.5-4.3 2.7-6.7 6.2-6.7s5.7 2.4 6.2 6.7H19Z" fill="#688eac" stroke="#456980" strokeWidth="1"/>
    </>,
    more: <>
      <circle cx="8" cy="18" r="3.2" fill="#c9c8c3"/>
      <circle cx="18" cy="18" r="3.2" fill="#a6a49e"/>
      <circle cx="28" cy="18" r="3.2" fill="#85837d"/>
    </>,
    search: <>
      <circle cx="15.5" cy="15.5" r="8.5" fill="none" stroke="currentColor" strokeWidth="2.4"/>
      <path d="m22 22 7 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"/>
    </>,
    collapse: <>
      <rect x="4" y="5" width="28" height="26" rx="3" fill="none" stroke="currentColor" strokeWidth="2"/>
      <path d="M13 5v26M22 13l-5 5 5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </>,
    settings: <>
      <path d="m18 4 2 1 2.4-.6 2.1 2.1-.6 2.4 1 2 2.4 1v3l-2.4 1-1 2 .6 2.4-2.1 2.1-2.4-.6-2 1-1 2.4h-3l-1-2.4-2-1-2.4.6-2.1-2.1.6-2.4-1-2-2.4-1v-3l2.4-1 1-2-.6-2.4 2.1-2.1 2.4.6 2-1 1-2.4h3L18 4Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
      <circle cx="16.5" cy="14.5" r="4" fill="none" stroke="currentColor" strokeWidth="1.8"/>
    </>,
    help: <>
      <circle cx="18" cy="18" r="13" fill="none" stroke="currentColor" strokeWidth="2"/>
      <path d="M14 14a4.2 4.2 0 1 1 6.6 3.4c-1.7 1.2-2.6 2-2.6 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <circle cx="18" cy="26" r="1.3" fill="currentColor"/>
    </>,
  };
  const colored = ["play", "puzzle", "lessons", "train", "news", "community", "more"].includes(name);
  return (
    <svg
      className={`cm-side-svg cm-side-svg-${name}`}
      viewBox="0 0 36 36"
      aria-hidden="true"
      fill="none"
      stroke={colored ? "none" : "currentColor"}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "play" && <defs><linearGradient id="cm-play-fill" x1="9" y1="6" x2="29" y2="29" gradientUnits="userSpaceOnUse"><stop stopColor="#fff"/><stop offset="1" stopColor="#c6d3bd"/></linearGradient></defs>}
      {name === "puzzle" && <defs><linearGradient id="cm-puzzle-fill" x1="6" y1="5" x2="29" y2="30" gradientUnits="userSpaceOnUse"><stop stopColor="#ffb04f"/><stop offset="1" stopColor="#e87827"/></linearGradient></defs>}
      {name === "lessons" && <defs><linearGradient id="cm-learn-fill" x1="4" y1="6" x2="32" y2="20" gradientUnits="userSpaceOnUse"><stop stopColor="#8dd0f1"/><stop offset="1" stopColor="#457fc1"/></linearGradient></defs>}
      {drawings[name] ?? drawings.more}
    </svg>
  );
}
function AvatarPlaceholder({ accountProfile, name }: { accountProfile: AccountProfile | null; name: string }) {
  const username = accountProfile?.username ?? name;
  return <AccountAvatar src={accountProfile?.avatar_url} name={username} className="cm-sidebar-avatar" />;
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
  const [expandedNav, setExpandedNav] = useState<string | null>(null);
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
    setExpandedNav(null);
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
    { id: "playHub", label: "Главная" },
    { id: "online", label: "Играть по сети" },
    { id: "play", label: "Против бота" },
    { id: "battle", label: "Дуэль задач" },
    { id: "puzzles", label: "Библиотека задач" },
    { id: "daily", label: "Ежедневная задача" },
    { id: "lessons", label: "Учебный план" },
    { id: "academy", label: "Академия" },
    { id: "coach", label: "Персональный тренер" },
    { id: "openings", label: "Дебюты" },
    { id: "review", label: "Анализ партий" },
    { id: "mistakes", label: "Тренажёр ошибок" },
    { id: "endgame", label: "Эндшпиль" },
    { id: "lab", label: "Лаборатория позиций" },
    { id: "diagnostics", label: "Grandmaster 300" },
    { id: "profile", label: "Профиль" },
    { id: "profileDetails", label: "Архив партий" },
    { id: "stats", label: "Статистика" },
    { id: "news", label: "Новости проекта" },
    { id: "settings", label: "Настройки" },
    { id: "systems", label: "Системы и диагностика" },
  ];
  const filteredSearchTargets = searchTargets.filter((item) => item.label.toLowerCase().includes(searchTerm.trim().toLowerCase()));

  const sidebarGroups: Array<{ id: string; label: string; icon: string; landing: MainMode; items: Array<{ id: MainMode; label: string }> }> = [
    { id: "play", label: "Играть", icon: "play", landing: "playHub", items: [
      { id: "playHub", label: "Главная" },
      { id: "online", label: "Играть по сети" },
      { id: "play", label: "Против бота" },
      { id: "battle", label: "Дуэль задач" },
    ] },
    { id: "puzzles", label: "Задачи", icon: "puzzle", landing: "puzzles", items: [
      { id: "puzzles", label: "Библиотека задач" },
      { id: "daily", label: "Ежедневная задача" },
    ] },
    { id: "learn", label: "Учёба", icon: "lessons", landing: "lessons", items: [
      { id: "lessons", label: "Учебный план" },
      { id: "academy", label: "Академия" },
      { id: "coach", label: "Персональный тренер" },
      { id: "openings", label: "Дебюты и варианты" },
    ] },
    { id: "train", label: "Тренировка", icon: "train", landing: "review", items: [
      { id: "review", label: "Анализ партий" },
      { id: "mistakes", label: "Тренажёр ошибок" },
      { id: "endgame", label: "Тренировка эндшпиля" },
      { id: "lab", label: "Лаборатория позиций" },
      { id: "diagnostics", label: "Grandmaster 300" },
      { id: "systems", label: "Системы и диагностика" },
    ] },
    { id: "news", label: "Новости", icon: "news", landing: "news", items: [
      { id: "news", label: "Изменения CHESSMART" },
    ] },
    { id: "community", label: "Сообщество", icon: "community", landing: "profile", items: [
      { id: "profile", label: "Профиль игрока" },
      { id: "stats", label: "Статистика" },
      { id: "profileDetails", label: "Архив партий" },
    ] },
    { id: "other", label: "Ещё", icon: "more", landing: "settings", items: [
      { id: "settings", label: "Настройки" },
    ] },
  ];
  const currentNavMode: MainMode = mode === "home" ? "playHub" : mode;
  const currentNavGroup = sidebarGroups.find((group) => group.items.some((item) => item.id === currentNavMode))?.id ?? null;

  const mobileMoreNavigation: Array<{ id: MainMode; label: string; description: string }> = [
    { id: "online", label: "Играть по сети", description: "Живые партии и вызовы друзьям" },
    { id: "play", label: "Против бота", description: "Stockfish и уровни сложности" },
    { id: "battle", label: "Дуэль задач", description: "Соревнование на скорость и точность" },
    { id: "review", label: "Анализ партий", description: "Разбор ходов и несколько движков" },
    { id: "puzzles", label: "Библиотека задач", description: "Тактика и тематические подборки" },
    { id: "daily", label: "Ежедневная задача", description: "Короткая ежедневная тренировка" },
    { id: "lessons", label: "Учебный план", description: "Последовательное обучение" },
    { id: "academy", label: "Академия", description: "План тренировок" },
    { id: "coach", label: "Персональный тренер", description: "Подсказки и разбор ошибок" },
    { id: "openings", label: "Дебюты", description: "Дебютная база и планы" },
    { id: "mistakes", label: "Тренажёр ошибок", description: "Повторение сложных позиций" },
    { id: "endgame", label: "Эндшпиль", description: "Тренировка окончаний" },
    { id: "lab", label: "Лаборатория позиций", description: "Создание и анализ позиций" },
    { id: "profile", label: "Профиль", description: "Рейтинги и личный прогресс" },
    { id: "profileDetails", label: "Архив партий", description: "История и резервные копии" },
    { id: "stats", label: "Статистика", description: "Результаты и точность" },
    { id: "news", label: "Новости", description: "Изменения CHESSMART" },
    { id: "settings", label: "Настройки", description: "Доска, интерфейс и аккаунт" },
    { id: "systems", label: "Системы", description: "Диагностика инструментов" },
  ];

  return (
    <div className={sidebarCollapsed ? "cm-app-shell cm-sidebar-is-collapsed" : "cm-app-shell"}>
      <aside className="cm-sidebar">
        <button type="button" className="cm-brand" onClick={() => changeMode("playHub")} aria-label="CHESSMART — играть">
          <BrandMark /><span>CHESSMART</span>
        </button>

        <nav className="cm-sidebar-nav" aria-label="Главная навигация">
          {sidebarGroups.map((group) => {
            const expanded = expandedNav === group.id;
            const active = currentNavGroup === group.id;
            return (
              <div
                key={group.id}
                data-nav-id={group.id}
                className={expanded ? "cm-side-group cm-nav-group expanded" : "cm-side-group cm-nav-group"}
              >
                <button
                  type="button"
                  onClick={() => {
                    const shouldExpand = expandedNav !== group.id;
                    changeMode(group.landing);
                    setExpandedNav(shouldExpand ? group.id : null);
                  }}
                  aria-expanded={expanded}
                  aria-current={active ? "page" : undefined}
                  className={active ? "cm-side-item cm-nav-parent active" : "cm-side-item cm-nav-parent"}
                >
                  <span className="cm-side-icon"><SidebarIcon name={group.icon} /></span>
                  <span>{group.label}</span>
                  <span className="cm-side-chevron" aria-hidden="true">›</span>
                </button>
                <div className="cm-side-submenu cm-nav-submenu" aria-label={`Разделы: ${group.label}`}>
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={mode === item.id || (mode === "home" && item.id === "playHub") ? "active" : ""}
                      aria-current={mode === item.id ? "page" : undefined}
                      onClick={() => changeMode(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
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
        <button type="button" onClick={() => changeMode("playHub")} className={currentNavGroup === "play" ? "active" : ""}><span className="cm-mobile-nav-icon"><SidebarIcon name="play" /></span><span>Играть</span></button>
        <button type="button" onClick={() => changeMode("puzzles")} className={currentNavGroup === "puzzles" ? "active" : ""}><span className="cm-mobile-nav-icon"><SidebarIcon name="puzzle" /></span><span>Задачи</span></button>
        <button type="button" onClick={() => changeMode("lessons")} className={currentNavGroup === "learn" ? "active" : ""}><span className="cm-mobile-nav-icon"><SidebarIcon name="lessons" /></span><span>Учёба</span></button>
        <button type="button" onClick={() => changeMode("review")} className={currentNavGroup === "train" ? "active" : ""}><span className="cm-mobile-nav-icon"><SidebarIcon name="train" /></span><span>Тренировка</span></button>
        <button type="button" onClick={() => setMobileMore((open) => !open)} className={mobileMore ? "active" : ""} aria-expanded={mobileMore} aria-haspopup="dialog"><span className="cm-mobile-nav-icon"><SidebarIcon name="more" /></span><span>Ещё</span></button>
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
                <h2 id="cm-mobile-more-title">Разделы CHESSMART</h2>
                <p>Игры, обучение, анализ и профиль</p>
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