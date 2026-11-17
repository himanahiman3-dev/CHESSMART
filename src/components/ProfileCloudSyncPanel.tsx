import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlayerProfile } from "../lib/playerProfile";
import { downloadProfileBackup } from "../lib/profileBackup";
import { formatCloudTimestamp, formatProfileBytes, summarizeProfile } from "../lib/profileSyncCore";
import {
  loadCloudProfileProgress,
  parseCloudProfile,
  ProfileSyncError,
  restoreCloudProfileVersion,
  saveCloudProfileProgress,
  type CloudProgressSnapshot,
  type CloudProgressVersion,
} from "../lib/profileSync";

interface Props {
  profile: PlayerProfile;
  onChange: (profile: PlayerProfile) => void;
  onOpenAccount: () => void;
}

export function ProfileCloudSyncPanel({ profile, onChange, onOpenAccount }: Props) {
  const [cloud, setCloud] = useState<CloudProgressSnapshot | null>(null);
  const [versions, setVersions] = useState<CloudProgressVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const localSummary = useMemo(() => summarizeProfile(profile), [profile]);
  const cloudSummary = useMemo(() => {
    if (!cloud?.payload) return null;
    try { return summarizeProfile(parseCloudProfile(cloud.payload)); } catch { return null; }
  }, [cloud]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await loadCloudProfileProgress();
      setHasSession(true);
      setCloud(status.progress);
      setVersions(Array.isArray(status.versions) ? status.versions : []);
    } catch (reason) {
      if (reason instanceof ProfileSyncError && reason.code === "NO_SESSION") {
        setHasSession(false);
        setCloud(null);
        setVersions([]);
      } else if (reason instanceof ProfileSyncError && reason.status === 401) {
        setHasSession(false);
        setError("Сессия истекла. Войди в аккаунт заново.");
      } else {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveLocal = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const expectedRevision = cloud?.revision ?? 0;
      if (expectedRevision > 0 && !window.confirm(
        "Заменить текущую облачную копию локальным профилем? Предыдущая версия останется в истории восстановления."
      )) return;
      const result = await saveCloudProfileProgress(profile, expectedRevision);
      setNotice(`Облачная копия сохранена · версия ${result.revision}.`);
      await refresh();
    } catch (reason) {
      if (reason instanceof ProfileSyncError && reason.status === 409) {
        setError("Облачная версия изменилась на другом устройстве. Обнови состояние и проверь данные перед повторной записью.");
        await refresh();
      } else {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      setBusy(false);
    }
  };

  const restoreCurrent = () => {
    if (!cloud?.payload) return;
    let restored: PlayerProfile;
    try { restored = parseCloudProfile(cloud.payload); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return; }
    if (!window.confirm("Заменить локальный профиль облачной копией? Перед восстановлением текущий профиль будет скачан отдельным JSON-файлом.")) return;
    downloadProfileBackup(profile);
    onChange(restored);
    setNotice("Облачный профиль восстановлен. Локальная копия перед заменой скачана.");
  };

  const restoreVersion = async (version: CloudProgressVersion) => {
    if (!cloud) return;
    if (!window.confirm(`Восстановить облачную версию ${version.revision}? Текущий локальный профиль будет сохранён в JSON, а нынешняя облачная версия попадёт в историю.`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      downloadProfileBackup(profile);
      const result = await restoreCloudProfileVersion(version.revision, cloud.revision);
      onChange(parseCloudProfile(result.payload));
      setNotice(`Версия ${version.revision} восстановлена как новая облачная версия ${result.revision}.`);
      await refresh();
    } catch (reason) {
      if (reason instanceof ProfileSyncError && reason.status === 409) {
        setError("Облако уже обновлено на другом устройстве. Сначала обнови список версий.");
        await refresh();
      } else {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-[#4c5a42] bg-[#252d22] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-extrabold text-[#e1efcf]">Облачная синхронизация</h2>
          <p className="mt-1 text-xs leading-relaxed text-[#9eaa95]">Переноси рейтинг задач, разборы, ошибки и тренировочные сессии между устройствами.</p>
        </div>
        <span className="rounded-full border border-[#61784d] bg-[#34432d] px-2.5 py-1 text-[10px] font-bold text-[#d8edc4]">
          {loading ? "Проверяем…" : hasSession ? (cloud ? `Версия ${cloud.revision}` : "Нет копии") : "Нужен вход"}
        </span>
      </div>

      {hasSession === false && !loading ? (
        <div className="mt-3 rounded-lg bg-[#1f241c] p-3">
          <p className="text-xs text-[#b7c3ad]">Войди в аккаунт CHESSMART, чтобы сохранить локальный прогресс в облаке.</p>
          <button type="button" onClick={onOpenAccount} className="mt-2 rounded-lg bg-[#81b64c] px-3 py-2 text-xs font-extrabold text-[#17210f]">
            Открыть аккаунт
          </button>
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-[#1f241c] p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-[#8e9985]">На этом устройстве</div>
              <div className="mt-1 text-sm font-black text-white">{localSummary.games} партий · {localSummary.analyzedGames} разборов</div>
              <div className="mt-1 text-[10px] text-[#8e9985]">{localSummary.trainingPositions} позиций · {localSummary.trainingSessions} сессий · {formatProfileBytes(localSummary.serializedBytes)}</div>
            </div>
            <div className="rounded-lg bg-[#1f241c] p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-[#8e9985]">В облаке</div>
              {cloudSummary ? (
                <>
                  <div className="mt-1 text-sm font-black text-white">{cloudSummary.games} партий · {cloudSummary.analyzedGames} разборов</div>
                  <div className="mt-1 text-[10px] text-[#8e9985]">{cloudSummary.trainingPositions} позиций · {cloudSummary.trainingSessions} сессий · {formatProfileBytes(cloudSummary.serializedBytes)}</div>
                </>
              ) : <div className="mt-1 text-xs text-[#8e9985]">Облачная копия ещё не создана.</div>}
            </div>
          </div>

          {cloud && (
            <div className="mt-2 text-[10px] text-[#9eaa95]">
              Последнее сохранение: {formatCloudTimestamp(cloud.updated_at)}
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={loading || busy || hasSession !== true} onClick={() => void saveLocal()} className="rounded-lg bg-[#81b64c] px-3 py-2 text-xs font-extrabold text-[#17210f] disabled:opacity-40">
              {busy ? "Синхронизируем…" : "Сохранить в облако"}
            </button>
            <button type="button" disabled={loading || busy || !cloud?.payload} onClick={restoreCurrent} className="rounded-lg bg-[#3d4936] px-3 py-2 text-xs font-bold text-[#dce9d2] disabled:opacity-40">
              Загрузить из облака
            </button>
            <button type="button" disabled={loading || busy} onClick={() => void refresh()} className="rounded-lg border border-[#4a5841] px-3 py-2 text-xs font-bold text-[#c4d0ba] disabled:opacity-40">
              Обновить
            </button>
          </div>

          {versions.length > 0 && (
            <div className="mt-3 border-t border-[#3f4939] pt-3">
              <div className="mb-2 text-xs font-bold text-[#c8d5bf]">Предыдущие версии · последние 5</div>
              <div className="space-y-1.5">
                {versions.map((version) => (
                  <div key={version.revision} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#1f241c] px-3 py-2">
                    <span className="text-[10px] text-[#9eaa95]">Версия {version.revision} · {formatCloudTimestamp(version.saved_at)}</span>
                    <button type="button" disabled={busy || loading} onClick={() => void restoreVersion(version)} className="rounded-md border border-[#61784d] px-2.5 py-1 text-[10px] font-bold text-[#d8edc4] disabled:opacity-40">
                      Восстановить
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {error && <p role="alert" className="mt-3 rounded-lg border border-[#784943] bg-[#3d2927] p-2.5 text-xs text-[#ffc7c0]">{error}</p>}
      {notice && <p role="status" aria-live="polite" className="mt-3 rounded-lg border border-[#49613c] bg-[#293724] p-2.5 text-xs text-[#d8edc4]">{notice}</p>}
      <p className="mt-3 text-[10px] leading-relaxed text-[#7f8b75]">Локальный профиль не удаляется при сохранении. При восстановлении заранее скачивается резервная копия; облако хранит пять предыдущих версий.</p>
    </section>
  );
}
