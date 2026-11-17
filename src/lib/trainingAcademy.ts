import type { PlayerProfile, TrainingPuzzle } from "./playerProfile.ts";

export type AcademyDestination = "review" | "puzzles" | "mistakes" | "coach" | "endgame" | "openings" | "lab" | "diagnostics";

export interface AcademySettings {
  weeklySessionsTarget: number;
  dailyPuzzleTarget: number;
  completedTaskKeys: string[];
}

export interface AcademyActivityDay {
  key: string;
  reviews: number;
  solvedPuzzles: number;
  sessions: number;
  botGames: number;
  total: number;
}

export interface StudyStreak {
  current: number;
  longest: number;
  activeDays30: number;
  totalActiveDays: number;
  lastActiveDay: string | null;
}

export interface AcademyWeakness {
  id: string;
  title: string;
  detail: string;
  score: number;
  sourceCount: number;
  destination: AcademyDestination;
}

export interface AcademyRecommendation {
  id: string;
  title: string;
  reason: string;
  durationMinutes: number;
  priority: number;
  destination: AcademyDestination;
}

export interface AcademyTask {
  id: string;
  title: string;
  detail: string;
  durationMinutes: number;
  destination: AcademyDestination;
}

export interface AcademyAchievement {
  id: string;
  title: string;
  description: string;
  progress: number;
  target: number;
  unlocked: boolean;
}

export interface AcademyWeeklySummary {
  sessions: number;
  solvedPuzzles: number;
  reviewedGames: number;
  minutes: number;
  targetSessions: number;
  progressPercent: number;
}

export interface TrainingAcademyDashboard {
  todayKey: string;
  solvedPuzzleCount: number;
  unsolvedPuzzleCount: number;
  reviewedGameCount: number;
  trainingSessionCount: number;
  averageAccuracy: number | null;
  streak: StudyStreak;
  activity: AcademyActivityDay[];
  weekly: AcademyWeeklySummary;
  weaknesses: AcademyWeakness[];
  recommendations: AcademyRecommendation[];
  tasks: AcademyTask[];
  achievements: AcademyAchievement[];
}

const PHASES = ["opening", "middlegame", "endgame"] as const;
type Phase = (typeof PHASES)[number];

const PHASE_NAMES: Record<Phase, string> = {
  opening: "Дебют",
  middlegame: "Миттельшпиль",
  endgame: "Эндшпиль",
};

const PHASE_ADVICE: Record<Phase, string> = {
  opening: "Развитие фигур, центр и безопасность короля.",
  middlegame: "Расчёт вариантов, тактика и координация фигур.",
  endgame: "Активность короля, проходные пешки и точный расчёт.",
};

const CLASS_WEIGHT: Record<TrainingPuzzle["cls"], number> = {
  inaccuracy: 1,
  mistake: 2,
  miss: 2.5,
  blunder: 4,
};

const DEFAULT_SETTINGS: AcademySettings = {
  weeklySessionsTarget: 5,
  dailyPuzzleTarget: 3,
  completedTaskKeys: [],
};

interface MutableActivity {
  reviews: number;
  solvedPuzzles: number;
  sessions: number;
  botGames: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function academyDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "";
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function localDayNumber(key: string): number {
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function shiftDay(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setHours(12, 0, 0, 0);
  next.setDate(next.getDate() + amount);
  return next;
}

function mondayStart(date: Date): Date {
  const day = date.getDay();
  return shiftDay(date, -(day === 0 ? 6 : day - 1));
}

function emptyActivity(): MutableActivity {
  return { reviews: 0, solvedPuzzles: 0, sessions: 0, botGames: 0 };
}

function collectActivity(profile: PlayerProfile): Map<string, MutableActivity> {
  const map = new Map<string, MutableActivity>();
  const ensure = (timestamp: number): MutableActivity | null => {
    if (!isFiniteNumber(timestamp) || timestamp <= 0) return null;
    const key = academyDayKey(timestamp);
    if (!key) return null;
    const current = map.get(key) ?? emptyActivity();
    map.set(key, current);
    return current;
  };

  for (const review of safeArray(profile.reviews)) {
    const bucket = ensure(review.at);
    if (bucket) bucket.reviews += 1;
  }
  for (const puzzle of safeArray(profile.puzzles)) {
    if (!isFiniteNumber(puzzle.solvedAt)) continue;
    const bucket = ensure(puzzle.solvedAt);
    if (bucket) bucket.solvedPuzzles += 1;
  }
  for (const session of safeArray(profile.trainingSessions)) {
    const bucket = ensure(session.startedAt);
    if (bucket) bucket.sessions += 1;
  }
  for (const game of safeArray(profile.history)) {
    const bucket = ensure(game.at);
    if (bucket) bucket.botGames += 1;
  }
  return map;
}

function totalEvents(day: MutableActivity | undefined): number {
  if (!day) return 0;
  return day.reviews + day.solvedPuzzles + day.sessions + day.botGames;
}

export function normalizeAcademySettings(value: unknown): AcademySettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_SETTINGS };
  const raw = value as Partial<AcademySettings>;
  const weekly = isFiniteNumber(raw.weeklySessionsTarget) ? Math.round(raw.weeklySessionsTarget) : DEFAULT_SETTINGS.weeklySessionsTarget;
  const daily = isFiniteNumber(raw.dailyPuzzleTarget) ? Math.round(raw.dailyPuzzleTarget) : DEFAULT_SETTINGS.dailyPuzzleTarget;
  const completed = Array.isArray(raw.completedTaskKeys)
    ? raw.completedTaskKeys.filter((item): item is string => typeof item === "string" && item.length <= 64).slice(-90)
    : [];
  return {
    weeklySessionsTarget: Math.max(1, Math.min(14, weekly)),
    dailyPuzzleTarget: Math.max(1, Math.min(20, daily)),
    completedTaskKeys: Array.from(new Set(completed)),
  };
}

