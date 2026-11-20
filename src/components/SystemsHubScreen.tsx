import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { PlayerProfile } from "../lib/playerProfile";
import { buildTrainingRecommendations, type AcademyDestination } from "../lib/trainingAcademy";
import {
  applySuitePreferences,
  buildSuiteDashboard,
  buildSuiteShortcutMap,
  checkOnlineServices,
  claimQuestReward,
  clearAnalysisStorage,
  clearDownloadedEngineStorage,
  formatSignedPercent,
  formatSuiteBytes,
  formatSuiteDuration,
  getConnectionQuality,
  getNetworkLatencyLabel,
  getNetworkSummary,
  getQuestCompletionPercent,
  getQuestLevel,
  getStorageDiagnostics,
  getStorageHealthLabel,
  getSuiteDashboardGreeting,
  getSuiteLevelTitle,
  getQuestDestinationLabel,
  getRecommendedAnalysisDepth,
  getPerformanceLabel,
  loadSuiteSettings,
  saveSuiteSettings,
  updateSuitePreference,
  type EndpointHealth,
  type NetworkDiagnostics,
  type StorageDiagnostics,
  type SuitePreferenceKey,
  type SuiteQuest,
  type SuiteSettings,
} from "../lib/systemsSuite";

type HubTab = "overview" | "analysis" | "quests" | "cache" | "network" | "settings";
type HubDestination = AcademyDestination | "play" | "online" | "profile";

const TABS: Array<{ id: HubTab; label: string }> = [
  { id: "overview", label: "Обзор" },
  { id: "analysis", label: "Аналитика" },
  { id: "quests", label: "Миссии" },
  { id: "cache", label: "Кэш" },
  { id: "network", label: "Онлайн" },
  { id: "settings", label: "Интерфейс" },
];

function Panel({ title, eyebrow, children, className = "" }: { title: string; eyebrow?: string; children: ReactNode; className?: string }) {
  return (
    <section className={"rounded-2xl border border-[#3d4937] bg-[#252b23] p-4 sm:p-5 " + className}>
      {eyebrow && <div className="mb-1 text-[9px] font-black uppercase tracking-[0.18em] text-[#8ca27b]">{eyebrow}</div>}
      <h2 className="text-lg font-black text-white">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Metric({ label, value, detail, tone = "text-[#d9edc4]" }: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.055] bg-black/10 p-3.5">
      <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#899482]">{label}</div>
      <div className={"mt-1.5 text-2xl font-black tabular-nums " + tone}>{value}</div>
      <div className="mt-1 text-[10px] leading-relaxed text-[#929b8c]">{detail}</div>
    </div>
  );
}

function ActionButton({ children, onClick, disabled = false, secondary = false }: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={"rounded-xl px-3.5 py-2.5 text-xs font-extrabold transition disabled:cursor-not-allowed disabled:opacity-40 " + (secondary
        ? "border border-[#59664f] bg-[#30392a] text-[#d6e4c9] hover:bg-[#3a4631]"
        : "bg-[#91bd69] text-[#172113] hover:bg-[#a5ce7f]")}
    >
      {children}
    </button>
  );
}

