import { useEffect, useMemo, useState } from "react";
import type { PlayerProfile, TrainingPuzzle } from "../lib/playerProfile";
import { markPuzzleSolved, recordPuzzleAttempt } from "../lib/playerProfile";
import { classifyGamePhase, PHASE_LABELS, type GamePhase } from "../lib/learningStats";
import {
  getRussianVoices,
  loadCoachVoicePreferences,
  saveCoachVoicePreferences,
  speakCoachText,
  type CoachVoicePreferences,
} from "../lib/speech";
import { playSound } from "../lib/sound";
import { GameBoard, type BoardMove } from "./GameBoard";

interface Props {
  profile: PlayerProfile;
  onChange: (profile: PlayerProfile) => void;
  onBack: () => void;
}

const PHASES: GamePhase[] = ["opening", "middlegame", "endgame"];
const PHASE_HINTS: Record<GamePhase, string> = {
  opening: "Развивай фигуры, борись за центр и не трать темпы на повторные ходы одной фигурой.",
  middlegame: "Перед каждым ходом проверяй шахи, взятия и угрозы соперника. Ищи тактические ресурсы обеих сторон.",
  endgame: "Активируй короля, создавай проходные пешки и считай пешечные гонки до конца.",
};
const CLASS_LABELS: Record<TrainingPuzzle["cls"], string> = {
  inaccuracy: "Неточности",
  mistake: "Ошибки",
  miss: "Упущенные возможности",
  blunder: "Зевки",
};
const CLASS_WEIGHTS: Record<TrainingPuzzle["cls"], number> = {
  inaccuracy: 1,
  mistake: 2,
  miss: 2.5,
  blunder: 4,
};

function phaseStats(profile: PlayerProfile) {
  const totals: Record<GamePhase, { sum: number; moves: number }> = {
    opening: { sum: 0, moves: 0 },
    middlegame: { sum: 0, moves: 0 },
    endgame: { sum: 0, moves: 0 },
  };
  for (const review of profile.reviews) {
    for (const phase of PHASES) {
      const item = review.phases?.[phase];
      if (!item) continue;
      for (const side of ["w", "b"] as const) {
        const moves = Number(item[side]?.moves ?? 0);
        const accuracy = Number(item[side]?.accuracy ?? 0);
        if (moves > 0 && Number.isFinite(accuracy)) {
          totals[phase].sum += accuracy * moves;
          totals[phase].moves += moves;
        }
      }
    }
  }
  return PHASES.map((phase) => ({
    phase,
    accuracy: totals[phase].moves ? totals[phase].sum / totals[phase].moves : 0,
    moves: totals[phase].moves,
  }));
}

function puzzlePriority(puzzle: TrainingPuzzle): number {
  const weight = CLASS_WEIGHTS[puzzle.cls];
  const age = Math.max(0, Date.now() - puzzle.createdAt);
  return weight * 1000 + Math.max(0, 100 - age / 86_400_000);
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-[#41423b] bg-[#292a25] p-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#92938a]">{label}</div>
      <div className="mt-2 text-3xl font-black tabular-nums text-white">{value}</div>
      <div className="mt-1 text-xs text-[#a7a89e]">{detail}</div>
    </div>
  );
}

