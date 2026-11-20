import { useCallback, useEffect, useRef, useState } from "react";
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
  type PlayerProfile,
} from "./lib/playerProfile";
import type { GameReview } from "./types";
import { ACCOUNT_PROFILE_EVENT, readAccountProfile, type AccountProfile } from "./lib/accountProfile";

type Stage = "import" | "analyzing" | "review";
type MainMode = "review" | "play" | "online" | "profile" | "puzzles" | "mistakes" | "coach" | "academy" | "endgame" | "openings" | "lab" | "diagnostics" | "systems";
type IconName = "analysis" | "play" | "online" | "puzzles" | "mistakes" | "coach" | "academy" | "endgame" | "openings" | "profile" | "lab" | "diagnostics" | "systems";

const NAV_ITEMS: Array<{ id: MainMode; label: string; group: string; icon: IconName }> = [
  { id: "review", label: "Анализ партий", group: "Играть", icon: "analysis" },
  { id: "play", label: "Против компьютера", group: "Играть", icon: "play" },
  { id: "online", label: "Играть онлайн", group: "Играть", icon: "online" },
  { id: "puzzles", label: "Тактические задачи", group: "Тренировка", icon: "puzzles" },
  { id: "mistakes", label: "Мои ошибки", group: "Тренировка", icon: "mistakes" },
  { id: "coach", label: "Personal Coach", group: "Тренировка", icon: "coach" },
  { id: "academy", label: "Академия и план", group: "Тренировка", icon: "academy" },
  { id: "endgame", label: "Эндшпиль", group: "Тренировка", icon: "endgame" },
  { id: "openings", label: "Дебютная база", group: "Изучать", icon: "openings" },
  { id: "profile", label: "Статистика", group: "Изучать", icon: "profile" },
  { id: "lab", label: "Лаборатория позиции", group: "Изучать", icon: "lab" },
  { id: "diagnostics", label: "Диагностика 300", group: "Изучать", icon: "diagnostics" },
  { id: "systems", label: "Центр систем", group: "Система", icon: "systems" },
];