function QuestCard({ quest, onClaim, onOpen }: {
  quest: SuiteQuest;
  onClaim: (quest: SuiteQuest) => void;
  onOpen: (destination: HubDestination) => void;
}) {
  const percent = Math.min(100, Math.round(quest.progress / quest.target * 100));
  const destination = quest.destination;
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/10 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-extrabold text-[#edf1e8]">{quest.title}</div>
          <p className="mt-1 text-[10px] leading-relaxed text-[#96a08f]">{quest.description}</p>
        </div>
        <div className="rounded-lg bg-[#38472f] px-2 py-1 text-[9px] font-black text-[#c9e2b1]">+{quest.xp} XP</div>
      </div>
      <div className="mt-3 flex items-center justify-between text-[10px] text-[#9ca792]">
        <span>{quest.progress}/{quest.target}</span>
        <span>{quest.completed ? quest.claimed ? "Награда получена" : "Готово к получению" : percent + "%"}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#171c15]">
        <div className="h-full rounded-full bg-[#95c76b] transition-all" style={{ width: percent + "%" }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {quest.completed && !quest.claimed
          ? <ActionButton onClick={() => onClaim(quest)}>Забрать XP</ActionButton>
          : <ActionButton secondary disabled={quest.claimed} onClick={() => onOpen(destination)}>Перейти: {getQuestDestinationLabel(destination)}</ActionButton>}
        {quest.completed && quest.claimed && <span className="self-center text-[10px] font-bold text-[#a8c98d]">Выполнено</span>}
      </div>
    </div>
  );
}

function EndpointRow({ endpoint }: { endpoint: EndpointHealth }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.055] bg-black/10 px-3.5 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={"h-2.5 w-2.5 shrink-0 rounded-full " + (endpoint.ok ? "bg-[#9bc777]" : "bg-[#d27a6e]")} />
        <div className="min-w-0">
          <div className="text-xs font-extrabold text-[#e4eadf]">{endpoint.label}</div>
          <div className="mt-0.5 text-[10px] text-[#909b87]">{endpoint.detail}</div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-xs font-black tabular-nums text-[#d5e7c4]">{endpoint.latencyMs === null ? "—" : endpoint.latencyMs + " мс"}</div>
        <div className="text-[9px] text-[#88937e]">{getNetworkLatencyLabel(endpoint.latencyMs)}</div>
      </div>
    </div>
  );
}

