import type { PlayerProfile } from "./playerProfile";
import type { GamePhase } from "./learningStats";

export type SuitePreferenceKey = "compactMode" | "reducedMotion" | "largeText";
export type QuestPeriod = "daily" | "weekly";
export type QuestMetric = "reviews" | "puzzles" | "minutes" | "botGames" | "sessions";

export interface SuiteSettings {
  compactMode: boolean;
  reducedMotion: boolean;
  largeText: boolean;
  totalXp: number;
  claimedQuestKeys: string[];
}

export interface ProfileMetrics {
  games: number;
  winRate: number;
  drawRate: number;
  lossRate: number;
  averageAccuracy: number | null;
  recentAccuracy: number | null;
  accuracyChange: number | null;
  peakRating: number;
  ratingChange: number;
  puzzleSolveRate: number | null;
  solvedPuzzleCount: number;
  puzzleBacklog: number;
  trainingMinutes: number;
  trainingSessions: number;
  currentForm: Array<"W" | "D" | "L">;
  weakestPhase: { phase: GamePhase; accuracy: number; moves: number } | null;
}

export interface SuiteQuestDefinition {
  id: string;
  period: QuestPeriod;
  title: string;
  description: string;
  metric: QuestMetric;
  target: number;
  xp: number;
  destination: "review" | "puzzles" | "mistakes" | "play" | "academy";
}