function NavIcon({ name, active = false }: { name: IconName; active?: boolean }) {
  const stroke = active ? "#d9edc4" : "#9b9a93";
  const common = { fill: "none", stroke, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      {name === "analysis" && <><path {...common} d="M3 18V5M3 18h18" /><path {...common} d="m6 14 4-4 3 2 6-7" /><circle cx="19" cy="5" r="1.5" fill={stroke} /></>}
      {name === "play" && <><path {...common} d="M5 4.5h14v15H5z" /><path {...common} d="m10 8 6 4-6 4z" /></>}
      {name === "online" && <><circle {...common} cx="9" cy="8" r="3" /><path {...common} d="M3.5 19v-1.2A4.8 4.8 0 0 1 8.3 13h1.4a4.8 4.8 0 0 1 4.8 4.8V19" /><path {...common} d="M16 5.5a3 3 0 0 1 0 5.8M17 13.5a4.5 4.5 0 0 1 3.5 4.4V19" /></>}
      {name === "puzzles" && <><path {...common} d="M8 4h8v4a2 2 0 1 1 0 4v8H8v-4a2 2 0 1 0 0-4z" /></>}
      {name === "mistakes" && <><path {...common} d="M12 3 2.8 19h18.4L12 3Z" /><path {...common} d="M12 9v4.5M12 17h.01" /></>}
      {name === "coach" && <><path {...common} d="M12 3.5 14 8l4.9.6-3.6 3.3.9 4.8-4.2-2.4-4.2 2.4.9-4.8-3.6-3.3L11 8z" /><path {...common} d="M6 20h12M8 17.5V20m8-2.5V20" /></>}
      {name === "academy" && <><path {...common} d="m3 8 9-4 9 4-9 4-9-4Z" /><path {...common} d="M7 10v5c3.2 2.5 6.8 2.5 10 0v-5M21 8v7" /><path {...common} d="M5 19h14" /></>}
      {name === "endgame" && <><path {...common} d="M4 20h16M6 20V8l6-4 6 4v12" /><path {...common} d="M9 11h6M9 15h6" /></>}
      {name === "openings" && <><path {...common} d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" /></>}
      {name === "profile" && <><circle {...common} cx="12" cy="8" r="3.2" /><path {...common} d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>}
      {name === "lab" && <><path {...common} d="m14.5 6.5 3-3 3 3-3 3" /><path {...common} d="m3 21 8-8M12 5a5 5 0 0 0 7 7L10 21l-7-7 4-4" /></>}
      {name === "diagnostics" && <><circle {...common} cx="12" cy="12" r="8.5" /><path {...common} d="M12 7v5l3.5 2M5.8 5.8l2 2M18.2 5.8l-2 2" /></>}
      {name === "systems" && <><path {...common} d="M4 7h16M4 12h16M4 17h16" /><circle cx="8" cy="7" r="2" fill="#20251e" stroke={stroke} strokeWidth="1.8" /><circle cx="15" cy="12" r="2" fill="#20251e" stroke={stroke} strokeWidth="1.8" /><circle cx="10" cy="17" r="2" fill="#20251e" stroke={stroke} strokeWidth="1.8" /></>}
    </svg>
  );
}

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

function Main() {
  const { engine, computeProfile } = useEngine();
  const [stage, setStage] = useState<Stage>("import");
  const [mode, setMode] = useState<MainMode>("review");
  const [progress, setProgress] = useState<AnalyzeProgress | null>(null);
  const [review, setReview] = useState<GameReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [profile, setProfile] = useState<PlayerProfile>(() => loadPlayerProfile());
  const [mobileMore, setMobileMore] = useState(false);
  const [accountProfile, setAccountProfile] = useState<AccountProfile | null>(() => readAccountProfile());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => savePlayerProfile(profile), [profile]);

  useEffect(() => {
    const applyPreferences = () => applySuitePreferences(loadSuiteSettings());
    applyPreferences();
    window.addEventListener("storage", applyPreferences);
    return () => window.removeEventListener("storage", applyPreferences);
  }, []);

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
    setStage("import");
    setError(null);
  }, []);

  if (stage === "analyzing") return <AnalyzingScreen progress={progress} onCancel={() => abortRef.current?.abort()} />;

  let page = null;
  if (mode === "play") page = engine
    ? <PlayScreen engine={engine} profile={profile} onFinished={setProfile} onBack={() => changeMode("review")} />
    : <EngineLoader />;
  else if (mode === "online") page = <OnlinePlayScreen onBack={() => changeMode("review")} />;
  else if (mode === "profile") page = <ProfileScreen profile={profile} onChange={setProfile} onBack={() => changeMode("review")} onOpenAccount={() => changeMode("online")} />;
  else if (mode === "puzzles") page = <PuzzleLibraryScreen profile={profile} onChange={setProfile} onBack={() => changeMode("review")} />;
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

  const activeItem = NAV_ITEMS.find((item) => item.id === mode) ?? NAV_ITEMS[0];
  const grouped = ["Играть", "Тренировка", "Изучать", "Система"];

  return (
    <div className="min-h-screen bg-[#1d211c] text-[#f0f2eb]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-white/[0.06] bg-[#191d18] shadow-[12px_0_40px_rgba(0,0,0,.12)] lg:flex">
        <div className="flex h-[82px] items-center gap-3.5 border-b border-white/[0.06] px-5">
          <BrandMark />
          <div><div className="text-[16px] font-black tracking-[0.04em] text-white">CHESSMART</div><div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-[#87917e]">Chess analysis studio</div></div>
        </div>
        <nav aria-label="Основная навигация" className="chess-scrollbar flex-1 overflow-y-auto px-3 py-6">
          {grouped.map((group) => (
            <div key={group} className="mb-7">
              <div className="mb-2.5 px-3 text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#788271]">{group}</div>
              <div className="space-y-1.5">
                {NAV_ITEMS.filter((item) => item.group === group).map((item) => {
                  const active = mode === item.id;
                  return (
                    <button key={item.id} onClick={() => changeMode(item.id)} aria-current={active ? "page" : undefined}
                      className={"group flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-[11px] font-bold transition-all " + (active ? "bg-gradient-to-r from-[#384a30] to-[#2c3827] text-[#e3f0d5] shadow-[inset_3px_0_0_#a5ce78,0_8px_22px_rgba(0,0,0,.12)] ring-1 ring-[#8eaf68]/15" : "text-[#a3ac9a] hover:bg-white/[0.045] hover:text-white")}>
                      <NavIcon name={item.icon} active={active} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-white/[0.06] p-4">
          <button type="button" onClick={() => changeMode("online")} aria-label={accountProfile ? "Открыть аккаунт " + accountProfile.username : "Открыть профиль игрока"}
            className="flex w-full items-center gap-3 rounded-2xl border border-white/[0.06] bg-gradient-to-br from-[#2b3327] to-[#22271f] p-3.5 text-left transition hover:border-[#8ca96b]/35 hover:from-[#303c2b]">
            {accountProfile?.avatar_url
              ? <img src={accountProfile.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-xl border border-[#8ca96b]/25 object-cover shadow-inner" />
              : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#8ca96b]/25 bg-[#526d3e] text-sm font-black text-white shadow-inner">{(accountProfile?.username ?? profile.name).slice(0, 1).toUpperCase()}</div>}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-bold text-white">{accountProfile?.username ?? profile.name}</div>
              <div className="text-[10px] text-[#96968d]">{accountProfile ? "Аккаунт CHESSMART" : "Локальный профиль · " + profile.rating + " Elo"}</div>
            </div>
            <span className="text-[#849078]" aria-hidden="true">›</span>
          </button>
          <div className="mt-4 flex items-center justify-center gap-2 text-[9px] font-bold uppercase tracking-[0.16em] text-[#687362]"><span className="h-1 w-1 rounded-full bg-[#90b96a]" />Independent chess toolkit</div>
        </div>
      </aside>

      <div className="min-h-screen lg:pl-[248px]">
        <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#1d211c]/90 px-4 py-3.5 backdrop-blur-2xl sm:px-7">
          <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="lg:hidden"><BrandMark /></div>
              <div><div className="text-sm font-extrabold tracking-tight text-white">{activeItem.label}</div><div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-[#849078]">Chessmart <span className="mx-1 text-[#59634f]">/</span> {activeItem.group}</div></div>
            </div>
            <div className="hidden items-center gap-3 sm:flex">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.035] px-3.5 py-2 text-right"><div className="text-[9px] font-bold uppercase tracking-[0.13em] text-[#7f8c73]">Локальный рейтинг</div><div className="mt-0.5 text-sm font-black tabular-nums text-[#d9edc4]">{profile.rating} <span className="text-[9px] font-bold text-[#89977c]">ELO</span></div></div>
              <div className="h-8 w-px bg-white/[0.08]" />
              {accountProfile?.avatar_url
                ? <img src={accountProfile.avatar_url} alt="" className="h-10 w-10 rounded-xl border border-[#596b49] object-cover shadow-[0_4px_14px_rgba(0,0,0,.18)]" />
                : <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#596b49] bg-[#34442c] text-sm font-black text-[#e3f0d5] shadow-[0_4px_14px_rgba(0,0,0,.18)]">{(accountProfile?.username ?? profile.name).slice(0, 1).toUpperCase()}</div>}
            </div>
          </div>
        </header>

        <nav aria-label="Навигация" className="hidden lg:hidden">
          {NAV_ITEMS.map((item) => <button key={item.id} onClick={() => changeMode(item.id)}>{item.label}</button>)}
        </nav>
        <main className="min-h-[calc(100vh-64px)] bg-[#1d211c] mobile-app-main">{page}</main>
        <nav aria-label="Мобильная навигация" className="mobile-bottom-nav lg:hidden">
          {(["review", "play", "online", "profile"] as MainMode[]).map((id) => {
            const item = NAV_ITEMS.find((entry) => entry.id === id)!;
            const active = mode === id;
            return <button key={id} onClick={() => changeMode(id)} aria-current={active ? "page" : undefined} className={active ? "mobile-nav-item active" : "mobile-nav-item"}>
              <NavIcon name={item.icon} active={active} /><span>{id === "review" ? "Анализ" : id === "profile" ? "Профиль" : id === "online" ? "Онлайн" : "Играть"}</span>
            </button>;
          })}
          <div className="mobile-more-wrap">
            <button type="button" onClick={() => setMobileMore((open) => !open)} aria-expanded={mobileMore} className={mobileMore ? "mobile-nav-item active" : "mobile-nav-item"}>
              <span className="mobile-more-dots">•••</span><span>Ещё</span>
            </button>
            {mobileMore && <div className="mobile-more-menu">
              {NAV_ITEMS.filter((item) => !(["review", "play", "online", "profile"] as MainMode[]).includes(item.id)).map((item) => (
                <button key={item.id} onClick={() => { changeMode(item.id); setMobileMore(false); }} className="mobile-more-option">
                  <NavIcon name={item.icon} /><span>{item.label}</span>
                </button>
              ))}
            </div>}
          </div>
        </nav>
      </div>
    </div>
  );
}

export default function App() {
  return <EngineProvider><Main /></EngineProvider>;
}