export function SystemsHubScreen({ profile, onBack, onNavigate }: {
  profile: PlayerProfile;
  onBack: () => void;
  onNavigate: (destination: HubDestination) => void;
}) {
  const [tab, setTab] = useState<HubTab>("overview");
  const [settings, setSettings] = useState<SuiteSettings>(loadSuiteSettings);
  const [storage, setStorage] = useState<StorageDiagnostics | null>(null);
  const [network, setNetwork] = useState<NetworkDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const dashboard = useMemo(() => buildSuiteDashboard(profile, Date.now(), settings), [profile, settings]);
  const nextRecommendation = useMemo(() => buildTrainingRecommendations(profile)[0] ?? null, [profile]);
  const level = useMemo(() => getQuestLevel(settings.totalXp), [settings.totalXp]);

  useEffect(() => {
    saveSuiteSettings(settings);
    applySuitePreferences(settings);
  }, [settings]);

  useEffect(() => {
    let alive = true;
    void getStorageDiagnostics().then((result) => { if (alive) setStorage(result); });
    return () => { alive = false; };
  }, []);

  const refreshStorage = async () => {
    setBusy(true);
    try {
      setStorage(await getStorageDiagnostics());
      setNotice("Состояние хранилища обновлено.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось проверить хранилище.");
    } finally {
      setBusy(false);
    }
  };

  const clearPositions = async () => {
    if (!window.confirm("Удалить только кэш оценок позиций? Сохранённые партии и аккаунт не затронутся.")) return;
    setBusy(true);
    try {
      await clearAnalysisStorage();
      setStorage(await getStorageDiagnostics());
      setNotice("Кэш оценок позиций очищен. При следующем анализе оценки будут рассчитаны заново.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось очистить кэш позиций.");
    } finally {
      setBusy(false);
    }
  };

  const clearEngineFiles = async () => {
    if (!window.confirm("Удалить загруженные файлы Stockfish из локального кэша? При следующем запуске их придётся скачать заново.")) return;
    setBusy(true);
    try {
      await clearDownloadedEngineStorage();
      setStorage(await getStorageDiagnostics());
      setNotice("Файлы движка удалены из кэша браузера. Запущенный сейчас движок продолжит работать до перезагрузки.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось очистить файлы движка.");
    } finally {
      setBusy(false);
    }
  };

  const runNetworkCheck = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await checkOnlineServices(
        (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "",
      );
      setNetwork(result);
      setNotice(getNetworkSummary(result));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Проверка соединения не удалась.");
    } finally {
      setBusy(false);
    }
  };

  const handleClaim = (quest: SuiteQuest) => {
    const result = claimQuestReward(settings, quest);
    if (!result.granted) return;
    setSettings(result.settings);
    setNotice("Получено +" + quest.xp + " XP за задание «" + quest.title + "».");
  };

  const updatePreference = (key: SuitePreferenceKey, value: boolean) => {
    setSettings((current) => updateSuitePreference(current, key, value));
  };

  const openDestination = (destination: HubDestination) => onNavigate(destination);

  const weakest = dashboard.metrics.weakestPhase;
  const accuracyChange = dashboard.metrics.accuracyChange;
  const averagePlies = profile.reviews.length
    ? profile.reviews.reduce((sum, item) => sum + item.plies, 0) / profile.reviews.length
    : 0;
  const recommendedDepth = getRecommendedAnalysisDepth(profile.rating, averagePlies);

  return (
    <main className={"systems-hub min-h-screen bg-[#20251e] p-3 text-[#f0f2eb] sm:p-6 " + (settings.compactMode ? "systems-hub-compact " : "") + (settings.reducedMotion ? "systems-hub-reduced-motion" : "")}>
      <div className="mx-auto max-w-7xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-md border border-[#617c4d] bg-[#34442c] px-2 py-1 text-[9px] font-black uppercase tracking-[0.15em] text-[#d9edc4]">Systems Hub · 7 modules</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#78836f]">CHESSMART</span>
            </div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{getSuiteDashboardGreeting()}</h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[#9da795]">Аналитика, миссии, локальное хранилище, интерфейс и диагностика сетевых служб — в одном месте.</p>
          </div>
          <button type="button" onClick={onBack} className="rounded-xl border border-[#46523d] bg-[#2a3026] px-4 py-2.5 text-xs font-bold text-[#dce6d1] hover:bg-[#343d2e]">← Назад</button>
        </header>

        <div className="mb-5 flex flex-wrap gap-1.5 rounded-xl border border-white/[0.06] bg-[#191e18] p-1.5">
          {TABS.map((item) => (
            <button key={item.id} type="button" onClick={() => setTab(item.id)} aria-pressed={tab === item.id}
              className={"rounded-lg px-3 py-2 text-[11px] font-extrabold transition " + (tab === item.id ? "bg-[#405336] text-[#e1efd4]" : "text-[#9ba592] hover:bg-white/[0.05] hover:text-white")}>
              {item.label}
            </button>
          ))}
        </div>

        {notice && <div role="status" className="mb-4 rounded-xl border border-[#5c744a] bg-[#2d3b27] px-3.5 py-2.5 text-xs text-[#d3e8c0]">{notice}</div>}

        {tab === "overview" && (
          <>
            <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Локальный рейтинг" value={profile.rating + " Elo"} detail={"Пик: " + dashboard.metrics.peakRating + " Elo"} />
              <Metric label="Точность разборов" value={dashboard.metrics.averageAccuracy === null ? "—" : dashboard.metrics.averageAccuracy.toFixed(1) + "%"} detail={dashboard.metrics.recentAccuracy === null ? "Нужно больше разборов" : "Последние партии: " + dashboard.metrics.recentAccuracy.toFixed(1) + "%"} />
              <Metric label="Победы против бота" value={dashboard.metrics.winRate.toFixed(1) + "%"} detail={dashboard.metrics.games + " партий · " + (dashboard.metrics.currentForm.join(" ") || "нет истории") } tone="text-[#c5dfaa]" />
              <Metric label="Учебные задачи" value={String(dashboard.metrics.solvedPuzzleCount)} detail={dashboard.metrics.puzzleBacklog + " сохранённых ошибок ждут повтора"} tone="text-[#a6d6d0]" />
            </section>

            <section className="mb-4 grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
              <Panel title="Уровень игрока" eyebrow="Система опыта">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="text-4xl font-black text-[#cde5b6]">Ур. {level.level}</div>
                    <div className="mt-1 text-xs font-bold text-[#a5b29a]">{getSuiteLevelTitle(level.level)}</div>
                  </div>
                  <div className="text-right text-xs text-[#98a38f]">{settings.totalXp.toLocaleString("ru-RU")} XP всего</div>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#161b14]">
                  <div className="h-full rounded-full bg-[#9bc876]" style={{ width: level.progressPercent + "%" }} />
                </div>
                <div className="mt-2 flex justify-between text-[10px] text-[#8b9781]"><span>{level.currentXp} XP на уровне</span><span>Следующий: {level.nextLevelXp} XP</span></div>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg bg-black/10 p-3"><div className="text-[9px] text-[#88947f]">Миссии сегодня</div><div className="mt-1 text-lg font-black text-white">{dashboard.quests.daily.filter((quest) => quest.completed).length}/{dashboard.quests.daily.length}</div></div>
                  <div className="rounded-lg bg-black/10 p-3"><div className="text-[9px] text-[#88947f]">За неделю</div><div className="mt-1 text-lg font-black text-white">{dashboard.quests.weekly.filter((quest) => quest.completed).length}/{dashboard.quests.weekly.length}</div></div>
                  <div className="rounded-lg bg-black/10 p-3"><div className="text-[9px] text-[#88947f]">Можно забрать</div><div className="mt-1 text-lg font-black text-[#cde5b6]">+{dashboard.quests.claimableXp} XP</div></div>
                </div>
                <ActionButton secondary onClick={() => setTab("quests")}>Открыть все миссии</ActionButton>
              </Panel>
              <Panel title="Следующий шаг" eyebrow="Персональная подсказка">
                <p className="text-sm leading-relaxed text-[#dce6d3]">{nextRecommendation?.reason ?? dashboard.nextStep}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <ActionButton onClick={() => openDestination(nextRecommendation?.destination ?? "review")}>{nextRecommendation ? "Начать · " + nextRecommendation.durationMinutes + " мин." : "Начать анализ"}</ActionButton>
                  <ActionButton secondary onClick={() => setTab("analysis")}>Подробнее</ActionButton>
                </div>
                <div className="mt-5 border-t border-white/[0.06] pt-4">
                  <div className="text-[9px] font-bold uppercase tracking-wide text-[#839079]">Состояние локального кэша</div>
                  <div className="mt-1 text-xl font-black text-[#e0ead6]">{storage ? storage.positionEntries.toLocaleString("ru-RU") + " позиций" : "Проверяем…"}</div>
                  <button type="button" onClick={() => setTab("cache")} className="mt-1 text-[10px] font-bold text-[#b7d89b] hover:text-white">Управление хранилищем →</button>
                </div>
              </Panel>
            </section>

            <Panel title="Миссии дня" eyebrow="Реальный прогресс из профиля" className="mb-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-xs text-[#9ca792]">Завершено {dashboard.quests.completed} из {dashboard.quests.total} заданий</div>
                <div className="text-sm font-black tabular-nums text-[#cde5b6]">{getQuestCompletionPercent(dashboard.quests)}%</div>
              </div>
              <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-[#171c15]"><div className="h-full rounded-full bg-[#95c76b]" style={{ width: getQuestCompletionPercent(dashboard.quests) + "%" }} /></div>
              <div className="grid gap-3 md:grid-cols-2">
                {dashboard.quests.daily.slice(0, 4).map((quest) => <QuestCard key={quest.id} quest={quest} onClaim={handleClaim} onOpen={openDestination} />)}
              </div>
            </Panel>
          </>
        )}

        {tab === "analysis" && (
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Динамика точности" eyebrow="Последние 10 разборов">
              {dashboard.reviewTrend.length ? (
                <>
                  <div className="flex h-36 items-end gap-2 border-b border-white/[0.08] pb-2">
                    {dashboard.reviewTrend.map((point, index) => (
                      <div key={point.at + ":" + index} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                        <div className="w-full rounded-t-md bg-[#84ac61]" title={point.accuracy.toFixed(1) + "%"} style={{ height: Math.max(4, point.accuracy) + "%" }} />
                        <span className="text-[8px] text-[#86917c]">{point.accuracy.toFixed(0)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-[10px] text-[#85917d]">По сохранённым обзорам; это история точности, не прогноз рейтинга.</div>
                </>
              ) : <p className="text-xs leading-relaxed text-[#9aa38f]">График появится после первых разборов партий.</p>}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Metric label="Средняя точность" value={dashboard.metrics.averageAccuracy === null ? "—" : dashboard.metrics.averageAccuracy.toFixed(1) + "%"} detail={getPerformanceLabel(dashboard.metrics.averageAccuracy)} />
                <Metric label="Изменение" value={formatSignedPercent(dashboard.metrics.accuracyChange)} detail="Последние 5 против предыдущих 5" tone={accuracyChange !== null && accuracyChange >= 0 ? "text-[#bfe19c]" : "text-[#e3a38e]"} />
              </div>
              <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/10 p-3 text-[10px] leading-relaxed text-[#a4b098]">Для следующих разборов ориентир по глубине — <b className="text-[#d9edc4]">{recommendedDepth}</b>. Это рекомендация по рейтингу и средней длине партий, а не изменение настроек Stockfish автоматически.</div>
            </Panel>
            <Panel title="Сильные и слабые зоны" eyebrow="По стадиям партии">
              {weakest ? (
                <div className="rounded-xl border border-[#7b6344]/40 bg-[#332c20] p-3">
                  <div className="text-[9px] font-black uppercase tracking-wide text-[#d7b47f]">Зона роста</div>
                  <div className="mt-1 text-lg font-black text-white">{weakest.phase === "opening" ? "Дебют" : weakest.phase === "middlegame" ? "Миттельшпиль" : "Эндшпиль"}</div>
                  <div className="mt-1 text-xs text-[#c8b99e]">{weakest.accuracy.toFixed(1)}% на {weakest.moves} ходах</div>
                </div>
              ) : <p className="text-xs text-[#9aa38f]">Нужно не менее пяти оценённых ходов на стадию для устойчивого вывода.</p>}
              <div className="mt-4 space-y-2 text-xs text-[#bdc8b4]">
                <div className="flex justify-between"><span>Победы против бота</span><b>{dashboard.metrics.winRate.toFixed(1)}%</b></div>
                <div className="flex justify-between"><span>Ничьи</span><b>{dashboard.metrics.drawRate.toFixed(1)}%</b></div>
                <div className="flex justify-between"><span>Поражения</span><b>{dashboard.metrics.lossRate.toFixed(1)}%</b></div>
                <div className="flex justify-between"><span>Решаемость задач</span><b>{dashboard.metrics.puzzleSolveRate === null ? "—" : dashboard.metrics.puzzleSolveRate.toFixed(1) + "%"}</b></div>
                <div className="flex justify-between"><span>Разброс рейтинга</span><b>{Math.round(dashboard.metrics.ratingChange) >= 0 ? "+" : ""}{Math.round(dashboard.metrics.ratingChange)} Elo</b></div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <ActionButton onClick={() => openDestination("mistakes")}>Повторить ошибки</ActionButton>
                <ActionButton secondary onClick={() => openDestination("review")}>Новый анализ</ActionButton>
              </div>
            </Panel>
            <Panel title="Практика" eyebrow="Накопленная работа">
              <div className="grid gap-2 sm:grid-cols-3">
                <Metric label="Сессии" value={String(dashboard.metrics.trainingSessions)} detail="Записано тренировок" />
                <Metric label="Время" value={formatSuiteDuration(dashboard.metrics.trainingMinutes)} detail="Суммарное время занятий" />
                <Metric label="Решено" value={String(dashboard.metrics.solvedPuzzleCount)} detail="Разные решённые позиции" />
              </div>
            </Panel>
            <Panel title="Форма последних партий" eyebrow="Результаты против бота">
              {dashboard.metrics.currentForm.length
                ? <div className="flex flex-wrap gap-2">{dashboard.metrics.currentForm.map((result, index) => <span key={index} className={"flex h-10 w-10 items-center justify-center rounded-lg text-sm font-black " + (result === "W" ? "bg-[#304c2a] text-[#c9e5ae]" : result === "D" ? "bg-[#51462e] text-[#e2ce9e]" : "bg-[#4c2d2a] text-[#edb0a6]")}>{result}</span>)}</div>
                : <p className="text-xs text-[#9aa38f]">Сыграй первую партию против компьютера — здесь появится форма.</p>}
            </Panel>
          </div>
        )}

        {tab === "quests" && (
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Ежедневные миссии" eyebrow={"Сегодня · " + dashboard.quests.dayKey}>
              <div className="space-y-3">{dashboard.quests.daily.map((quest) => <QuestCard key={quest.id} quest={quest} onClaim={handleClaim} onOpen={openDestination} />)}</div>
            </Panel>
            <Panel title="Недельные миссии" eyebrow={"Неделя с " + dashboard.quests.weekKey}>
              <div className="space-y-3">{dashboard.quests.weekly.map((quest) => <QuestCard key={quest.id} quest={quest} onClaim={handleClaim} onOpen={openDestination} />)}</div>
            </Panel>
            <Panel title="Твои награды" eyebrow="XP и уровень" className="xl:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><div className="text-3xl font-black text-[#cde5b6]">{settings.totalXp.toLocaleString("ru-RU")} XP</div><div className="mt-1 text-xs text-[#9ca792]">Уровень {level.level} · {getSuiteLevelTitle(level.level)}</div></div>
                <div className="w-full max-w-sm"><div className="mb-1 flex justify-between text-[10px] text-[#8f9b84]"><span>{level.currentXp} XP</span><span>{level.nextLevelXp} XP до следующего уровня</span></div><div className="h-2 overflow-hidden rounded-full bg-[#171c15]"><div className="h-full rounded-full bg-[#9bc876]" style={{ width: level.progressPercent + "%" }} /></div></div>
              </div>
            </Panel>
          </div>
        )}

        {tab === "cache" && (
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Диагностика хранилища" eyebrow="Локальные данные">
              {storage ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Metric label="Позиции в кэше" value={storage.positionEntries.toLocaleString("ru-RU")} detail="Сохранённые оценки Stockfish" />
                  <Metric label="Файлы движка" value={String(storage.engineFiles)} detail="JS/WASM в Cache API" />
                  <Metric label="Использовано" value={formatSuiteBytes(storage.usageBytes)} detail={storage.quotaBytes === null ? "Квота браузера неизвестна" : "Из " + formatSuiteBytes(storage.quotaBytes)} />
                  <Metric label="Заполнение" value={storage.usagePercent === null ? "—" : storage.usagePercent.toFixed(1) + "%"} detail={getStorageHealthLabel(storage.health)} tone={storage.health === "critical" ? "text-[#e5a196]" : storage.health === "watch" ? "text-[#e2c58e]" : "text-[#cde5b6]"} />
                </div>
              ) : <p className="text-xs text-[#9aa38f]">Получаем данные браузера…</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <ActionButton secondary disabled={busy} onClick={() => void refreshStorage()}>{busy ? "Проверяю…" : "Обновить показатели"}</ActionButton>
                <ActionButton disabled={busy || !storage?.positionEntries} onClick={() => void clearPositions()}>Очистить оценки</ActionButton>
                <ActionButton secondary disabled={busy || !storage?.engineFiles} onClick={() => void clearEngineFiles()}>Удалить файлы Stockfish</ActionButton>
              </div>
              <p className="mt-3 text-[10px] leading-relaxed text-[#86917f]">Очистка оценок не удаляет партии, профиль или задачи. Удаление файлов Stockfish приведёт к повторной загрузке движка при следующем запуске.</p>
            </Panel>
            <Panel title="Что хранится локально" eyebrow="Безопасность данных">
              <div className="space-y-3 text-xs leading-relaxed text-[#b5c0aa]">
                <div><b className="text-[#e4eadf]">Позиции:</b> оценки Stockfish и варианты поиска для ускорения повторного анализа.</div>
                <div><b className="text-[#e4eadf]">Движок:</b> файлы JS/WASM официальной сборки Stockfish 19.0.1.</div>
                <div><b className="text-[#e4eadf]">Профиль:</b> локальные результаты, тренировки и учебные ошибки; резервную копию можно сделать в разделе «Статистика».</div>
                <div><b className="text-[#e4eadf]">Настройки:</b> плотность интерфейса, анимация, звуки и XP миссий.</div>
              </div>
              <div className="mt-4 rounded-lg border border-[#526c43] bg-[#2d3a27] p-3 text-[10px] leading-relaxed text-[#c8dfb6]">CHESSMART не удаляет профиль или облачные партии через кнопки очистки кэша на этой странице.</div>
            </Panel>
          </div>
        )}

        {tab === "network" && (
          <div className="grid gap-4 xl:grid-cols-[1fr_.8fr]">
            <Panel title="Проверка соединения" eyebrow="Доступность сервисов">
              <div className="mb-3 text-xs leading-relaxed text-[#9da795]">Проверяется сайт и доступность HTTP-точки онлайн-игры. Это тест доступности сервера, а не проверка авторизации или качества конкретной партии.</div>
              {network ? (
                <>
                  <div className="mb-3 rounded-xl border border-white/[0.06] bg-black/10 p-3">
                    <div className="text-[9px] font-bold uppercase tracking-wide text-[#839079]">Результат</div>
                    <div className={"mt-1 text-sm font-black " + (network.online ? "text-[#cde5b6]" : "text-[#e5a196]")}>{getNetworkSummary(network)}</div>
                    <div className="mt-1 text-[10px] text-[#8c9883]">Проверено: {new Date(network.checkedAt).toLocaleTimeString("ru-RU")}</div>
                  </div>
                  <div className="space-y-2">{network.endpoints.map((endpoint) => <EndpointRow key={endpoint.id} endpoint={endpoint} />)}</div>
                </>
              ) : <div className="rounded-xl border border-dashed border-[#526148] p-5 text-center text-xs text-[#9da795]">Запусти проверку — увидишь время ответа сайта и API онлайн-игры.</div>}
              <div className="mt-4 flex flex-wrap gap-2">
                <ActionButton disabled={busy} onClick={() => void runNetworkCheck()}>{busy ? "Проверяю…" : "Проверить соединение"}</ActionButton>
                <ActionButton secondary onClick={() => openDestination("online")}>Открыть онлайн-комнаты</ActionButton>
                <ActionButton secondary onClick={() => openDestination("play")}>Играть против бота</ActionButton>
              </div>
            </Panel>
            <Panel title="Стратегия повторных запросов" eyebrow="Стабильность онлайн-игры">
              <div className="space-y-3 text-xs leading-relaxed text-[#b5c0aa]">
                <div>Временные ошибки сети и HTTP 5xx отличаются от отказов авторизации и некорректных ходов.</div>
                <div>Проверка использует ограничение времени ответа, чтобы интерфейс не зависал при недоступной сети.</div>
                <div>Очередь поиска соперника, таймеры, ход и рейтинг остаются под контролем серверной логики онлайн-игры.</div>
              </div>
              <div className="mt-4 rounded-lg bg-black/10 p-3 text-[10px] text-[#87937f]">Сводка качества: {network?.endpoints.length ? getConnectionQuality(network.endpoints.find((item) => item.id === "online-api")?.latencyMs ?? null, network.online) : "проверка не запускалась"}.</div>
            </Panel>
          </div>
        )}

        {tab === "settings" && (
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Настройки интерфейса" eyebrow="Сохраняются в этом браузере">
              <div className="space-y-3">
                {([
                  ["compactMode", "Компактный режим", "Уплотняет отступы и карточки на панели Systems Hub."],
                  ["reducedMotion", "Уменьшить анимацию", "Сокращает анимационные эффекты интерфейса."],
                  ["largeText", "Увеличенный текст", "Увеличивает читаемость текста в центре систем."],
                ] as Array<[SuitePreferenceKey, string, string]>).map(([key, title, detail]) => (
                  <label key={key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.06] bg-black/10 p-3.5">
                    <input type="checkbox" checked={settings[key]} onChange={(event) => updatePreference(key, event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#91bd69]" />
                    <span className="min-w-0 flex-1"><span className="block text-xs font-extrabold text-[#e2e9dc]">{title}</span><span className="mt-1 block text-[10px] leading-relaxed text-[#929d8c]">{detail}</span></span>
                  </label>
                ))}
              </div>
            </Panel>
            <Panel title="Горячие клавиши" eyebrow="Навигация по обзору">
              <div className="space-y-2">
                {buildSuiteShortcutMap().map((item) => (
                  <div key={item.key} className="flex items-center justify-between gap-3 rounded-lg bg-black/10 px-3 py-2.5">
                    <kbd className="min-w-20 rounded bg-[#3b4633] px-2 py-1 text-center font-mono text-[10px] font-bold text-[#cde5b6]">{item.key}</kbd>
                    <span className="text-right text-[10px] text-[#a2ad97]">{item.action}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-lg border border-white/[0.06] bg-black/10 p-3 text-[10px] text-[#909b87]">Настройки интерфейса и XP миссий хранятся локально. Они не меняют силу Stockfish и онлайн-рейтинг.</div>
            </Panel>
          </div>
        )}
        <footer className="mt-6 border-t border-white/[0.06] pt-4 text-[9px] leading-relaxed text-[#6f7b68]">
          Systems Hub · показатели построены на доступной локальной статистике; онлайн-диагностика проверяет HTTP-доступность, но не гарантирует наличие соперников.
        </footer>
      </div>
    </main>
  );
}