export function PersonalCoachScreen({ profile, onChange, onBack }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<"idle" | "wrong" | "solved">("idle");
  const [solutionShown, setSolutionShown] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState<CoachVoicePreferences>(() => loadCoachVoicePreferences());
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [voiceSupported, setVoiceSupported] = useState(true);

  const unsolved = useMemo(
    () => profile.puzzles.filter((puzzle) => !puzzle.solvedAt).sort((a, b) => puzzlePriority(b) - puzzlePriority(a)),
    [profile.puzzles],
  );
  const current = profile.puzzles.find((puzzle) => puzzle.id === selectedId)
    ?? unsolved[0]
    ?? profile.puzzles[profile.puzzles.length - 1]
    ?? null;
  const phases = useMemo(() => phaseStats(profile), [profile.reviews]);
  const availablePhases = phases.filter((item) => item.moves > 0);
  const weakestPhase = [...availablePhases].sort((a, b) => a.accuracy - b.accuracy)[0];
  const classStats = useMemo(() => {
    const counts: Record<TrainingPuzzle["cls"], number> = {
      inaccuracy: 0, mistake: 0, miss: 0, blunder: 0,
    };
    for (const puzzle of profile.puzzles) counts[puzzle.cls] += 1;
    return Object.entries(counts)
      .map(([cls, count]) => ({ cls: cls as TrainingPuzzle["cls"], count, weight: count * CLASS_WEIGHTS[cls as TrainingPuzzle["cls"]] }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.weight - a.weight);
  }, [profile.puzzles]);
  const solved = profile.puzzles.filter((puzzle) => !!puzzle.solvedAt).length;
  const averageAccuracy = profile.reviews.length
    ? profile.reviews.reduce((sum, item) => sum + item.accuracy.average, 0) / profile.reviews.length
    : 0;
  const focusTitle = classStats[0]
    ? "Сократить количество: " + CLASS_LABELS[classStats[0].cls].toLowerCase()
    : weakestPhase
      ? "Подтянуть стадию: " + PHASE_LABELS[weakestPhase.phase].toLowerCase()
      : "Разобрать первую партию";
  const focusDescription = classStats[0]
    ? "В твоих разборах чаще всего встречаются " + CLASS_LABELS[classStats[0].cls].toLowerCase() + ". Тренер собрал позиции из этих партий — решай их, пока типичная ошибка не перестанет повторяться."
    : weakestPhase
      ? PHASE_HINTS[weakestPhase.phase]
      : "Импортируй PGN и запусти анализ. Тренер найдёт повторяющиеся ошибки и превратит их в персональные упражнения.";

  useEffect(() => {
    setFeedback("idle");
    setSolutionShown(false);
  }, [current?.id]);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setVoiceSupported(false);
      return;
    }
    const refresh = () => setVoices(getRussianVoices());
    refresh();
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", refresh);
  }, []);

  const chooseVoiceSetting = (next: CoachVoicePreferences) => {
    setVoiceSettings(next);
    saveCoachVoicePreferences(next);
    setVoiceStatus("");
  };

  const previewVoice = () => {
    const ok = speakCoachText(
      "Привет. Давай спокойно разберём позицию. Сначала оцени угрозы соперника, затем найди самый сильный план.",
      voiceSettings,
    );
    setVoiceStatus(ok ? "Тестовая фраза запущена." : "Браузер не смог запустить озвучку. Проверь доступные голоса Windows.");
  };

  const handleMove = (move: BoardMove): boolean => {
    if (!current || current.solvedAt || feedback === "solved") return false;
    if (move.uci === current.bestUci) {
      setFeedback("solved");
      onChange(markPuzzleSolved(profile, current.id));
      playSound("correct");
      return true;
    }
    onChange(recordPuzzleAttempt(profile, current.id));
    setFeedback("wrong");
    playSound("wrong");
    return false;
  };

  const nextPuzzle = () => {
    const next = unsolved.find((puzzle) => puzzle.id !== current?.id);
    if (next) {
      setSelectedId(next.id);
      setFeedback("idle");
      setSolutionShown(false);
    } else {
      setSelectedId(null);
      setFeedback("idle");
      setSolutionShown(false);
    }
  };

  const formatVoiceName = (voice: SpeechSynthesisVoice) =>
    voice.name + (voice.default ? " · системный" : "") + " (" + voice.lang + ")";

  return (
    <div className="min-h-screen bg-[#242522] p-4 text-white sm:p-7">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-md border border-[#587345] bg-[#34442c] px-2 py-1 text-[9px] font-black uppercase tracking-[0.15em] text-[#d9edc4]">Personal Coach</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#77786f]">Твой шахматный прогресс</span>
            </div>
            <h1 className="text-2xl font-black sm:text-3xl">Тренер, который знает твои ошибки</h1>
            <p className="mt-1 max-w-2xl text-sm text-[#a7a89e]">Не случайные советы, а тренировки из позиций, которые Stockfish уже нашёл в твоих разборах.</p>
          </div>
          <button onClick={onBack} className="rounded-lg bg-[#34352f] px-3 py-2 text-sm font-bold text-[#dcdbd7] hover:bg-[#41423b]">← Назад</button>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Разобрано партий" value={String(profile.reviews.length)} detail="Локальная история анализов" />
          <StatCard label="Средняя точность" value={profile.reviews.length ? averageAccuracy.toFixed(1) + "%" : "—"} detail="По партиям в истории" />
          <StatCard label="Твои учебные позиции" value={String(profile.puzzles.length)} detail="Из неточностей, ошибок и зевков" />
          <StatCard label="Упражнения решены" value={solved + " / " + profile.puzzles.length} detail={unsolved.length + " ждут повторения"} />
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
          <div className="rounded-2xl border border-[#4b5940] bg-gradient-to-br from-[#303b2a] to-[#292a25] p-5 shadow-xl shadow-black/10">
            <div className="text-[10px] font-black uppercase tracking-[0.17em] text-[#a3d160]">Главный фокус</div>
            <h2 className="mt-2 text-xl font-black text-white sm:text-2xl">{focusTitle}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#d1d7c8]">{focusDescription}</p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-black/20 px-3 py-2 text-xs font-bold text-[#d9edc4]">План на сегодня · 10 минут</span>
              <span className="rounded-lg bg-black/20 px-3 py-2 text-xs text-[#c0c5b7]">5 личных позиций + разбор повторяющихся ошибок</span>
            </div>
          </div>

          <div className="rounded-2xl border border-[#41423b] bg-[#292a25] p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-extrabold">Точность по стадиям</h2>
              <span className="text-[10px] text-[#85867e]">Из всех разборов</span>
            </div>
            <div className="space-y-4">
              {phases.map((item) => (
                <div key={item.phase}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                    <span className="font-semibold text-[#d7d7d0]">{PHASE_LABELS[item.phase]}</span>
                    <span className="tabular-nums text-[#b9c5aa]">{item.moves ? item.accuracy.toFixed(1) + "%" : "Нет данных"}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#1d1e1b]">
                    <div className="h-full rounded-full bg-[#81b64c]" style={{ width: item.moves ? item.accuracy + "%" : "0%" }} />
                  </div>
                  <div className="mt-1 text-[10px] text-[#77786f]">{item.moves} ходов в выборке</div>
                </div>
              ))}
            </div>
            {weakestPhase && <p className="mt-4 rounded-lg bg-[#20211e] p-3 text-xs leading-relaxed text-[#bfc5b5]">Зона внимания: <b className="text-[#d9edc4]">{PHASE_LABELS[weakestPhase.phase]}</b>. {PHASE_HINTS[weakestPhase.phase]}</p>}
          </div>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)]">
          <div className="rounded-2xl border border-[#41423b] bg-[#292a25] p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-black">Повторяющиеся ошибки</h2>
                <p className="text-xs text-[#92938a]">Считаем позиции, которые Stockfish сохранил из твоих разборов</p>
              </div>
            </div>
            {classStats.length ? (
              <div className="space-y-3">
                {classStats.map((item) => (
                  <div key={item.cls}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="font-semibold text-[#d7d7d0]">{CLASS_LABELS[item.cls]}</span>
                      <span className="tabular-nums text-[#a3d160]">{item.count}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[#1d1e1b]">
                      <div className="h-full rounded-full bg-[#b18b51]" style={{ width: Math.max(5, item.count / Math.max(1, profile.puzzles.length) * 100) + "%" }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl bg-[#20211e] p-5 text-sm leading-relaxed text-[#a7a89e]">
                Пока нет материала для персонального диагноза. Импортируй PGN во вкладке «Анализ партий», запусти Stockfish — найденные ошибки появятся здесь автоматически.
              </div>
            )}
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl bg-[#20211e] p-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-[#85867e]">Самые опасные ошибки</div>
                <div className="mt-1 text-sm font-extrabold text-white">{classStats[0] ? CLASS_LABELS[classStats[0].cls] : "Пока не определены"}</div>
              </div>
              <div className="rounded-xl bg-[#20211e] p-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-[#85867e]">Всего попыток в задачах</div>
                <div className="mt-1 text-sm font-extrabold text-white">{profile.puzzles.reduce((sum, puzzle) => sum + puzzle.attempts, 0)}</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#41423b] bg-[#292a25] p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-black">Персональная тренировка</h2>
                <p className="text-xs text-[#92938a]">Решай реальные позиции из прошлых партий</p>
              </div>
              <span className="rounded-md bg-[#20211e] px-2 py-1 text-[10px] font-bold text-[#b9c5aa]">{unsolved.length} не решено</span>
            </div>
            {current ? (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-[#e4e5dc]">Найди лучший ход за {current.color === "w" ? "белых" : "чёрных"}</span>
                  <span className="rounded-md bg-[#20211e] px-2 py-1 text-[#c8c8bf]">{CLASS_LABELS[current.cls]} · ход {current.moveNumber}</span>
                </div>
                <GameBoard
                  fen={current.fen}
                  orientation={current.color === "w" ? "white" : "black"}
                  animKey={current.moveNumber + (feedback === "solved" ? 1 : 0)}
                  interactive={!current.solvedAt && feedback !== "solved"}
                  allowedColor={current.color}
                  onMove={handleMove}
                />
                <div className={"mt-3 rounded-lg p-3 text-xs leading-relaxed " + (feedback === "solved" || current.solvedAt ? "bg-[#2f3a28] text-[#cfe7ac]" : feedback === "wrong" ? "bg-[#4a2927] text-[#ffb4b2]" : "bg-[#20211e] text-[#c5c7bd]")}>
                  {feedback === "solved" || current.solvedAt
                    ? "Верно. Лучший ход: " + (current.bestSan ?? current.bestUci) + ". Повтори идею и найди её в следующей позиции."
                    : feedback === "wrong"
                      ? "Не этот ход. Позиция осталась прежней — проверь шахи, взятия и угрозы."
                      : "Это позиция из твоего разбора. Найди ход, который движок выбрал вместо сыгранного."}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => setSolutionShown((value) => !value)} disabled={!!current.solvedAt || feedback === "solved"} className="rounded-lg bg-[#3b3d35] px-3 py-2 text-xs font-bold text-[#dedfd7] hover:bg-[#484a40] disabled:opacity-40">
                    {solutionShown ? "Скрыть ответ" : "Показать ответ"}
                  </button>
                  <button onClick={nextPuzzle} disabled={!unsolved.some((puzzle) => puzzle.id !== current.id)} className="rounded-lg bg-[#81b64c] px-3 py-2 text-xs font-extrabold text-[#17210f] hover:bg-[#95c75f] disabled:opacity-40">
                    Следующая позиция →
                  </button>
                </div>
                {solutionShown && <div className="mt-2 rounded-lg bg-[#20211e] p-3 text-xs text-[#cfe7ac]">Лучший ход: <b>{current.bestSan ?? current.bestUci}</b></div>}
                <div className="mt-2 text-[10px] text-[#77786f]">Источник: {current.sourceGame} · твоя попытка: {current.attempts}</div>
              </>
            ) : (
              <div className="rounded-xl bg-[#20211e] p-5 text-sm leading-relaxed text-[#a7a89e]">
                Отлично, очередь чистая. Чтобы добавить новые персональные задачи, разбери ещё одну партию — тренер автоматически соберёт позиции с ошибками и упущенными возможностями.
              </div>
            )}
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-[#41423b] bg-[#292a25] p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.15em] text-[#a3d160]">Голос тренера</div>
              <h2 className="mt-1 text-lg font-black">Настрой живую озвучку комментариев</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[#92938a]">Выбери доступный русский голос Windows или браузера и проверь его на фразе тренера. Самые естественные голоса обычно помечены Natural или Online, если они установлены в системе.</p>
            </div>
            <button onClick={previewVoice} disabled={!voiceSupported} className="rounded-lg bg-[#81b64c] px-4 py-2.5 text-xs font-extrabold text-[#17210f] hover:bg-[#95c75f] disabled:opacity-40">▶ Прослушать голос</button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
            <label className="text-xs font-bold text-[#c9cbc0]">
              Голос
              <select
                value={voiceSettings.voiceURI}
                onChange={(event) => chooseVoiceSetting({ ...voiceSettings, voiceURI: event.target.value })}
                disabled={!voiceSupported}
                className="mt-2 w-full rounded-lg border border-[#4b4d44] bg-[#20211e] px-3 py-2.5 text-xs text-white outline-none focus:border-[#81b64c]"
              >
                <option value="">Автоматически · лучший доступный</option>
                {voices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{formatVoiceName(voice)}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-[#c9cbc0]">
              Темп · {voiceSettings.rate.toFixed(2)}×
              <input type="range" min="0.82" max="1.08" step="0.02" value={voiceSettings.rate} onChange={(event) => chooseVoiceSetting({ ...voiceSettings, rate: Number(event.target.value) })} className="mt-4 w-full accent-[#81b64c]" />
            </label>
            <label className="text-xs font-bold text-[#c9cbc0]">
              Высота голоса · {voiceSettings.pitch.toFixed(2)}
              <input type="range" min="0.82" max="1.08" step="0.02" value={voiceSettings.pitch} onChange={(event) => chooseVoiceSetting({ ...voiceSettings, pitch: Number(event.target.value) })} className="mt-4 w-full accent-[#81b64c]" />
            </label>
          </div>
          <div className="mt-3 text-[11px] text-[#a7a89e]" aria-live="polite">
            {!voiceSupported ? "В этом браузере нет поддержки Web Speech." : voices.length ? voices.length + " русских голосов найдено на этом устройстве." : "Русские голоса ещё загружаются. Если список пуст, установи русский голос в настройках Windows."}
            {voiceStatus ? " " + voiceStatus : ""}
          </div>
        </section>

        <footer className="mt-5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#77786f]">
          <span>Тренер использует локальную историю разборов этого браузера.</span>
          <span>Больше разобранных партий → точнее персональные рекомендации.</span>
        </footer>
      </div>
    </div>
  );
}