export interface SuiteQuest extends SuiteQuestDefinition {
  periodKey: string;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

export interface QuestBoard {
  dayKey: string;
  weekKey: string;
  daily: SuiteQuest[];
  weekly: SuiteQuest[];
  completed: number;
  total: number;
  claimableXp: number;
  earnedXp: number;
}

export interface StorageDiagnostics {
  positionEntries: number;
  engineFiles: number;
  usageBytes: number | null;
  quotaBytes: number | null;
  usagePercent: number | null;
  indexedDbAvailable: boolean;
  cacheApiAvailable: boolean;
  health: "healthy" | "watch" | "critical" | "unknown";
}

export interface EndpointHealth {
  id: "website" | "online-api";
  label: string;
  ok: boolean;
  latencyMs: number | null;
  detail: string;
}

export interface NetworkDiagnostics {
  checkedAt: number;
  online: boolean;
  endpoints: EndpointHealth[];
}

export interface ReviewTrendPoint {
  at: number;
  accuracy: number;
  label: string;
}

export interface SuiteDashboard {
  metrics: ProfileMetrics;
  quests: QuestBoard;
  reviewTrend: ReviewTrendPoint[];
  weakestPhaseLabel: string;
  nextStep: string;
}

const SETTINGS_KEY = "chessmart:systems-hub:v1";
const PHASE_LABELS: Record<GamePhase, string> = {
  opening: "Дебют",
  middlegame: "Миттельшпиль",
  endgame: "Эндшпиль",
};

const DEFAULT_SETTINGS: SuiteSettings = {
  compactMode: false,
  reducedMotion: false,
  largeText: false,
  totalXp: 0,
  claimedQuestKeys: [],
};

export const SUITE_QUESTS: readonly SuiteQuestDefinition[] = [
  { id: "review-one", period: "daily", title: "Разбор дня", description: "Заверши хотя бы один анализ партии.", metric: "reviews", target: 1, xp: 35, destination: "review" },
  { id: "tactics-three", period: "daily", title: "Тактическая разминка", description: "Реши три учебные позиции.", metric: "puzzles", target: 3, xp: 30, destination: "puzzles" },
  { id: "study-fifteen", period: "daily", title: "Пятнадцать минут фокуса", description: "Проведи 15 минут в тренировочных сессиях.", metric: "minutes", target: 15, xp: 25, destination: "academy" },
  { id: "bot-game", period: "daily", title: "Практическая партия", description: "Сыграй партию против компьютера.", metric: "botGames", target: 1, xp: 25, destination: "play" },
  { id: "weekly-reviews", period: "weekly", title: "Разборщик недели", description: "Разбери три партии за неделю.", metric: "reviews", target: 3, xp: 70, destination: "review" },
  { id: "weekly-tactics", period: "weekly", title: "Тактический объём", description: "Реши пятнадцать задач за неделю.", metric: "puzzles", target: 15, xp: 65, destination: "puzzles" },
  { id: "weekly-sessions", period: "weekly", title: "Ритм тренировок", description: "Проведи пять отдельных тренировочных сессий.", metric: "sessions", target: 5, xp: 65, destination: "academy" },
];

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const safeArray = <T,>(value: T[] | undefined): T[] => Array.isArray(value) ? value : [];

export function clampSuiteNumber(value: unknown, min: number, max: number, fallback = min): number {
  return finite(value) ? clamp(Math.round(value), min, max) : fallback;
}

export function suiteDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "";
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function suiteDayStart(timestamp: number): number {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return 0;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function suiteWeekStart(timestamp: number): number {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return 0;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

export function suiteWeekKey(timestamp: number): string {
  return suiteDayKey(suiteWeekStart(timestamp));
}

export function formatSuiteDate(timestamp: number): string {
  if (!finite(timestamp)) return "—";
  return new Date(timestamp).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export function formatSuiteDuration(minutes: number): string {
  const safe = Math.max(0, Math.floor(finite(minutes) ? minutes : 0));
  if (safe < 60) return safe + " мин.";
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  return rest ? hours + " ч " + rest + " мин." : hours + " ч";
}

export function formatSuiteBytes(bytes: number | null): string {
  if (!finite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return Math.round(bytes) + " Б";
  const units = ["КБ", "МБ", "ГБ", "ТБ"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 0) + " " + units[index];
}

export function normalizeSuiteSettings(value: unknown): SuiteSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_SETTINGS };
  const raw = value as Partial<SuiteSettings>;
  return {
    compactMode: raw.compactMode === true,
    reducedMotion: raw.reducedMotion === true,
    largeText: raw.largeText === true,
    totalXp: clampSuiteNumber(raw.totalXp, 0, 1_000_000_000, 0),
    claimedQuestKeys: Array.isArray(raw.claimedQuestKeys)
      ? [...new Set(raw.claimedQuestKeys.filter((key): key is string => typeof key === "string" && key.length <= 100))].slice(-250)
      : [],
  };
}

export function parseSuiteSettings(source: string | null | undefined): SuiteSettings {
  if (!source) return { ...DEFAULT_SETTINGS };
  try { return normalizeSuiteSettings(JSON.parse(source) as unknown); }
  catch { return { ...DEFAULT_SETTINGS }; }
}

export function serializeSuiteSettings(settings: SuiteSettings): string {
  return JSON.stringify(normalizeSuiteSettings(settings));
}

export function loadSuiteSettings(): SuiteSettings {
  try { return parseSuiteSettings(localStorage.getItem(SETTINGS_KEY)); }
  catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSuiteSettings(settings: SuiteSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, serializeSuiteSettings(settings)); }
  catch { /* Preferences are optional; storage failure must not block chess. */ }
}

export function updateSuitePreference(settings: SuiteSettings, key: SuitePreferenceKey, value: boolean): SuiteSettings {
  return { ...settings, [key]: value };
}

export function applySuitePreferences(settings: SuiteSettings): void {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("chessmart-compact", settings.compactMode);
    document.documentElement.classList.toggle("chessmart-reduce-motion", settings.reducedMotion);
    document.documentElement.classList.toggle("chessmart-large-text", settings.largeText);
  }

}

export function getSuitePreferenceSummary(settings: SuiteSettings): string[] {
  const enabled: string[] = [];
  if (settings.compactMode) enabled.push("Компактный интерфейс");
  if (settings.reducedMotion) enabled.push("Уменьшенная анимация");
  if (settings.largeText) enabled.push("Увеличенный текст");
  return enabled;
}

export function getWinRate(profile: PlayerProfile): number {
  const games = Math.max(0, profile.wins + profile.losses + profile.draws);
  return games ? profile.wins / games * 100 : 0;
}

export function getDrawRate(profile: PlayerProfile): number {
  const games = Math.max(0, profile.wins + profile.losses + profile.draws);
  return games ? profile.draws / games * 100 : 0;
}

export function getLossRate(profile: PlayerProfile): number {
  const games = Math.max(0, profile.wins + profile.losses + profile.draws);
  return games ? profile.losses / games * 100 : 0;
}

export function getAverageReviewAccuracy(profile: PlayerProfile): number | null {
  const reviews = safeArray(profile.reviews).filter((review) => finite(review.accuracy?.average));
  if (!reviews.length) return null;
  return reviews.reduce((sum, review) => sum + review.accuracy.average, 0) / reviews.length;
}

export function getRecentReviewAccuracy(profile: PlayerProfile, count = 5): number | null {
  const reviews = safeArray(profile.reviews).filter((review) => finite(review.accuracy?.average)).sort((a, b) => a.at - b.at).slice(-Math.max(1, count));
  if (!reviews.length) return null;
  return reviews.reduce((sum, review) => sum + review.accuracy.average, 0) / reviews.length;
}

export function getReviewAccuracyChange(profile: PlayerProfile, count = 5): number | null {
  const reviews = safeArray(profile.reviews).filter((review) => finite(review.accuracy?.average)).sort((a, b) => a.at - b.at);
  const size = Math.max(1, Math.floor(count));
  if (reviews.length < size * 2) return null;
  const previous = reviews.slice(-(size * 2), -size);
  const recent = reviews.slice(-size);
  const avg = (items: typeof reviews) => items.reduce((sum, item) => sum + item.accuracy.average, 0) / items.length;
  return avg(recent) - avg(previous);
}

export function getPeakRating(profile: PlayerProfile): number {
  return Math.max(profile.rating, ...safeArray(profile.history).map((entry) => finite(entry.ratingAfter) ? entry.ratingAfter : profile.rating));
}

export function getRatingChange(profile: PlayerProfile): number {
  const first = safeArray(profile.history).find((entry) => finite(entry.ratingAfter) && finite(entry.change));
  if (!first) return 0;
  return profile.rating - (first.ratingAfter - first.change);
}

export function getPuzzleSolveRate(profile: PlayerProfile): number | null {
  const entries = safeArray(profile.puzzleRatingHistory);
  if (entries.length) return entries.filter((entry) => entry.solved).length / entries.length * 100;
  const puzzles = safeArray(profile.puzzles);
  if (!puzzles.length) return null;
  return puzzles.filter((puzzle) => finite(puzzle.solvedAt)).length / puzzles.length * 100;
}

export function getSolvedPuzzleCount(profile: PlayerProfile): number {
  const ids = new Set<string>();
  for (const puzzle of safeArray(profile.puzzles)) if (finite(puzzle.solvedAt)) ids.add("custom:" + puzzle.id);
  for (const entry of safeArray(profile.puzzleRatingHistory)) if (entry.solved) ids.add(entry.mode + ":" + entry.puzzleId);
  return ids.size;
}

export function getPuzzleBacklog(profile: PlayerProfile): number {
  return safeArray(profile.puzzles).filter((puzzle) => !finite(puzzle.solvedAt)).length;
}

export function getTrainingMinutes(profile: PlayerProfile): number {
  return Math.round(safeArray(profile.trainingSessions).reduce((sum, session) => sum + Math.max(0, session.durationMs), 0) / 60_000);
}

export function getTrainingSessionCount(profile: PlayerProfile): number {
  return safeArray(profile.trainingSessions).length;
}

export function getCurrentForm(profile: PlayerProfile, count = 5): Array<"W" | "D" | "L"> {
  const translate = (result: string): "W" | "D" | "L" => result === "win" ? "W" : result === "draw" ? "D" : "L";
  return safeArray(profile.history).slice(-Math.max(1, count)).map((entry) => translate(entry.result));
}

export function getWeakestPhase(profile: PlayerProfile): ProfileMetrics["weakestPhase"] {
  const sums: Record<GamePhase, { sum: number; moves: number }> = {
    opening: { sum: 0, moves: 0 }, middlegame: { sum: 0, moves: 0 }, endgame: { sum: 0, moves: 0 },
  };
  for (const review of safeArray(profile.reviews)) {
    for (const phase of ["opening", "middlegame", "endgame"] as const) {
      const item = review.phases?.[phase];
      if (!item) continue;
      for (const side of [item.w, item.b]) {
        if (!finite(side?.accuracy) || !finite(side?.moves) || side.moves <= 0) continue;
        sums[phase].sum += side.accuracy * side.moves;
        sums[phase].moves += side.moves;
      }
    }
  }
  const candidates = (Object.keys(sums) as GamePhase[])
    .filter((phase) => sums[phase].moves >= 5)
    .map((phase) => ({ phase, moves: sums[phase].moves, accuracy: sums[phase].sum / sums[phase].moves }))
    .sort((a, b) => a.accuracy - b.accuracy);
  return candidates[0] ?? null;
}

export function getProfileMetrics(profile: PlayerProfile): ProfileMetrics {
  return {
    games: Math.max(0, profile.wins + profile.losses + profile.draws),
    winRate: getWinRate(profile),
    drawRate: getDrawRate(profile),
    lossRate: getLossRate(profile),
    averageAccuracy: getAverageReviewAccuracy(profile),
    recentAccuracy: getRecentReviewAccuracy(profile),
    accuracyChange: getReviewAccuracyChange(profile),
    peakRating: getPeakRating(profile),
    ratingChange: getRatingChange(profile),
    puzzleSolveRate: getPuzzleSolveRate(profile),
    solvedPuzzleCount: getSolvedPuzzleCount(profile),
    puzzleBacklog: getPuzzleBacklog(profile),
    trainingMinutes: getTrainingMinutes(profile),
    trainingSessions: getTrainingSessionCount(profile),
    currentForm: getCurrentForm(profile),
    weakestPhase: getWeakestPhase(profile),
  };
}

export function getReviewTrend(profile: PlayerProfile, count = 10): ReviewTrendPoint[] {
  return safeArray(profile.reviews).filter((review) => finite(review.at) && finite(review.accuracy?.average))
    .sort((a, b) => a.at - b.at).slice(-Math.max(1, count))
    .map((review) => ({ at: review.at, accuracy: clamp(review.accuracy.average, 0, 100), label: formatSuiteDate(review.at) }));
}

export function getDailyEventCounts(profile: PlayerProfile, now = Date.now()): Record<QuestMetric, number> {
  return getEventCountsSince(profile, suiteDayStart(now));
}

export function getWeeklyEventCounts(profile: PlayerProfile, now = Date.now()): Record<QuestMetric, number> {
  return getEventCountsSince(profile, suiteWeekStart(now));
}

function getSolvedPuzzleEvents(profile: PlayerProfile, since: number): number {
  const solved = new Map<string, number>();
  for (const puzzle of safeArray(profile.puzzles)) {
    if (finite(puzzle.solvedAt) && puzzle.solvedAt >= since) solved.set("custom:" + puzzle.id, puzzle.solvedAt);
  }
  for (const entry of safeArray(profile.puzzleRatingHistory)) {
    if (entry.solved && finite(entry.at) && entry.at >= since) solved.set(entry.mode + ":" + entry.puzzleId, entry.at);
  }
  return solved.size;
}

function getEventCountsSince(profile: PlayerProfile, since: number): Record<QuestMetric, number> {
  const reviews = safeArray(profile.reviews).filter((item) => finite(item.at) && item.at >= since).length;
  const puzzles = getSolvedPuzzleEvents(profile, since);
  const minutes = Math.floor(safeArray(profile.trainingSessions)
    .filter((item) => finite(item.startedAt) && item.startedAt >= since)
    .reduce((sum, item) => sum + Math.max(0, item.durationMs), 0) / 60_000);
  const botGames = safeArray(profile.history).filter((item) => finite(item.at) && item.at >= since).length;
  const sessions = safeArray(profile.trainingSessions).filter((item) => finite(item.startedAt) && item.startedAt >= since).length;
  return { reviews, puzzles, minutes, botGames, sessions };
}

export function getQuestProgress(profile: PlayerProfile, quest: SuiteQuestDefinition, now = Date.now()): number {
  const since = quest.period === "daily" ? suiteDayStart(now) : suiteWeekStart(now);
  const counts = getEventCountsSince(profile, since);
  return clamp(counts[quest.metric], 0, quest.target);
}

export function getQuestClaimKey(quest: SuiteQuestDefinition, now = Date.now()): string {
  return (quest.period === "daily" ? suiteDayKey(now) : suiteWeekKey(now)) + ":" + quest.id;
}

export function hasClaimedQuestReward(settings: SuiteSettings, quest: SuiteQuestDefinition, now = Date.now()): boolean {
  return settings.claimedQuestKeys.includes(getQuestClaimKey(quest, now));
}

export function claimQuestReward(
  settings: SuiteSettings,
  quest: SuiteQuest,
): { settings: SuiteSettings; granted: boolean } {
  const key = quest.periodKey + ":" + quest.id;
  if (!quest.completed || settings.claimedQuestKeys.includes(key)) return { settings, granted: false };
  return {
    settings: {
      ...settings,
      totalXp: clamp(settings.totalXp + quest.xp, 0, 1_000_000_000),
      claimedQuestKeys: [...settings.claimedQuestKeys, key].slice(-250),
    },
    granted: true,
  };
}

export function buildQuestBoard(profile: PlayerProfile, now = Date.now(), settings = DEFAULT_SETTINGS): QuestBoard {
  const build = (definition: SuiteQuestDefinition): SuiteQuest => {
    const periodKey = definition.period === "daily" ? suiteDayKey(now) : suiteWeekKey(now);
    const progress = getQuestProgress(profile, definition, now);
    const completed = progress >= definition.target;
    const claimed = settings.claimedQuestKeys.includes(periodKey + ":" + definition.id);
    return { ...definition, periodKey, progress, completed, claimed };
  };
  const daily = SUITE_QUESTS.filter((quest) => quest.period === "daily").map(build);
  const weekly = SUITE_QUESTS.filter((quest) => quest.period === "weekly").map(build);
  const all = [...daily, ...weekly];
  return {
    dayKey: suiteDayKey(now),
    weekKey: suiteWeekKey(now),
    daily,
    weekly,
    completed: all.filter((quest) => quest.completed).length,
    total: all.length,
    claimableXp: all.filter((quest) => quest.completed && !quest.claimed).reduce((sum, quest) => sum + quest.xp, 0),
    earnedXp: settings.totalXp,
  };
}

export function getQuestCompletionPercent(board: QuestBoard): number {
  return board.total ? Math.round(board.completed / board.total * 100) : 0;
}

export function getQuestLevel(totalXp: number): { level: number; currentXp: number; nextLevelXp: number; progressPercent: number } {
  const xp = Math.max(0, Math.floor(finite(totalXp) ? totalXp : 0));
  const level = Math.floor(Math.sqrt(xp / 100)) + 1;
  const currentThreshold = (level - 1) ** 2 * 100;
  const nextThreshold = level ** 2 * 100;
  return {
    level,
    currentXp: xp - currentThreshold,
    nextLevelXp: nextThreshold - currentThreshold,
    progressPercent: clamp((xp - currentThreshold) / Math.max(1, nextThreshold - currentThreshold) * 100, 0, 100),
  };
}

export function buildSuiteDashboard(profile: PlayerProfile, now = Date.now(), settings = DEFAULT_SETTINGS): SuiteDashboard {
  const metrics = getProfileMetrics(profile);
  const quests = buildQuestBoard(profile, now, settings);
  const weakestPhase = metrics.weakestPhase;
  const nextStep = weakestPhase
    ? "Удели внимание стадии «" + PHASE_LABELS[weakestPhase.phase] + "»: средняя точность " + weakestPhase.accuracy.toFixed(1) + "%."
    : metrics.puzzleBacklog
      ? "Разбери " + metrics.puzzleBacklog + " сохранённых ошибок — они уже ждут повторения."
      : "Разбери ещё несколько партий, чтобы система точнее нашла слабые места.";
  return { metrics, quests, reviewTrend: getReviewTrend(profile), weakestPhaseLabel: weakestPhase ? PHASE_LABELS[weakestPhase.phase] : "Недостаточно данных", nextStep };
}

export function calculateReviewConfidence(depths: number[], multipv = 2): number {
  const valid = depths.filter((depth) => finite(depth) && depth > 0);
  if (!valid.length) return 0;
  const average = valid.reduce((sum, depth) => sum + depth, 0) / valid.length;
  const depthScore = clamp((average - 6) / 18, 0, 1) * 75;
  const coverageScore = clamp(valid.length / Math.max(1, multipv), 0, 1) * 25;
  return Math.round(depthScore + coverageScore);
}

export function getRecommendedAnalysisDepth(rating: number, moveCount: number): number {
  const base = rating >= 2200 ? 20 : rating >= 1600 ? 18 : rating >= 1000 ? 16 : 14;
  const lengthAdjustment = moveCount > 80 ? 2 : moveCount > 50 ? 1 : 0;
  return clamp(base + lengthAdjustment, 12, 24);
}

export function getReviewAccuracyDelta(before: number, after: number): number {
  if (!finite(before) || !finite(after)) return 0;
  return after - before;
}

export function getSpecialMoveCounts(profile: PlayerProfile): { brilliant: number; missedWins: number } {
  return safeArray(profile.reviews).reduce((counts, review) => ({
    brilliant: counts.brilliant + review.brilliantMoves.length,
    missedWins: counts.missedWins + review.missedWins.length,
  }), { brilliant: 0, missedWins: 0 });
}


export function getRatingVolatility(profile: PlayerProfile, count = 10): number {
  const entries = safeArray(profile.history).slice(-Math.max(2, count));
  if (entries.length < 2) return 0;
  const changes = entries.map((entry) => entry.change).filter(finite);
  if (changes.length < 2) return 0;
  const mean = changes.reduce((sum, value) => sum + value, 0) / changes.length;
  return Math.sqrt(changes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / changes.length);
}

export function getPerformanceLabel(accuracy: number | null): string {
  if (accuracy === null) return "Пока нет данных";
  if (accuracy >= 90) return "Очень стабильно";
  if (accuracy >= 80) return "Уверенная игра";
  if (accuracy >= 70) return "Есть хорошая база";
  if (accuracy >= 55) return "Есть пространство для роста";
  return "Фокус на базовых ошибках";
}

export function getActivitySummary(profile: PlayerProfile): { reviews: number; sessions: number; solved: number; botGames: number } {
  return {
    reviews: safeArray(profile.reviews).length,
    sessions: safeArray(profile.trainingSessions).length,
    solved: getSolvedPuzzleCount(profile),
    botGames: safeArray(profile.history).length,
  };
}

export function formatSignedPercent(value: number | null): string {
  if (value === null || !finite(value)) return "—";
  return (value > 0 ? "+" : "") + value.toFixed(1) + "%";
}

export async function getStorageDiagnostics(): Promise<StorageDiagnostics> {
  let positionEntries = 0;
  let engineFiles = 0;
  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  const indexedDbAvailable = typeof indexedDB !== "undefined";
  const cacheApiAvailable = typeof caches !== "undefined";
  try { const db = await import("./db.ts"); positionEntries = await db.positionCacheSize(); } catch { /* Storage may be blocked. */ }
  try {
    if (cacheApiAvailable) {
      const cache = await caches.open("stockfish19-engine-v1");
      engineFiles = (await cache.keys()).length;
    }
  } catch { /* Cache API may be denied in private mode. */ }
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (finite(estimate?.usage)) usageBytes = estimate.usage;
    if (finite(estimate?.quota)) quotaBytes = estimate.quota;
  } catch { /* Storage estimate is optional. */ }
  const usagePercent = usageBytes !== null && quotaBytes ? clamp(usageBytes / quotaBytes * 100, 0, 100) : null;
  const health = usagePercent === null ? "unknown" : usagePercent >= 90 ? "critical" : usagePercent >= 70 ? "watch" : "healthy";
  return { positionEntries, engineFiles, usageBytes, quotaBytes, usagePercent, indexedDbAvailable, cacheApiAvailable, health };
}

