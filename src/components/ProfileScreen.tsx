import { useMemo, useRef, useState } from "react";
import type { PlayerProfile, PuzzleRatingEntry } from "../lib/playerProfile";
import { updatePlayerName } from "../lib/playerProfile";
import { PHASE_LABELS, type GamePhase } from "../lib/learningStats";
import { sanRu } from "../lib/format";
import { downloadProfileBackup, parseProfileBackup } from "../lib/profileBackup";

interface Props {
  profile: PlayerProfile;
  onChange: (profile: PlayerProfile) => void;
  onBack: () => void;
}

function csvCell(value: string | number): string {
  const text = String(value ?? "");
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadProfileReport(profile: PlayerProfile): void {
  const rows: Array<Array<string | number>> = [
    ["Тип", "Дата", "Белые / игрок", "Чёрные / соперник", "Результат", "Ходы", "Точность белых", "Точность чёрных", "Средняя точность", "Дебют", "ECO", "Блестящие", "Упущенные шансы"],
    ...(profile.reviews ?? []).map((record) => [
      "Анализ партии", record.date, record.white, record.black, record.result, record.plies,
      record.accuracy.w.toFixed(1), record.accuracy.b.toFixed(1), record.accuracy.average.toFixed(1),
      record.opening?.name ?? "", record.opening?.eco ?? "", record.brilliantMoves.length, record.missedWins.length,
    ]),
    ...profile.history.map((entry) => [
      "Игра против бота", new Date(entry.at).toISOString(), profile.name, `Stockfish ${entry.botElo} Elo`,
      entry.result, "", "", "", "", "", "", "", "",
    ]),
    ...(profile.puzzleRatingHistory ?? []).map((entry) => [
      "Тренировка задач", new Date(entry.at).toISOString(), profile.name, `Puzzle ${entry.puzzleId}`,
      entry.solved ? "Решена" : "Подсказка", "", "", "", "", "", "", "", "",
    ]),
  ];
  const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `chessmart-statistics-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function RatingChart({ values }: { values: number[] }) {
  if (!values.length) return <div className="flex h-32 items-center justify-center text-xs text-[#77746f]">График появится после первой партии против бота.</div>;
  const width = 520;
  const height = 130;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(30, max - min);
  const y = (value: number) => height - 14 - ((value - (min - Math.max(0, spread * 0.08))) / (spread * 1.16)) * (height - 28);
  const points = values.map((value, index) => `${(values.length === 1 ? width / 2 : index / (values.length - 1) * width).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-32 w-full" role="img" aria-label="График рейтинга Elo">
        <line x1="0" x2={width} y1={height / 2} y2={height / 2} stroke="#4b4844" strokeDasharray="4 5" />
        <polyline points={points} fill="none" stroke="#a3d160" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {values.map((value, index) => <circle key={index} cx={values.length === 1 ? width / 2 : index / (values.length - 1) * width} cy={y(value)} r="3.5" fill="#a3d160" />)}
      </svg>
      <div className="flex justify-between text-[10px] text-[#77746f]"><span>{values.length} контрольных точек</span><span>{min}–{max} Elo</span></div>
    </div>
  );
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function PuzzleRatingChart({ entries, currentRating }: { entries: PuzzleRatingEntry[]; currentRating: number }) {
  if (!entries.length) {
    return <div className="flex h-32 items-center justify-center text-center text-xs text-[#77746f]">График появится после первых решённых задач.</div>;
  }
  const values = [1200, ...entries.slice(-30).map((entry) => entry.ratingAfter)];
  const width = 520;
  const height = 130;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(30, max - min);
  const y = (value: number) => height - 14 - ((value - (min - Math.max(0, spread * 0.08))) / (spread * 1.16)) * (height - 28);
  const points = values.map((value, index) => `${(values.length === 1 ? width / 2 : index / (values.length - 1) * width).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-32 w-full" role="img" aria-label="График puzzle rating">
        <line x1="0" x2={width} y1={height / 2} y2={height / 2} stroke="#4b4844" strokeDasharray="4 5" />
        <polyline points={points} fill="none" stroke="#59c9c0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {values.map((value, index) => <circle key={index} cx={values.length === 1 ? width / 2 : index / (values.length - 1) * width} cy={y(value)} r="3.5" fill="#59c9c0" />)}
      </svg>
      <div className="flex justify-between text-[10px] text-[#77746f]"><span>{entries.length} записей рейтинга</span><span>{min}–{max} Puzzle</span></div>
      <div className="mt-1 text-center text-xs text-[#a7a6a2]">Текущий рейтинг: <b className="text-[#59c9c0]">{currentRating}</b></div>
    </div>
  );
}

export function ProfileScreen({ profile, onChange, onBack }: Props) {
  const [name, setName] = useState(profile.name);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  const restoreBackup = async (file: File | undefined) => {
    if (!file) return;
    try {
      const restored = parseProfileBackup(await file.text());
      if (!window.confirm("Заменить текущий профиль данными из резервной копии? Текущие данные будут перезаписаны.")) return;
      onChange(restored);
      setName(restored.name);
      setBackupNotice("Профиль восстановлен из резервной копии");
    } catch (error) {
      setBackupNotice(`Ошибка: ${error instanceof Error ? error.message : "не удалось прочитать резервную копию"}`);
    }
  };
  const winRate = profile.games ? (profile.wins / profile.games) * 100 : 0;
  const ratingValues = [1000, ...profile.history.map((entry) => entry.ratingAfter)].slice(-31);
  const reviewRecords = profile.reviews ?? [];
  const averageAccuracies = reviewRecords.slice(-12);
  const brilliantTotal = reviewRecords.reduce((total, record) => total + record.brilliantMoves.length, 0);
  const missedTotal = reviewRecords.reduce((total, record) => total + record.missedWins.length, 0);
  const unsolved = (profile.puzzles ?? []).filter((puzzle) => !puzzle.solvedAt).length;
  const solved = (profile.puzzles ?? []).length - unsolved;
  const puzzleRatingHistory = profile.puzzleRatingHistory ?? [];
  const recentTrainingSessions = [...(profile.trainingSessions ?? [])].sort((a, b) => b.startedAt - a.startedAt).slice(0, 8);

  const activitySummary = useMemo(() => {
    const counts = new Map<string, number>();
    const addActivity = (timestamp: number) => {
      if (!Number.isFinite(timestamp)) return;
      const key = localDayKey(new Date(timestamp));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    };
    profile.history.forEach((entry) => addActivity(entry.at));
    reviewRecords.forEach((entry) => addActivity(entry.at));
    (profile.puzzles ?? []).forEach((puzzle) => { if (puzzle.solvedAt) addActivity(puzzle.solvedAt); });
    (profile.trainingSessions ?? []).forEach((session) => addActivity(session.startedAt));
    puzzleRatingHistory.forEach((entry) => addActivity(entry.at));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = localDayKey(today);
    const weekOffset = (today.getDay() + 6) % 7;
    const start = new Date(today);
    start.setDate(start.getDate() - weekOffset - 11 * 7);
    const days = Array.from({ length: 84 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = localDayKey(date);
      return { key, date, count: counts.get(key) ?? 0, future: date > today };
    });

    const last30 = new Date(today);
    last30.setDate(last30.getDate() - 29);
    const activeDays30 = [...counts.keys()].filter((key) => key >= localDayKey(last30) && key <= todayKey).length;

    let currentStreak = 0;
    const streakCursor = new Date(today);
    if (!counts.has(todayKey)) streakCursor.setDate(streakCursor.getDate() - 1);
    while (counts.has(localDayKey(streakCursor))) {
      currentStreak++;
      streakCursor.setDate(streakCursor.getDate() - 1);
    }

    const sortedDays = [...counts.keys()].sort();
    let longestStreak = 0;
    let runningStreak = 0;
    let previousDayNumber: number | null = null;
    for (const key of sortedDays) {
      const [year, month, day] = key.split("-").map(Number);
      const dayNumber = Date.UTC(year, month - 1, day);
      const consecutive = previousDayNumber !== null && dayNumber - previousDayNumber === 86400000;
      runningStreak = consecutive ? runningStreak + 1 : 1;
      longestStreak = Math.max(longestStreak, runningStreak);
      previousDayNumber = dayNumber;
    }
    return { days, activeDays30, currentStreak, longestStreak, totalActiveDays: counts.size };
  }, [profile.history, profile.puzzles, profile.trainingSessions, reviewRecords, puzzleRatingHistory]);

  const phaseTotals = useMemo(() => {
    const phases: Record<GamePhase, { wSum: number; wMoves: number; bSum: number; bMoves: number }> = {
      opening: { wSum: 0, wMoves: 0, bSum: 0, bMoves: 0 },
      middlegame: { wSum: 0, wMoves: 0, bSum: 0, bMoves: 0 },
      endgame: { wSum: 0, wMoves: 0, bSum: 0, bMoves: 0 },
    };
    for (const record of reviewRecords) {
      for (const phase of ["opening", "middlegame", "endgame"] as const) {
        const stat = record.phases[phase];
        phases[phase].wSum += stat.w.accuracy * stat.w.moves;
        phases[phase].wMoves += stat.w.moves;
        phases[phase].bSum += stat.b.accuracy * stat.b.moves;
        phases[phase].bMoves += stat.b.moves;
      }
    }
    return phases;
  }, [reviewRecords]);

  const openings = useMemo(() => {
    const grouped = new Map<string, { eco: string; name: string; games: number; whiteWins: number; blackWins: number; draws: number }>();
    for (const record of reviewRecords) {
      if (!record.opening) continue;
      const key = `${record.opening.eco}|${record.opening.name}`;
      const current = grouped.get(key) ?? { eco: record.opening.eco, name: record.opening.name, games: 0, whiteWins: 0, blackWins: 0, draws: 0 };
      current.games++;
      if (record.result === "1-0") current.whiteWins++;
      else if (record.result === "0-1") current.blackWins++;
      else if (record.result === "1/2-1/2") current.draws++;
      grouped.set(key, current);
    }
    return Array.from(grouped.values()).sort((a, b) => b.games - a.games).slice(0, 6);
  }, [reviewRecords]);

  const brilliantList = reviewRecords.slice().reverse().flatMap((record) =>
    record.brilliantMoves.map((move, index) => ({ ...move, game: `${record.white} — ${record.black}`, date: record.date, key: `${record.id}-${index}` }))
  ).slice(0, 20);

  return (
    <div className="min-h-screen bg-[#312e2b] p-4 text-white sm:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-5 flex items-center justify-between gap-3">
          <div><h1 className="text-2xl font-extrabold">Профиль игрока</h1><p className="text-sm text-[#a7a6a2]">Личный прогресс и статистика разобранных партий</p></div>
          <button onClick={onBack} className="rounded-lg bg-[#3d3a37] px-3 py-2 text-sm font-semibold hover:bg-[#4b4844]">Назад</button>
        </header>
        <section className="space-y-4 rounded-2xl bg-[#262421] p-5 shadow-xl sm:p-6">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[180px] flex-1"><span className="mb-1 block text-xs font-bold text-[#a7a6a2]">Имя игрока</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} className="w-full rounded-lg border border-[#4b4844] bg-[#1f1d1b] px-3 py-2 outline-none focus:border-[#81b64c]" /></label>
            <button onClick={() => onChange(updatePlayerName(profile, name))} className="rounded-lg bg-[#81b64c] px-4 py-2 font-bold text-[#17210f] hover:bg-[#95c75f]">Сохранить</button>
          </div>

          <section className="rounded-xl bg-[#2b2926] p-3">
            <div className="mb-1 font-extrabold">Резервная копия профиля</div>
            <p className="mb-3 text-xs leading-relaxed text-[#a7a6a2]">Сохрани рейтинг, историю партий, статистику и задачи в JSON-файл. Файл остаётся на твоём устройстве.</p>
            <p className="mb-3 text-xs leading-relaxed text-[#a7a6a2]">Выгрузи историю анализов и результаты игр в CSV — файл откроется в Excel и Google Sheets.</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => downloadProfileReport(profile)}
                className="rounded-lg bg-[#3d3a37] px-3 py-2 text-xs font-bold hover:bg-[#4b4844]"
              >
                Экспорт статистики CSV
              </button>
              <button
                onClick={() => downloadProfileBackup(profile)}
                className="rounded-lg bg-[#3d3a37] px-3 py-2 text-xs font-bold hover:bg-[#4b4844]"
              >
                Скачать резервную копию
              </button>
              <button
                onClick={() => backupInputRef.current?.click()}
                className="rounded-lg bg-[#3d3a37] px-3 py-2 text-xs font-bold hover:bg-[#4b4844]"
              >
                Восстановить из файла
              </button>
              <input
                ref={backupInputRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(event) => {
                  void restoreBackup(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
            </div>
            {backupNotice && <p role="status" aria-live="polite" className={`mt-2 text-xs ${backupNotice.startsWith("Ошибка:") ? "text-[#ffb4b2]" : "text-[#a3d160]"}`}>{backupNotice}</p>}
          </section>

          <div className="rounded-xl bg-[#1f1d1b] p-5 text-center">
            <div className="text-xs font-bold uppercase tracking-widest text-[#a7a6a2]">Текущий рейтинг</div>
            <div className="mt-1 text-5xl font-black tabular-nums text-[#a3d160]">{profile.rating}</div>
            <div className="mt-1 text-xs text-[#77746f]">Elo · винрейт {winRate.toFixed(1)}% против Stockfish</div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg bg-[#2b2926] p-3 text-center"><div className="text-2xl font-black">{profile.games}</div><div className="text-[11px] text-[#a7a6a2]">Партий с ботом</div></div>
            <div className="rounded-lg bg-[#2b2926] p-3 text-center"><div className="text-2xl font-black text-[#a3d160]">{profile.wins}</div><div className="text-[11px] text-[#a7a6a2]">Побед</div></div>
            <div className="rounded-lg bg-[#2b2926] p-3 text-center"><div className="text-2xl font-black text-[#f08b83]">{profile.losses}</div><div className="text-[11px] text-[#a7a6a2]">Поражений</div></div>
            <div className="rounded-lg bg-[#2b2926] p-3 text-center"><div className="text-2xl font-black text-[#d9c17b]">{profile.draws}</div><div className="text-[11px] text-[#a7a6a2]">Ничьих</div></div>
          </div>

          <section className="rounded-xl bg-[#2b2926] p-3">
            <div className="mb-2 flex items-center justify-between"><h2 className="font-extrabold">График рейтинга</h2><span className="text-xs text-[#a7a6a2]">Elo</span></div>
            <RatingChart values={ratingValues} />
          </section>

          <section className="rounded-xl bg-[#2b2926] p-3">
            <div className="mb-2 flex items-center justify-between"><h2 className="font-extrabold">Динамика Puzzle Rating</h2><span className="text-xs text-[#59c9c0]">Puzzle Elo</span></div>
            <PuzzleRatingChart entries={puzzleRatingHistory} currentRating={profile.puzzleRating ?? 1200} />
          </section>

          <section className="rounded-xl bg-[#2b2926] p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-extrabold">Календарь активности</h2><span className="text-[10px] text-[#a7a6a2]">последние 12 недель</span></div>
            <div className="mb-3 grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-[#1f1d1b] p-2 text-center"><div className="text-xl font-black text-[#a3d160]">{activitySummary.currentStreak}</div><div className="text-[9px] text-[#a7a6a2]">Дней подряд</div></div>
              <div className="rounded-lg bg-[#1f1d1b] p-2 text-center"><div className="text-xl font-black">{activitySummary.activeDays30}</div><div className="text-[9px] text-[#a7a6a2]">Активных дней / 30</div></div>
              <div className="rounded-lg bg-[#1f1d1b] p-2 text-center"><div className="text-xl font-black">{activitySummary.longestStreak}</div><div className="text-[9px] text-[#a7a6a2]">Лучшая серия</div></div>
            </div>
            <div className="grid grid-cols-7 gap-1.5 text-center">
              {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => <span key={day} className="pb-1 text-[9px] font-bold text-[#77746f]">{day}</span>)}
              {activitySummary.days.map((day) => (
                <div
                  key={day.key}
                  title={`${day.date.toLocaleDateString("ru-RU")}: ${day.count} событий активности`}
                  aria-label={`${day.date.toLocaleDateString("ru-RU")}: ${day.count} событий активности`}
                  className={`aspect-square rounded-[4px] ${day.count === 0 ? "bg-[#1f1d1b]" : day.count === 1 ? "bg-[#425437]" : day.count <= 3 ? "bg-[#6b8c4e]" : "bg-[#a3d160]"} ${day.future ? "opacity-25" : ""}`}
                />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[9px] text-[#77746f]">
              <span>{activitySummary.totalActiveDays} активных дней за всё время</span>
              <span>Меньше <i className="inline-block h-2.5 w-2.5 rounded-[2px] bg-[#1f1d1b] align-middle" /> <i className="inline-block h-2.5 w-2.5 rounded-[2px] bg-[#425437] align-middle" /> <i className="inline-block h-2.5 w-2.5 rounded-[2px] bg-[#6b8c4e] align-middle" /> <i className="inline-block h-2.5 w-2.5 rounded-[2px] bg-[#a3d160] align-middle" /> Больше</span>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-[#77746f]">Учитываются сыгранные партии с ботом, разборы PGN, решённые тренировочные позиции и сессии тренировки. Время берётся из локальной истории профиля.</p>
          </section>

          <section className="rounded-xl bg-[#2b2926] p-3">
            <div className="mb-2 flex items-center justify-between"><h2 className="font-extrabold">Последние тренировочные сессии</h2><span className="text-xs text-[#a7a6a2]">{recentTrainingSessions.length} из {profile.trainingSessions?.length ?? 0}</span></div>
            {recentTrainingSessions.length ? (
              <div className="space-y-1.5">
                {recentTrainingSessions.map((session) => (
                  <div key={session.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-[#1f1d1b] px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold">{new Date(session.startedAt).toLocaleString("ru-RU", { day: "numeric", month: "short", year: "numeric" })}</div>
                      <div className="mt-0.5 text-[10px] text-[#77746f]">{session.solved}/{session.total} задач · {Math.round(session.durationMs / 60000)} мин.</div>
                    </div>
                    <div className="text-right"><div className="text-sm font-black text-[#a3d160]">{session.accuracy}%</div><div className="text-[9px] text-[#77746f]">точность</div></div>
                  </div>
                ))}
              </div>
            ) : <div className="py-4 text-center text-xs text-[#77746f]">Здесь появятся результаты тренировок в разделе «Мои ошибки».</div>}
          </section>

          <section className="rounded-xl bg-[#2b2926] p-3">
            <div className="mb-2 flex items-center justify-between"><h2 className="font-extrabold">Точность по последним партиям</h2><span className="text-xs text-[#a7a6a2]">разобрано: {reviewRecords.length}</span></div>
            {averageAccuracies.length ? (
              <div className="flex h-28 items-end gap-2 border-b border-[#4b4844] pb-1">
                {averageAccuracies.map((record, index) => (
                  <div key={record.id} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${record.date}: ${record.accuracy.average.toFixed(1)}%`}>
                    <span className="text-[9px] tabular-nums text-[#a7a6a2]">{record.accuracy.average.toFixed(0)}%</span>
                    <div className="w-full max-w-8 rounded-t bg-[#81b64c]" style={{ height: `${Math.max(3, record.accuracy.average)}%` }} />
                    <span className="text-[9px] text-[#77746f]">{index + 1}</span>
                  </div>
                ))}
              </div>
            ) : <div className="py-6 text-center text-xs text-[#77746f]">Проанализируй несколько PGN-партий, чтобы увидеть динамику точности.</div>}
          </section>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg bg-[#2b2926] p-3"><div className="text-2xl font-black text-[#59c9c0]">{brilliantTotal}</div><div className="text-[11px] text-[#a7a6a2]">Блестящих ходов</div></div>
            <div className="rounded-lg bg-[#2b2926] p-3"><div className="text-2xl font-black text-[#ca8580]">{missedTotal}</div><div className="text-[11px] text-[#a7a6a2]">Упущенных шансов</div></div>
            <div className="rounded-lg bg-[#2b2926] p-3"><div className="text-2xl font-black text-[#a3d160]">{solved}</div><div className="text-[11px] text-[#a7a6a2]">Решено задач</div></div>
            <div className="rounded-lg bg-[#2b2926] p-3"><div className="text-2xl font-black">{unsolved}</div><div className="text-[11px] text-[#a7a6a2]">Задач осталось</div></div>
          </div>

          <section className="rounded-xl bg-[#2b2926] p-3">
            <h2 className="mb-2 font-extrabold">Точность по стадиям</h2>
            <div className="space-y-3">
              {(["opening", "middlegame", "endgame"] as const).map((phase) => {
                const s = phaseTotals[phase];
                const white = s.wMoves ? s.wSum / s.wMoves : 0;
                const black = s.bMoves ? s.bSum / s.bMoves : 0;
                return (
                  <div key={phase}>
                    <div className="mb-1 text-sm font-bold">{PHASE_LABELS[phase]}</div>
                    <div className="grid grid-cols-2 gap-2">
                      {(["w", "b"] as const).map((color) => {
                        const value = color === "w" ? white : black;
                        const count = color === "w" ? s.wMoves : s.bMoves;
                        return <div key={color}><div className="mb-1 flex justify-between text-[11px] text-[#a7a6a2]"><span>{color === "w" ? "Белые" : "Чёрные"}</span><b className="text-white">{count ? `${value.toFixed(1)}%` : "—"}</b></div><div className="h-1.5 overflow-hidden rounded-full bg-[#1f1d1b]"><div className="h-full bg-[#81b64c]" style={{ width: `${value}%` }} /></div></div>;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl bg-[#2b2926] p-3">
            <div className="mb-2 flex items-center justify-between"><h2 className="font-extrabold">Мои блестящие ходы</h2><span className="text-xs text-[#a7a6a2]">последние 20</span></div>
            {brilliantList.length ? <div className="max-h-72 space-y-1 overflow-y-auto">{brilliantList.map((move) => <div key={move.key} className="rounded-lg bg-[#1f1d1b] p-2"><div className="flex items-center justify-between gap-2"><b className="text-sm text-[#59c9c0]">{move.moveNumber}{move.color === "b" ? "…" : "."} {sanRu(move.san)}</b><span className="text-[10px] text-[#77746f]">{move.date}</span></div><div className="mt-0.5 text-[11px] text-[#a7a6a2]">{move.game}</div><div className="mt-1 text-xs text-[#dcdbd7]">{move.comment}</div></div>)}</div> : <p className="text-xs text-[#77746f]">Пока нет разобранных партий с ходами Brilliant.</p>}
          </section>

          <section className="rounded-xl bg-[#2b2926] p-3">
            <h2 className="mb-2 font-extrabold">Статистика дебютов</h2>
            {openings.length ? <div className="space-y-1">{openings.map((opening) => <div key={`${opening.eco}-${opening.name}`} className="flex items-center gap-2 rounded-lg bg-[#1f1d1b] px-3 py-2 text-xs"><span className="rounded bg-[#a88865]/25 px-1.5 py-1 font-bold text-[#d6b88f]">{opening.eco}</span><span className="min-w-0 flex-1 truncate">{opening.name}</span><b>{opening.games} игр</b><span className="text-[#77746f]">1-0: {opening.whiteWins} · ½: {opening.draws} · 0-1: {opening.blackWins}</span></div>)}</div> : <p className="text-xs text-[#77746f]">Дебютная статистика появится после анализа партий с распознанным дебютом.</p>}
          </section>

          <section className="rounded-xl bg-[#2b2926] p-3">
            <div className="mb-2 flex items-center justify-between"><h2 className="font-extrabold">Последние результаты против бота</h2><span className="text-xs text-[#77746f]">до 100 записей</span></div>
            <div className="max-h-64 overflow-y-auto rounded-lg bg-[#1f1d1b]">
              {profile.history.length ? [...profile.history].reverse().map((entry, index) => <div key={`${entry.at}-${index}`} className="flex items-center gap-2 border-b border-[#3d3a37] px-3 py-2 text-sm last:border-0"><span className={`w-20 font-bold ${entry.result === "win" ? "text-[#a3d160]" : entry.result === "loss" ? "text-[#f08b83]" : "text-[#d9c17b]"}`}>{entry.result === "win" ? "Победа" : entry.result === "loss" ? "Поражение" : "Ничья"}</span><span className="flex-1 text-xs text-[#a7a6a2]">Бот {entry.botElo} Elo</span><span className="text-xs tabular-nums text-[#77746f]">{entry.change > 0 ? `+${entry.change}` : "±0"}</span><b className="w-14 text-right tabular-nums">{entry.ratingAfter}</b></div>) : <div className="p-4 text-center text-sm text-[#77746f]">Сыграй первую партию, чтобы здесь появилась история.</div>}
            </div>
          </section>
          <p className="text-[11px] leading-relaxed text-[#77746f]">Статистика хранится локально в браузере. Точность по стадиям и агрегаты дебютов считаются по разобранным PGN; профиль не синхронизируется с Lichess или Chess.com.</p>
        </section>
      </div>
    </div>
  );
}
