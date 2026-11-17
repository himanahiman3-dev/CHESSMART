import { useEffect, useMemo, useState } from "react";
import type { PlayerProfile } from "../lib/playerProfile";
import {
  buildAcademyDashboard,
  parseAcademySettings,
  serializeAcademySettings,
  type AcademyDestination,
  type AcademySettings,
} from "../lib/trainingAcademy";

const SETTINGS_KEY = "chessmart:training-academy:v1";

function loadSettings(): AcademySettings {
  try {
    return parseAcademySettings(localStorage.getItem(SETTINGS_KEY));
  } catch {
    return parseAcademySettings(null);
  }
}

function saveSettings(settings: AcademySettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, serializeAcademySettings(settings));
  } catch {
    // A private browser session must not interrupt training.
  }
}

function dayLabel(key: string): string {
  const date = new Date(key + "T12:00:00");
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function StatCard({ label, value, detail, accent = "text-white" }: { label: string; value: string; detail: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-[#3d4537] bg-[#252a22] p-4">
      <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#87917e]">{label}</div>
      <div className={"mt-2 text-3xl font-black tabular-nums " + accent}>{value}</div>
      <div className="mt-1 text-[11px] leading-relaxed text-[#92998b]">{detail}</div>
    </div>
  );
}

function DestinationButton({ destination, onNavigate, children }: { destination: AcademyDestination; onNavigate: (destination: AcademyDestination) => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={() => onNavigate(destination)} className="rounded-lg border border-[#596b49] bg-[#34442c] px-3 py-2 text-xs font-extrabold text-[#e1ebd7] transition hover:bg-[#415438]">
      {children}
    </button>
  );
}

export function TrainingAcademyScreen({ profile, onBack, onNavigate }: {
  profile: PlayerProfile;
  onBack: () => void;
  onNavigate: (destination: AcademyDestination) => void;
}) {
  const [settings, setSettings] = useState<AcademySettings>(loadSettings);
  const dashboard = useMemo(() => buildAcademyDashboard(profile, Date.now(), settings), [profile, settings]);

  useEffect(() => saveSettings(settings), [settings]);

  const completedCount = dashboard.tasks.filter((task) =>
    settings.completedTaskKeys.includes(dashboard.todayKey + ":" + task.id),
  ).length;
  const completedPercent = dashboard.tasks.length ? Math.round(completedCount / dashboard.tasks.length * 100) : 0;
  const maxActivity = Math.max(1, ...dashboard.activity.map((day) => day.total));
  const unlockedAchievements = dashboard.achievements.filter((item) => item.unlocked).length;

  const toggleTask = (id: string) => {
    const key = dashboard.todayKey + ":" + id;
    setSettings((current) => {
      const completed = current.completedTaskKeys.includes(key);
      return {
        ...current,
        completedTaskKeys: (completed
          ? current.completedTaskKeys.filter((item) => item !== key)
          : [...current.completedTaskKeys, key]
        ).slice(-90),
      };
    });
  };

  const updateGoal = (field: "weeklySessionsTarget" | "dailyPuzzleTarget", value: number) => {
    setSettings((current) => ({ ...current, [field]: value }));
  };

  return (
    <div className="min-h-screen bg-[#20251e] p-4 text-[#f0f2eb] sm:p-7">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-md border border-[#607b4d] bg-[#34442c] px-2 py-1 text-[9px] font-black uppercase tracking-[0.15em] text-[#d9edc4]">Training Intelligence</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#78836f]">CHESSMART ACADEMY</span>
            </div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Твоя шахматная академия</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[#a2aa99]">Персональный план строится на твоих партиях, ошибках и тренировках. Не абстрактный рейтинг — понятный следующий шаг.</p>
          </div>
          <button type="button" onClick={onBack} className="rounded-xl border border-[#46523d] bg-[#2a3026] px-4 py-2.5 text-xs font-bold text-[#dce6d1] hover:bg-[#343d2e]">← Назад</button>
        </header>

        <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Текущая серия" value={String(dashboard.streak.current) + " дн."} detail={"Лучшая серия: " + dashboard.streak.longest + " · активных дней за 30 дней: " + dashboard.streak.activeDays30} accent="text-[#c6e59f]" />
          <StatCard label="Точность разборов" value={dashboard.averageAccuracy === null ? "—" : dashboard.averageAccuracy.toFixed(1) + "%"} detail={dashboard.reviewedGameCount + " сохранённых разборов"} accent="text-[#d9edc4]" />
          <StatCard label="Решено учебных позиций" value={String(dashboard.solvedPuzzleCount)} detail={dashboard.unsolvedPuzzleCount + " ошибок ждут повторения"} accent="text-[#a6d6d0]" />
          <StatCard label="Тренировочные сессии" value={String(dashboard.trainingSessionCount)} detail={dashboard.weekly.minutes + " минут занятий на этой неделе"} accent="text-[#e1c78e]" />
        </section>

        <section className="mb-5 grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
          <div className="rounded-2xl border border-[#45523c] bg-gradient-to-br from-[#303c2b] to-[#252c22] p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[#a7c28e]">Твоя цель на неделю</div>
                <h2 className="mt-1 text-xl font-black text-white">Постоянство сильнее марафона</h2>
                <p className="mt-1 max-w-xl text-xs leading-relaxed text-[#b5bea9]">Задай комфортный темп. Академия покажет прогресс по завершённым тренировочным сессиям.</p>
              </div>
              <div className="min-w-20 rounded-xl border border-white/[0.08] bg-black/15 px-3 py-2 text-center">
                <div className="text-2xl font-black tabular-nums text-[#d9edc4]">{dashboard.weekly.sessions}<span className="text-sm text-[#9eaa91]">/{dashboard.weekly.targetSessions}</span></div>
                <div className="text-[9px] font-bold uppercase tracking-wide text-[#9eaa91]">сессий</div>
              </div>
            </div>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-black/25">
              <div className="h-full rounded-full bg-[#a4cf7c] transition-all" style={{ width: dashboard.weekly.progressPercent + "%" }} />
            </div>
            <div className="mt-2 flex flex-wrap justify-between gap-2 text-[10px] text-[#aab59e]">
              <span>{dashboard.weekly.progressPercent}% недельной цели</span>
              <span>{dashboard.weekly.solvedPuzzles} решённых задач · {dashboard.weekly.reviewedGames} разборов</span>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="text-[10px] font-bold uppercase tracking-wide text-[#aab59e]">
                Тренировок в неделю
                <select value={settings.weeklySessionsTarget} onChange={(event) => updateGoal("weeklySessionsTarget", Number(event.target.value))} className="mt-1.5 block w-full rounded-lg border border-white/[0.1] bg-[#20271d] px-3 py-2.5 text-sm font-extrabold text-white outline-none focus:border-[#9fc67a]">
                  {[3, 4, 5, 6, 7, 10, 14].map((value) => <option key={value} value={value}>{value} сессий</option>)}
                </select>
              </label>
              <label className="text-[10px] font-bold uppercase tracking-wide text-[#aab59e]">
                Задач каждый день
                <select value={settings.dailyPuzzleTarget} onChange={(event) => updateGoal("dailyPuzzleTarget", Number(event.target.value))} className="mt-1.5 block w-full rounded-lg border border-white/[0.1] bg-[#20271d] px-3 py-2.5 text-sm font-extrabold text-white outline-none focus:border-[#9fc67a]">
                  {[1, 2, 3, 5, 7, 10, 15, 20].map((value) => <option key={value} value={value}>{value} задач</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="rounded-2xl border border-[#3d4537] bg-[#252a22] p-5 sm:p-6">
            <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[#87977a]">Сегодняшний чек-лист</div>
            <div className="mt-1 flex items-end justify-between gap-3">
              <h2 className="text-xl font-black">Маленький прогресс</h2>
              <span className="text-sm font-black tabular-nums text-[#c6e59f]">{completedCount}/{dashboard.tasks.length}</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#171b15]">
              <div className="h-full rounded-full bg-[#8dbb67] transition-all" style={{ width: completedPercent + "%" }} />
            </div>
            <div className="mt-4 space-y-3">
              {dashboard.tasks.map((task) => {
                const done = settings.completedTaskKeys.includes(dashboard.todayKey + ":" + task.id);
                return (
                  <div key={task.id} className="flex items-start gap-3">
                    <button type="button" onClick={() => toggleTask(task.id)} aria-pressed={done} aria-label={done ? "Отметить задачу невыполненной" : "Отметить задачу выполненной"} className={"mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs font-black transition " + (done ? "border-[#9cc878] bg-[#8dbb67] text-[#1b2517]" : "border-[#67745d] bg-transparent text-transparent hover:border-[#a5ca84]")}>✓</button>
                    <div className="min-w-0 flex-1">
                      <div className={"text-xs font-extrabold " + (done ? "text-[#9da995] line-through" : "text-[#e8ece1]")}>{task.title}</div>
                      <div className="mt-0.5 text-[10px] leading-relaxed text-[#92998a]">{task.detail}</div>
                    </div>
                    <div className="text-[9px] font-bold tabular-nums text-[#89947d]">{task.durationMinutes} мин.</div>
                    <button type="button" onClick={() => onNavigate(task.destination)} className="rounded-md bg-[#333c2d] px-2 py-1 text-[9px] font-bold text-[#caddb8] hover:bg-[#435139]">Открыть</button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="mb-5 grid gap-4 xl:grid-cols-[1fr_1fr]">
          <div className="rounded-2xl border border-[#3d4537] bg-[#252a22] p-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[#87977a]">Анализ прогресса</div>
                <h2 className="mt-1 text-lg font-black">Где можно прибавить</h2>
              </div>
              <span className="text-[10px] text-[#858e7c]">По сохранённым партиям и задачам</span>
            </div>
            {dashboard.weaknesses.length ? (
              <div className="mt-4 space-y-3">
                {dashboard.weaknesses.slice(0, 5).map((item, index) => (
                  <div key={item.id} className="rounded-xl border border-white/[0.055] bg-black/10 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#3b4931] text-[10px] font-black text-[#c9dfb3]">{index + 1}</span>
                        <span className="truncate text-xs font-extrabold text-[#e1e7da]">{item.title}</span>
                      </div>
                      <DestinationButton destination={item.destination} onNavigate={onNavigate}>Тренировать</DestinationButton>
                    </div>
                    <p className="ml-8 mt-1 text-[10px] leading-relaxed text-[#969e8e]">{item.detail}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-[#56624c] bg-black/10 p-5 text-center">
                <div className="text-sm font-extrabold">Пока мало данных для персонального вывода</div>
                <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-[#979f90]">Разбери пару партий или реши задачи из своих ошибок — здесь появятся слабые стадии и повторяющиеся тактические темы.</p>
                <button type="button" onClick={() => onNavigate("review")} className="mt-3 rounded-lg bg-[#83b45c] px-3 py-2 text-xs font-extrabold text-[#172014] hover:bg-[#9bc978]">Разобрать партию</button>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[#3d4537] bg-[#252a22] p-5">
            <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[#87977a]">Следующий лучший шаг</div>
            <h2 className="mt-1 text-lg font-black">Рекомендации тренера</h2>
            <div className="mt-4 space-y-3">
              {dashboard.recommendations.map((item, index) => (
                <div key={item.id} className="flex items-start gap-3 rounded-xl bg-[#1e241c] p-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#596b49] bg-[#34442c] text-xs font-black text-[#d9edc4]">{index + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-extrabold text-[#e5ebdf]">{item.title}</div>
                    <p className="mt-1 text-[10px] leading-relaxed text-[#959e8c]">{item.reason}</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[9px] font-bold text-[#7f8b75]">Примерно {item.durationMinutes} минут</span>
                      <button type="button" onClick={() => onNavigate(item.destination)} className="text-[10px] font-extrabold text-[#bdda9f] hover:text-white">Перейти →</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mb-5 rounded-2xl border border-[#3d4537] bg-[#252a22] p-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[#87977a]">Consistency tracker</div>
              <h2 className="mt-1 text-lg font-black">Твой календарь активности</h2>
              <p className="mt-1 text-[10px] text-[#8f9886]">Каждая клетка — день. Чем насыщеннее цвет, тем больше учебных действий.</p>
            </div>
            <div className="text-right text-[10px] text-[#899381]">{dashboard.streak.totalActiveDays} активных дней всего</div>
          </div>
          <div className="mt-4 grid grid-cols-7 gap-1.5 sm:grid-cols-12">
            {dashboard.activity.map((day) => {
              const intensity = day.total === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(day.total / maxActivity * 4)));
              const colors = ["bg-[#343a30]", "bg-[#4c6240]", "bg-[#62834c]", "bg-[#82a960]", "bg-[#b1d18d]"];
              return (
                <div key={day.key} title={dayLabel(day.key) + ": " + day.total + " действий"} className={"group relative aspect-square rounded-[4px] " + colors[intensity]}>
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-[#11150f] px-2 py-1 text-[9px] text-white shadow-lg group-hover:block">{dayLabel(day.key)} · {day.total}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[9px] text-[#828b79]">
            <span>12 последних недель</span>
            <div className="flex items-center gap-1.5"><span>Меньше</span>{["bg-[#343a30]", "bg-[#4c6240]", "bg-[#62834c]", "bg-[#82a960]", "bg-[#b1d18d]"].map((color) => <span key={color} className={"h-2.5 w-2.5 rounded-[3px] " + color} />)}<span>Больше</span></div>
          </div>
        </section>

        <section className="mb-7 rounded-2xl border border-[#3d4537] bg-[#252a22] p-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[#87977a]">Milestones</div>
              <h2 className="mt-1 text-lg font-black">Достижения</h2>
            </div>
            <span className="text-[10px] font-bold text-[#c1d9a7]">{unlockedAchievements}/{dashboard.achievements.length} открыто</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {dashboard.achievements.map((item) => (
              <div key={item.id} className={"rounded-xl border p-3 " + (item.unlocked ? "border-[#607a4c] bg-[#303d2a]" : "border-white/[0.055] bg-black/10")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs font-extrabold text-[#e4eadd]">{item.title}</div>
                  <span className={"text-[9px] font-black " + (item.unlocked ? "text-[#b8d995]" : "text-[#7e8974]")}>{item.unlocked ? "ОТКРЫТО" : item.progress + "/" + item.target}</span>
                </div>
                <p className="mt-1 min-h-8 text-[10px] leading-relaxed text-[#929b88]">{item.description}</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/25"><div className="h-full rounded-full bg-[#91bb6a]" style={{ width: Math.round(item.progress / item.target * 100) + "%" }} /></div>
              </div>
            ))}
          </div>
        </section>

        <footer className="border-t border-white/[0.06] pt-4 text-[10px] leading-relaxed text-[#788271]">
          Академия использует только сохранённые данные профиля. Показатели точности и слабых мест описывают историю тренировок, а не предсказывают будущий рейтинг.
        </footer>
      </div>
    </div>
  );
}