export function getStorageHealthLabel(health: StorageDiagnostics["health"]): string {
  return health === "healthy" ? "Всё в порядке" : health === "watch" ? "Мало свободного места" : health === "critical" ? "Хранилище почти заполнено" : "Нет данных о квоте";
}

export async function clearAnalysisStorage(): Promise<void> {
  const { clearPositionCache } = await import("./db.ts");
  await clearPositionCache();
}

export async function clearDownloadedEngineStorage(): Promise<void> {
  const engineFiles = await import("./engineFiles.ts");
  await engineFiles.clearEngineCache();
}

async function measureEndpoint(id: EndpointHealth["id"], label: string, url: string, init?: RequestInit): Promise<EndpointHealth> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
    const latencyMs = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - started);
    return { id, label, ok: response.ok, latencyMs, detail: response.ok ? "Ответ получен" : "HTTP " + response.status };
  } catch (error) {
    const latencyMs = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - started);
    const detail = error instanceof Error && error.name === "AbortError" ? "Таймаут: сервер не ответил за 6 секунд" : "Сервер недоступен или соединение ограничено";
    return { id, label, ok: false, latencyMs, detail };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkOnlineServices(supabaseUrl: string): Promise<NetworkDiagnostics> {
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  if (!online) return { checkedAt: Date.now(), online: false, endpoints: [] };
  const siteUrl = typeof window !== "undefined" ? window.location.origin + "/" : "/";
  const endpoints: EndpointHealth[] = [];
  endpoints.push(await measureEndpoint("website", "Сайт CHESSMART", siteUrl, { method: "HEAD" }));
  const base = supabaseUrl.trim().replace(/\/+$/, "");
  if (base) {
    endpoints.push(await measureEndpoint("online-api", "Сервер онлайн-игры", base + "/functions/v1/game-action", {
      method: "OPTIONS",
    }));
  }
  return { checkedAt: Date.now(), online: endpoints.some((item) => item.ok), endpoints };
}

