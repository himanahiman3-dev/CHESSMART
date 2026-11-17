export interface AccountProfile {
  user_id: string;
  username: string;
  avatar_url?: string | null;
  bullet_rating: number;
  blitz_rating: number;
  rapid_rating: number;
  bullet_games: number;
  blitz_games: number;
  rapid_games: number;
}

export const ACCOUNT_PROFILE_KEY = "chessmart:account-profile:v1";
export const ACCOUNT_PROFILE_EVENT = "chessmart:account-profile-changed";

export function readAccountProfile(): AccountProfile | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_PROFILE_KEY);
    if (!raw) return null;
    const profile = JSON.parse(raw) as AccountProfile;
    return profile?.user_id && profile?.username ? profile : null;
  } catch {
    return null;
  }
}

export function publishAccountProfile(profile: AccountProfile): void {
  try { localStorage.setItem(ACCOUNT_PROFILE_KEY, JSON.stringify(profile)); } catch { /* storage may be unavailable */ }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<AccountProfile | null>(ACCOUNT_PROFILE_EVENT, { detail: profile }));
  }
}

export function clearAccountProfile(): void {
  try { localStorage.removeItem(ACCOUNT_PROFILE_KEY); } catch { /* storage may be unavailable */ }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<AccountProfile | null>(ACCOUNT_PROFILE_EVENT, { detail: null }));
  }
}