export function parseAcademySettings(source: string | null | undefined): AcademySettings {
  if (!source) return { ...DEFAULT_SETTINGS };
  try {
    return normalizeAcademySettings(JSON.parse(source) as unknown);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function serializeAcademySettings(settings: AcademySettings): string {
  return JSON.stringify(normalizeAcademySettings(settings));
}

export function calculateStudyStreak(profile: PlayerProfile, now = Date.now()): StudyStreak {
  const activity = collectActivity(profile);
  const activeKeys = [...activity.entries()]
    .filter(([, value]) => totalEvents(value) > 0)
    .map(([key]) => key)
    .sort();

  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const todayKey = academyDayKey(today.getTime());
  const yesterdayKey = academyDayKey(shiftDay(today, -1).getTime());
  const lastActiveDay = activeKeys[activeKeys.length - 1] ?? null;

  let current = 0;
  let cursor = activity.has(todayKey) ? today : shiftDay(today, -1);
  while (activity.has(academyDayKey(cursor.getTime()))) {
    current += 1;
    cursor = shiftDay(cursor, -1);
  }

  let longest = 0;
  let run = 0;
  let previous = Number.NaN;
  for (const key of activeKeys) {
    const dayNumber = localDayNumber(key);
    run = Number.isFinite(previous) && dayNumber - previous === 86_400_000 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = dayNumber;
  }

  const last30Start = shiftDay(today, -29);
  const startNumber = localDayNumber(academyDayKey(last30Start.getTime()));
  const todayNumber = localDayNumber(todayKey);
  const activeDays30 = activeKeys.filter((key) => {
    const dayNumber = localDayNumber(key);
    return dayNumber >= startNumber && dayNumber <= todayNumber;
  }).length;

  // Keep yesterday's key explicit in the calculation: it makes the grace-day rule testable.
  if (!activity.has(todayKey) && activity.has(yesterdayKey) && current === 0) current = 1;
  return { current, longest, activeDays30, totalActiveDays: activeKeys.length, lastActiveDay };
}

function classifyPuzzleTheme(puzzle: TrainingPuzzle): string {
  const text = `${puzzle.comment} ${puzzle.playedSan}`.toLocaleLowerCase("ru");
  if (/вилк|двойной удар|одновременно атак/i.test(text)) return "Вилки и двойные удары";
  if (/связк|связывает|прикован/i.test(text)) return "Связки";
  if (/мат|матов|матовая атака|шахмат/i.test(text)) return "Атака на короля";
  if (/под боем|висящ|незащищ|теряет фиг|выигрывает .*фигур/i.test(text)) return "Защита фигур";
  if (/эндшпил|проходн|оппозици|пешечн.*гонк|король.*актив/i.test(text)) return "Эндшпиль";
  if (/дебют|развити|рокировк|центр/i.test(text)) return "Дебют и развитие";
  if (/пропуска|упуска|возможност|лучше было|нужно было/i.test(text)) return "Поиск лучшего продолжения";
  return "Расчёт и тактика";
}

function phaseWeaknesses(profile: PlayerProfile): AcademyWeakness[] {
  const totals: Record<Phase, { weightedAccuracy: number; moves: number }> = {
    opening: { weightedAccuracy: 0, moves: 0 },
    middlegame: { weightedAccuracy: 0, moves: 0 },
    endgame: { weightedAccuracy: 0, moves: 0 },
  };

  for (const review of safeArray(profile.reviews)) {
    for (const phase of PHASES) {
      const stat = review.phases?.[phase];
      if (!stat) continue;
      for (const color of ["w", "b"] as const) {
        const moves = stat[color]?.moves ?? 0;
        const accuracy = stat[color]?.accuracy ?? 0;
        if (isFiniteNumber(moves) && moves > 0 && isFiniteNumber(accuracy)) {
          totals[phase].weightedAccuracy += Math.max(0, Math.min(100, accuracy)) * moves;
          totals[phase].moves += moves;
        }
      }
    }
  }

  return PHASES.flatMap((phase) => {
    const item = totals[phase];
    if (item.moves < 4) return [];
    const accuracy = item.weightedAccuracy / item.moves;
    const gap = Math.max(0, 100 - accuracy);
    return [{
      id: `phase-${phase}`,
      title: PHASE_NAMES[phase],
      detail: `Точность ${accuracy.toFixed(1)}% на ${item.moves} полуходах. ${PHASE_ADVICE[phase]}`,
      score: gap,
      sourceCount: item.moves,
      destination: phase === "endgame" ? "endgame" as const : "coach" as const,
    }];
  });
}

export function analyzeTrainingWeaknesses(profile: PlayerProfile): AcademyWeakness[] {
  const themed = new Map<string, { count: number; weight: number }>();
  for (const puzzle of safeArray(profile.puzzles)) {
    const theme = classifyPuzzleTheme(puzzle);
    const entry = themed.get(theme) ?? { count: 0, weight: 0 };
    entry.count += 1;
    entry.weight += CLASS_WEIGHT[puzzle.cls] ?? 1;
    themed.set(theme, entry);
  }

  const puzzleWeaknesses = [...themed.entries()].map(([theme, value]) => ({
    id: `theme-${theme}`,
    title: theme,
    detail: `${value.count} учебных позиций из твоих партий связаны с этой темой.`,
    score: value.weight * 12,
    sourceCount: value.count,
    destination: theme === "Эндшпиль" ? "endgame" as const : "mistakes" as const,
  }));

  const classCounts = new Map<string, number>();
  for (const puzzle of safeArray(profile.puzzles)) classCounts.set(puzzle.cls, (classCounts.get(puzzle.cls) ?? 0) + 1);
  const severe = (classCounts.get("blunder") ?? 0) * 4
    + (classCounts.get("mistake") ?? 0) * 2
    + (classCounts.get("miss") ?? 0) * 2
    + (classCounts.get("inaccuracy") ?? 0);
  const classWeaknesses: AcademyWeakness[] = severe > 0 ? [{
    id: "move-quality",
    title: "Качество решений",
    detail: `${safeArray(profile.puzzles).length} позиций с неточностями, ошибками, зевками или упущенными возможностями.`,
    score: severe * 6,
    sourceCount: safeArray(profile.puzzles).length,
    destination: "mistakes",
  }] : [];

  return [...puzzleWeaknesses, ...classWeaknesses, ...phaseWeaknesses(profile)]
    .filter((item) => item.sourceCount > 0 && item.score > 0)
    .sort((a, b) => b.score - a.score || b.sourceCount - a.sourceCount)
    .slice(0, 6);
}

function pushRecommendation(
  list: AcademyRecommendation[],
  item: AcademyRecommendation,
): void {
  if (list.some((entry) => entry.destination === item.destination || entry.id === item.id)) return;
  list.push(item);
}

export function buildTrainingRecommendations(
  profile: PlayerProfile,
  now = Date.now(),
  weaknesses = analyzeTrainingWeaknesses(profile),
): AcademyRecommendation[] {
  const recommendations: AcademyRecommendation[] = [];
  const unsolved = safeArray(profile.puzzles).filter((puzzle) => !isFiniteNumber(puzzle.solvedAt)).length;
  const recentSessions = safeArray(profile.trainingSessions)
    .filter((session) => isFiniteNumber(session.startedAt) && now - session.startedAt <= 7 * 86_400_000 && now >= session.startedAt)
    .length;

  if (!safeArray(profile.reviews).length) {
    pushRecommendation(recommendations, {
      id: "first-review",
      title: "Начни с разбора своей партии",
      reason: "Без истории партий пока нельзя надёжно определить твои повторяющиеся ошибки.",
      durationMinutes: 10,
      priority: 100,
      destination: "review",
    });
  }

  if (unsolved > 0) {
    pushRecommendation(recommendations, {
      id: "mistake-repetition",
      title: "Вернись к своим ошибкам",
      reason: `${unsolved} позиций ждут повторного решения. Попробуй найти лучший ход без подсказки.`,
      durationMinutes: 10,
      priority: 95,
      destination: "mistakes",
    });
  }

  const phase = weaknesses.find((item) => item.id.startsWith("phase-"));
  if (phase) {
    pushRecommendation(recommendations, {
      id: "weakest-phase",
      title: `Подтяни: ${phase.title.toLocaleLowerCase("ru")}`,
      reason: phase.detail,
      durationMinutes: 15,
      priority: 85,
      destination: phase.destination,
    });
  }

  const theme = weaknesses.find((item) => item.id.startsWith("theme-"));
  if (theme) {
    pushRecommendation(recommendations, {
      id: "recurring-theme",
      title: `Закрепи тему: ${theme.title.toLocaleLowerCase("ru")}`,
      reason: theme.detail,
      durationMinutes: 10,
      priority: 75,
      destination: theme.destination,
    });
  }

  if (recentSessions === 0 && safeArray(profile.trainingSessions).length > 0) {
    pushRecommendation(recommendations, {
      id: "restart-rhythm",
      title: "Верни тренировочный ритм",
      reason: "За последние семь дней нет сохранённых тренировочных сессий. Даже 10 минут помогут вернуться в режим.",
      durationMinutes: 10,
      priority: 55,
      destination: "coach",
    });
  }

  if (recommendations.length < 3) {
    pushRecommendation(recommendations, {
      id: "daily-tactics",
      title: "Поддержи тактическую форму",
      reason: "Реши несколько задач и проговори угрозы обеих сторон перед каждым ходом.",
      durationMinutes: 10,
      priority: 45,
      destination: "puzzles",
    });
  }
  if (recommendations.length < 3) {
    pushRecommendation(recommendations, {
      id: "position-study",
      title: "Изучи одну позицию глубже",
      reason: "Проверь кандидаты ходов, угрозы и планы в лаборатории позиции.",
      durationMinutes: 12,
      priority: 35,
      destination: "lab",
    });
  }

  return recommendations.sort((a, b) => b.priority - a.priority).slice(0, 4);
}

export function buildDailyTasks(
  profile: PlayerProfile,
  dailyPuzzleTarget: number,
  weaknesses = analyzeTrainingWeaknesses(profile),
): AcademyTask[] {
  const tasks: AcademyTask[] = [];
  const unsolved = safeArray(profile.puzzles).filter((puzzle) => !isFiniteNumber(puzzle.solvedAt)).length;

  if (unsolved > 0) {
    tasks.push({
      id: "review-mistakes",
      title: "Разбери одну свою ошибку",
      detail: `${unsolved} позиций доступны для повторения. Найди лучший ход самостоятельно.`,
      durationMinutes: 8,
      destination: "mistakes",
    });
  } else if (!safeArray(profile.reviews).length) {
    tasks.push({
      id: "analyze-first-game",
      title: "Разбери первую партию",
      detail: "Загрузи PGN, чтобы CHESSMART нашёл ошибки и превратил их в упражнения.",
      durationMinutes: 10,
      destination: "review",
    });
  }

  tasks.push({
    id: "daily-puzzles",
    title: `Реши ${dailyPuzzleTarget} тактических задач`,
    detail: "Перед ходом проверь шахи, взятия и прямые угрозы соперника.",
    durationMinutes: Math.max(5, dailyPuzzleTarget * 3),
    destination: "puzzles",
  });

  const phase = weaknesses.find((item) => item.id.startsWith("phase-"));
  tasks.push({
    id: "personal-coach",
    title: phase ? `Потренируй стадию: ${phase.title.toLocaleLowerCase("ru")}` : "Проведи занятие с Personal Coach",
    detail: phase?.detail ?? "Повтори сложные позиции из собственных партий и закрепи правильные решения.",
    durationMinutes: 12,
    destination: phase?.destination ?? "coach",
  });

  return tasks.slice(0, 3);
}

export function buildAcademyDashboard(
  profile: PlayerProfile,
  now = Date.now(),
  settings: AcademySettings = DEFAULT_SETTINGS,
): TrainingAcademyDashboard {
  const normalized = normalizeAcademySettings(settings);
  const activityMap = collectActivity(profile);
  const currentDate = new Date(now);
  currentDate.setHours(12, 0, 0, 0);
  const activity: AcademyActivityDay[] = [];

  for (let offset = 83; offset >= 0; offset -= 1) {
    const date = shiftDay(currentDate, -offset);
    const key = academyDayKey(date.getTime());
    const bucket = activityMap.get(key) ?? emptyActivity();
    const total = totalEvents(bucket);
    activity.push({ key, ...bucket, total });
  }

  const weekStart = mondayStart(currentDate);
  const weekStartKey = academyDayKey(weekStart.getTime());
  const weekStartNumber = localDayNumber(weekStartKey);
  const todayNumber = localDayNumber(academyDayKey(currentDate.getTime()));
  const weekActivity = [...activityMap.entries()].filter(([key]) => {
    const value = localDayNumber(key);
    return value >= weekStartNumber && value <= todayNumber;
  });

  const sessions = weekActivity.reduce((sum, [, item]) => sum + item.sessions, 0);
  const solvedPuzzles = weekActivity.reduce((sum, [, item]) => sum + item.solvedPuzzles, 0);
  const reviewedGames = weekActivity.reduce((sum, [, item]) => sum + item.reviews, 0);
  const mondayMs = weekStart.getTime();
  const minutes = safeArray(profile.trainingSessions)
    .filter((session) => isFiniteNumber(session.startedAt) && session.startedAt >= mondayMs && session.startedAt <= now)
    .reduce((sum, session) => sum + (isFiniteNumber(session.durationMs) ? Math.max(0, session.durationMs) : 0), 0) / 60_000;

  const streak = calculateStudyStreak(profile, now);
  const weaknesses = analyzeTrainingWeaknesses(profile);
  const recommendations = buildTrainingRecommendations(profile, now, weaknesses);
  const tasks = buildDailyTasks(profile, normalized.dailyPuzzleTarget, weaknesses);
  const solvedPuzzleCount = safeArray(profile.puzzles).filter((puzzle) => isFiniteNumber(puzzle.solvedAt)).length;
  const averageAccuracy = safeArray(profile.reviews).length
    ? safeArray(profile.reviews).reduce((sum, review) => sum + (isFiniteNumber(review.accuracy?.average) ? review.accuracy.average : 0), 0) / safeArray(profile.reviews).length
    : null;

  const reviewCount = safeArray(profile.reviews).length;
  const sessionCount = safeArray(profile.trainingSessions).length;
  const achievements: AcademyAchievement[] = [
    { id: "first-review", title: "Первый разбор", description: "Проанализируй первую партию.", progress: reviewCount, target: 1 },
    { id: "five-reviews", title: "Аналитик", description: "Разбери пять партий.", progress: reviewCount, target: 5 },
    { id: "ten-puzzles", title: "Тактик", description: "Реши десять своих учебных позиций.", progress: solvedPuzzleCount, target: 10 },
    { id: "fifty-puzzles", title: "Снайпер", description: "Реши пятьдесят учебных позиций.", progress: solvedPuzzleCount, target: 50 },
    { id: "three-day-streak", title: "Вошёл во вкус", description: "Занимайся три дня подряд.", progress: streak.current, target: 3 },
    { id: "seven-day-streak", title: "Железная дисциплина", description: "Сохрани серию из семи дней.", progress: streak.current, target: 7 },
    { id: "first-session", title: "Первая тренировка", description: "Заверши первую сохранённую тренировку.", progress: sessionCount, target: 1 },
    { id: "ten-sessions", title: "Системная работа", description: "Проведи десять тренировочных сессий.", progress: sessionCount, target: 10 },
  ].map((item) => ({ ...item, unlocked: item.progress >= item.target, progress: Math.min(item.progress, item.target) }));

  return {
    todayKey: academyDayKey(currentDate.getTime()),
    solvedPuzzleCount,
    unsolvedPuzzleCount: safeArray(profile.puzzles).length - solvedPuzzleCount,
    reviewedGameCount: reviewCount,
    trainingSessionCount: sessionCount,
    averageAccuracy,
    streak,
    activity,
    weekly: {
      sessions,
      solvedPuzzles,
      reviewedGames,
      minutes: Math.round(minutes),
      targetSessions: normalized.weeklySessionsTarget,
      progressPercent: Math.min(100, Math.round((sessions / normalized.weeklySessionsTarget) * 100)),
    },
    weaknesses,
    recommendations,
    tasks,
    achievements,
  };
}