export function getNetworkSummary(diagnostics: NetworkDiagnostics | null): string {
  if (!diagnostics) return "Проверка ещё не запускалась";
  if (!diagnostics.online) return "Сетевые службы не ответили";
  const failed = diagnostics.endpoints.filter((item) => !item.ok);
  return failed.length ? "Часть служб недоступна" : "Все проверенные службы отвечают";
}

export function getNetworkLatencyLabel(latencyMs: number | null): string {
  if (latencyMs === null) return "—";
  if (latencyMs < 100) return "Отлично";
  if (latencyMs < 250) return "Хорошо";
  if (latencyMs < 600) return "Медленно";
  return "Высокая задержка";
}

export function getRetryDelay(attempt: number, baseMs = 500, maxMs = 12_000): number {
  const safeAttempt = clampSuiteNumber(attempt, 0, 10, 0);
  const base = clampSuiteNumber(baseMs, 100, 10_000, 500);
  const maximum = clampSuiteNumber(maxMs, base, 60_000, 12_000);
  return Math.min(maximum, base * (2 ** safeAttempt));
}

export function shouldRetryNetworkStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function getOnlinePollDelay(policy: {
  online: boolean;
  visible: boolean;
  consecutiveFailures: number;
  urgent?: boolean;
}): number {
  if (!policy.online || !policy.visible) return 5000;
  const failures = clampSuiteNumber(policy.consecutiveFailures, 0, 12, 0);
  if (failures > 0) return getRetryDelay(failures - 1, 800, 12_000);
  return policy.urgent ? 250 : 1000;
}

