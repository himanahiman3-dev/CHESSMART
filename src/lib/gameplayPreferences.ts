export type GameBoardTheme = "classic" | "blue" | "walnut" | "violet";
export interface GameplayPreferences {
  premovesEnabled: boolean; autoQueen: boolean; soundEnabled: boolean;
  showLegalMoves: boolean; highlightLastMove: boolean; boardAnimations: boolean;
  confirmResign: boolean; boardTheme: GameBoardTheme;
}
export const GAMEPLAY_PREFERENCES_KEY = "chessmart:gameplay-preferences:v1";
export const DEFAULT_GAMEPLAY_PREFERENCES: GameplayPreferences = {
  premovesEnabled: true, autoQueen: true, soundEnabled: true, showLegalMoves: true,
  highlightLastMove: true, boardAnimations: true, confirmResign: true, boardTheme: "classic",
};
export function isBoardTheme(value: unknown): value is GameBoardTheme {
  return value === "classic" || value === "blue" || value === "walnut" || value === "violet";
}
export function isBooleanPreference(value: unknown): value is boolean { return typeof value === "boolean"; }
export function normalizeGameplayPreferences(value: unknown): GameplayPreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ...DEFAULT_GAMEPLAY_PREFERENCES };
  const saved = value as Partial<GameplayPreferences>;
  return {
    premovesEnabled: isBooleanPreference(saved.premovesEnabled) ? saved.premovesEnabled : true,
    autoQueen: isBooleanPreference(saved.autoQueen) ? saved.autoQueen : true,
    soundEnabled: isBooleanPreference(saved.soundEnabled) ? saved.soundEnabled : true,
    showLegalMoves: isBooleanPreference(saved.showLegalMoves) ? saved.showLegalMoves : true,
    highlightLastMove: isBooleanPreference(saved.highlightLastMove) ? saved.highlightLastMove : true,
    boardAnimations: isBooleanPreference(saved.boardAnimations) ? saved.boardAnimations : true,
    confirmResign: isBooleanPreference(saved.confirmResign) ? saved.confirmResign : true,
    boardTheme: isBoardTheme(saved.boardTheme) ? saved.boardTheme : "classic",
  };
}
export function loadGameplayPreferences(): GameplayPreferences {
  try {
    const raw = localStorage.getItem(GAMEPLAY_PREFERENCES_KEY);
    return raw ? normalizeGameplayPreferences(JSON.parse(raw)) : { ...DEFAULT_GAMEPLAY_PREFERENCES };
  } catch { return { ...DEFAULT_GAMEPLAY_PREFERENCES }; }
}
export function saveGameplayPreferences(value: GameplayPreferences): GameplayPreferences {
  const normalized = normalizeGameplayPreferences(value);
  try { localStorage.setItem(GAMEPLAY_PREFERENCES_KEY, JSON.stringify(normalized)); } catch { /* private mode */ }
  return normalized;
}
export function updateGameplayPreferences(current: GameplayPreferences, patch: Partial<GameplayPreferences>): GameplayPreferences {
  return saveGameplayPreferences({ ...current, ...patch });
}
export function getBoardOrientation(playerColor: "w" | "b", flipped: boolean): "white" | "black" {
  return (playerColor === "w") !== flipped ? "white" : "black";
}
export function clockUrgency(ms: number): "normal" | "warning" | "critical" {
  if (!Number.isFinite(ms) || ms <= 10_000) return "critical";
  if (ms <= 30_000) return "warning";
  return "normal";
}
export function formatClock(ms: number, tenths = false): string {
  const safe = Math.max(0, Number.isFinite(ms) ? ms : 0);
  const ticks = Math.ceil(safe / 100);
  const seconds = Math.floor(ticks / 10);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (tenths && safe < 10_000) return `${minutes}:${String(remainder).padStart(2, "0")}.${ticks % 10}`;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
export function formatMoveNumber(ply: number): string {
  return ply % 2 === 0 ? `${Math.floor(Math.max(0, ply) / 2) + 1}.` : "";
}
export function shouldAskBeforeResign(enabled: boolean, active: boolean): boolean { return enabled && active; }
export function isActiveGame(status: string): boolean { return status === "active"; }
