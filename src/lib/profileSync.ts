import type { PlayerProfile } from "./playerProfile";
import { createProfileBackup, parseProfileBackup } from "./profileBackup";
import { isProfileBackupEnvelope } from "./profileSyncCore";

const SESSION_KEY = "chessmart:account-session:v2";

interface StoredSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string };
}

export interface CloudProgressVersion {
  revision: number;
  saved_at: string;
}

export interface CloudProgressSnapshot {
  revision: number;
  updated_at: string;
  payload: unknown;
}

export interface CloudProgressStatus {
  progress: CloudProgressSnapshot | null;
  versions: CloudProgressVersion[];
}

export class ProfileSyncError extends Error {
  status?: number;
  code?: "NO_SESSION" | "NOT_CONFIGURED" | "HTTP";

  constructor(message: string, options: { status?: number; code?: ProfileSyncError["code"] } = {}) {
    super(message);
    this.name = "ProfileSyncError";
    this.status = options.status;
    this.code = options.code;
  }
}

function getConfig(): { url: string; key: string } {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
  const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";
  if (!url || !key) throw new ProfileSyncError("Облачная синхронизация не настроена.", { code: "NOT_CONFIGURED" });
  return { url, key };
}

function readStoredSession(): StoredSession {
  let parsed: StoredSession | null = null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) parsed = JSON.parse(raw) as StoredSession;
  } catch {
    parsed = null;
  }
  if (!parsed?.access_token || !parsed.refresh_token || !parsed.user?.id) {
    throw new ProfileSyncError("Сначала войди в аккаунт CHESSMART.", { code: "NO_SESSION" });
  }
  return parsed;
}

async function getFreshSession(url: string, key: string): Promise<StoredSession> {
  let session = readStoredSession();
  if (session.expires_at > Date.now() + 60_000) return session;

  const response = await fetch(url + "/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  const data = await response.json().catch(() => ({})) as Partial<StoredSession> & { expires_in?: number; msg?: string };
  if (!response.ok || !data.access_token || !data.refresh_token || !data.user?.id) {
    throw new ProfileSyncError(data.msg || "Сессия истекла. Войди в аккаунт заново.", { status: response.status, code: "HTTP" });
  }
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
    user: data.user,
  };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ ...data, expires_at: session.expires_at })); } catch { /* storage may be unavailable */ }
  return session;
}

async function callProgressAction<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { url, key } = getConfig();
  const session = await getFreshSession(url, key);
  const response = await fetch(url + "/functions/v1/game-action", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: "Bearer " + session.access_token,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new ProfileSyncError(
      typeof data.error === "string" ? data.error : "Не удалось связаться с облачным хранилищем.",
      { status: response.status, code: "HTTP" },
    );
  }
  return data as T;
}

export function loadCloudProfileProgress(): Promise<CloudProgressStatus> {
  return callProgressAction<CloudProgressStatus>("load_progress");
}

export function saveCloudProfileProgress(
  profile: PlayerProfile,
  expectedRevision: number,
): Promise<{ revision: number; updatedAt: string }> {
  return callProgressAction("save_progress", {
    expectedRevision,
    backup: createProfileBackup(profile),
  });
}

export function restoreCloudProfileVersion(
  targetRevision: number,
  expectedRevision: number,
): Promise<{ revision: number; updatedAt: string; payload: unknown }> {
  return callProgressAction("restore_progress", { targetRevision, expectedRevision });
}

export function parseCloudProfile(payload: unknown): PlayerProfile {
  if (!isProfileBackupEnvelope(payload)) {
    throw new Error("Облачная резервная копия повреждена или имеет неподдерживаемый формат.");
  }
  return parseProfileBackup(JSON.stringify(payload));
}