export function getConnectionQuality(latencyMs: number | null, online: boolean): "offline" | "good" | "fair" | "poor" | "unknown" {
  if (!online) return "offline";
  if (latencyMs === null) return "unknown";
  return latencyMs < 180 ? "good" : latencyMs < 500 ? "fair" : "poor";
}

export function buildSuiteShortcutMap(): Array<{ key: string; action: string }> {
  return [
    { key: "← / →", action: "Предыдущий / следующий ход" },
    { key: "↑ / Home", action: "Начало партии" },
    { key: "↓ / End", action: "Последняя позиция" },
    { key: "F", action: "Перевернуть доску" },
    { key: "?", action: "Справка по горячим клавишам" },
  ];
}

export function getSuiteLevelTitle(level: number): string {
  if (level >= 30) return "Легенда CHESSMART";
  if (level >= 20) return "Гроссмейстер прогресса";
  if (level >= 10) return "Тактический стратег";
  if (level >= 5) return "Уверенный игрок";
  return "Начинающий исследователь";
}

export function getQuestDestinationLabel(destination: SuiteQuestDefinition["destination"]): string {
  const labels: Record<SuiteQuestDefinition["destination"], string> = {
    review: "Анализ партий", puzzles: "Задачи", mistakes: "Мои ошибки", play: "Против компьютера", academy: "Академия",
  };
  return labels[destination];
}

export function getSuiteDashboardGreeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 6) return "Ночная смена шахматиста";
  if (hour < 12) return "Доброе утро, время тактики";
  if (hour < 18) return "Хороший момент для партии";
  return "Вечерний разбор — отличная привычка";
}
