export const ONLINE_TIME_CONTROL_OPTIONS = [
  { value: "1+0", type: "Bullet" },
  { value: "3+0", type: "Blitz" },
  { value: "5+0", type: "Blitz" },
  { value: "10+0", type: "Rapid" },
  { value: "15+10", type: "Rapid" },
] as const;

export type OnlineTimeControl = typeof ONLINE_TIME_CONTROL_OPTIONS[number]["value"];

const TIME_CONTROL_KEY = "chessmart:online-time-control:v1";
const RATED_KEY = "chessmart:online-rated:v1";
export const DEFAULT_ONLINE_TIME_CONTROL: OnlineTimeControl = "10+0";

export function loadSavedOnlineTimeControl(): OnlineTimeControl {
  try {
    const saved = localStorage.getItem(TIME_CONTROL_KEY);
    return ONLINE_TIME_CONTROL_OPTIONS.some((option) => option.value === saved)
      ? saved as OnlineTimeControl
      : DEFAULT_ONLINE_TIME_CONTROL;
  } catch {
    return DEFAULT_ONLINE_TIME_CONTROL;
  }
}

export function saveOnlineTimeControl(value: string): OnlineTimeControl {
  const safeValue = ONLINE_TIME_CONTROL_OPTIONS.some((option) => option.value === value)
    ? value as OnlineTimeControl
    : DEFAULT_ONLINE_TIME_CONTROL;
  try { localStorage.setItem(TIME_CONTROL_KEY, safeValue); }
  catch { /* local storage can be unavailable */ }
  return safeValue;
}

export function loadSavedOnlineRated(): boolean {
  try { return localStorage.getItem(RATED_KEY) !== "false"; }
  catch { return true; }
}

export function saveOnlineRated(value: boolean): void {
  try { localStorage.setItem(RATED_KEY, String(value)); }
  catch { /* local storage can be unavailable */ }
}
