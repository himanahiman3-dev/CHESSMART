import { useMemo, useState } from "react";
import { Chess, type Square } from "chess.js";
import { GameBoard, type BoardMove } from "./GameBoard";

type Destination = "puzzles" | "endgame" | "openings" | "lab" | "review" | "coach" | "diagnostics";
interface Lesson {
  id: string;
  title: string;
  duration: number;
  summary: string;
  explanation: string[];
  takeaway: string;
  fen?: string;
  move?: string;
  hint?: string;
  feature?: Destination;
  featureLabel?: string;
}
interface Course {
  id: string;
  level: string;
  title: string;
  subtitle: string;
  lessons: Lesson[];
}
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
const AFTER_NC6_NF6 = "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";
const COURSES: Course[] = [
  {
    id: "foundations", level: "Уровень 1", title: "Шахматный фундамент",
    subtitle: "Центр, развитие фигур и безопасность короля",
    lessons: [
      { id: "center", title: "Захвати центр", duration: 4, summary: "Почему центральные поля важнее края доски", explanation: ["Центр — это поля e4, d4, e5 и d5. Фигуры, которые влияют на центр, получают больше маршрутов и быстрее меняют направление атаки.", "Первый план в дебюте — занять или контролировать центр пешками и фигурами. Не нужно выдвигать все пешки подряд: каждая пешка оставляет слабости."], takeaway: "Занимай центр, но не забывай о развитии фигур.", fen: START, move: "e2e4", hint: "Центральная пешка с линии e делает шаг на два поля." },
      { id: "develop", title: "Развивай фигуры", duration: 5, summary: "Выведи лёгкую фигуру и подготовь рокировку", explanation: ["В дебюте кони и слоны должны выйти на активные поля. Не трать несколько темпов на одну фигуру без конкретной причины.", "Конь f3 контролирует e5 и d4, поддерживает центр и помогает подготовить короткую рокировку."], takeaway: "Развивай фигуры с угрозой и не двигай одну и ту же фигуру без необходимости.", fen: AFTER_E4_E5, move: "g1f3", hint: "Выведи коня с g1 на активное поле f3." },
      { id: "castle", title: "Спрячь короля", duration: 5, summary: "Используй рокировку, когда фигуры готовы", explanation: ["Рокировка одновременно уводит короля от центра и вводит ладью в игру. Обычно лучше не задерживать безопасность короля без причины.", "Перед рокировкой проверь, что король не проходит через атакованное поле и что между королём и ладьёй нет фигур."], takeaway: "Безопасный король и активная ладья — два результата одной рокировки.", fen: AFTER_NC6_NF6, move: "e1g1", hint: "Путь f1 и g1 свободен. Проверь, не атакованы ли поля рокировки." },
    ],
  },
  {
    id: "tactics", level: "Уровень 2", title: "Тактическое зрение",
    subtitle: "Вилки, матовые сети и превращение пешек",
    lessons: [
      { id: "fork", title: "Шахматная вилка", duration: 5, summary: "Одна фигура атакует сразу две цели", explanation: ["Вилка — двойное нападение. Особенно опасна вилка с шахом: соперник обязан спасать короля и часто теряет вторую цель.", "Перед ходом проверь, какие поля контролирует фигура после перемещения. Считай не только шах, но и ответ соперника."], takeaway: "Ищи двойные угрозы и считай, какую цель соперник не успеет защитить.", fen: "r3k3/8/N7/8/8/8/8/4K3 w - - 0 1", move: "a6c7", hint: "Конь может одновременно напасть на короля e8 и ладью a8." },
      { id: "back-rank", title: "Мат на последней горизонтали", duration: 5, summary: "Накажи короля, запертого своими пешками", explanation: ["Когда пешки перед королём не могут сдвинуться, последняя горизонталь превращается в ловушку.", "Ладья или ферзь могут использовать открытую линию. До комбинации проверь, есть ли у короля поле отхода и может ли соперник перекрыть шах."], takeaway: "Смотри на безопасные поля короля и не забывай о матовых угрозах.", fen: "7k/6pp/8/8/8/8/5PPP/5RK1 w - - 0 1", move: "f1f8", hint: "Ладья может проникнуть на восьмую горизонталь с шахом." },
      { id: "promotion", title: "Проведи пешку в ферзи", duration: 5, summary: "Превращение — решающий ресурс пешечного эндшпиля", explanation: ["Проходная пешка опасна, если соперник не может остановить её королём или фигурами.", "Считай квадрат пешки, расстояние короля и возможность превращения. Иногда превращение в коня или ладью сильнее ферзя, если это избегает пата или даёт шах."], takeaway: "Перед продвижением пешки рассчитай гонку до поля превращения.", fen: "8/P7/8/8/4k3/8/4K3/8 w - - 0 1", move: "a7a8q", hint: "Пешка уже на седьмой горизонтали. Продвинь её и выбери ферзя." },
    ],
  },
  {
    id: "strategy", level: "Уровень 3", title: "Позиционная игра",
    subtitle: "Планы, активность фигур и структура пешек",
    lessons: [
      { id: "piece-activity", title: "Активность важнее материала", duration: 6, summary: "Сравнивай не только количество фигур", explanation: ["Фигура сильна не сама по себе, а тем, сколько важных полей она контролирует и насколько быстро может участвовать в игре.", "Ладья на открытой линии, конь на устойчивом форпосте и слон на длинной диагонали часто сильнее пассивной фигуры того же номинала."], takeaway: "Перед разменом спроси себя: какая из моих фигур станет хуже после него?" },
      { id: "pawn-structure", title: "Пешечная структура", duration: 7, summary: "Находи слабости и создавай проходные пешки", explanation: ["Сдвоенные, изолированные и отсталые пешки могут стать долгосрочными целями. Но слабая пешка не всегда проигрывает: важны активность фигур и возможность контригры.", "Пешечные размены меняют структуру. Продвижение пешки необратимо, поэтому сначала оцени поля, которые она оставит позади."], takeaway: "Планируй пешечные ходы на несколько ходов вперёд, а не только по текущей угрозе." },
      { id: "opening-plan", title: "Построй дебютный репертуар", duration: 8, summary: "Учись понимать планы дебюта, а не зубрить варианты", explanation: ["Для каждого дебюта запомни типичную расстановку, пешечный центр и главные планы обеих сторон.", "После изучения варианта сыграй несколько тренировочных партий и проверь, понимаешь ли ты, почему фигуры стоят именно на этих полях."], takeaway: "Запоминай идеи и типовые планы. Варианты без понимания быстро забываются.", feature: "openings", featureLabel: "Открыть дебютную базу" },
    ],
  },
  {
    id: "mastery", level: "Уровень 4", title: "Расчёт и мастерство",
    subtitle: "Эндшпили, анализ и работа над ошибками",
    lessons: [
      { id: "endgame-technique", title: "Техника эндшпиля", duration: 8, summary: "Активизируй короля и реализуй преимущество", explanation: ["В эндшпиле король становится активной фигурой. Его централизация часто важнее пассивной защиты пешек.", "Считай темпы, оппозицию и квадрат проходной пешки. Не меняй все фигуры автоматически: оцени, какой эндшпиль выгоден."], takeaway: "Активный король — полноценная фигура. Практикуй типовые окончания.", feature: "endgame", featureLabel: "Открыть эндшпильную тренировку" },
      { id: "candidate-moves", title: "Считай варианты правильно", duration: 7, summary: "Проверяй шахи, взятия и прямые угрозы", explanation: ["Сначала собери несколько кандидатных ходов. Затем для каждого найди самый сильный ответ соперника, а не удобный для себя.", "Начинай расчёт с форсирующих ходов: шахи, взятия и угрозы. После каждого варианта проверь конечную позицию и материальный баланс."], takeaway: "Не останавливайся на первом красивом варианте — найди лучшую защиту соперника.", feature: "puzzles", featureLabel: "Решать тактические задачи" },
      { id: "game-review", title: "Разбирай собственные партии", duration: 8, summary: "Превращай ошибки в персональный план тренировок", explanation: ["Сначала разберись с партией самостоятельно: отметь моменты, где сомневался, и запиши свой план.", "Затем используй движок, чтобы найти критические ошибки. Не запоминай только лучший ход — пойми, какая идея была пропущена и как распознать её в следующей партии."], takeaway: "Каждый разбор должен завершаться конкретной темой для следующей тренировки.", feature: "review", featureLabel: "Открыть анализ партий" },
    ],
  },
];
const STORAGE_KEY = "chessmart:learning-path:v1";
function readCompleted(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}
function saveCompleted(value: string[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value.slice(-100))); } catch { /* progress remains optional */ }
}
function countDone(course: Course, completed: string[]): number {
  return course.lessons.filter((lesson) => completed.includes(lesson.id)).length;
}
function moveIsLegal(lesson: Lesson): boolean {
  if (!lesson.fen || !lesson.move) return true;
  try {
    const chess = new Chess(lesson.fen);
    const move = lesson.move;
    return !!chess.move({ from: move.slice(0, 2) as Square, to: move.slice(2, 4) as Square, promotion: move[4] as never });
  } catch { return false; }
}

export function LearningPathScreen({ onBack, onNavigate }: {
  onBack: () => void;
  onNavigate: (destination: Destination) => void;
}) {
  const [completed, setCompleted] = useState<string[]>(readCompleted);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [position, setPosition] = useState("");
  const [message, setMessage] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [filter, setFilter] = useState("all");
  const selected = COURSES.flatMap((course) => course.lessons).find((lesson) => lesson.id === selectedId) ?? null;
  const selectedCourse = COURSES.find((course) => course.lessons.some((lesson) => lesson.id === selectedId));
  const totalLessons = COURSES.reduce((sum, course) => sum + course.lessons.length, 0);
  const totalDone = completed.length;
  const progress = Math.round(totalDone / totalLessons * 100);
  const firstIncomplete = COURSES.flatMap((course) => course.lessons).find((lesson) => !completed.includes(lesson.id));
  const courseUnlocked = (index: number) => index === 0 || countDone(COURSES[index - 1], completed) >= 2;
  const visibleCourses = useMemo(() => filter === "all" ? COURSES : COURSES.filter((course) => course.id === filter), [filter]);

  const openLesson = (lesson: Lesson) => {
    if (!moveIsLegal(lesson)) {
      setMessage("В этой позиции найдено некорректное упражнение. Оно временно скрыто — сообщи об этом разработчику.");
      return;
    }
    setSelectedId(lesson.id);
    setPosition(lesson.fen ?? "");
    setShowHint(false);
    setMessage(completed.includes(lesson.id) ? "Урок уже пройден. Можешь повторить его для закрепления." : "Изучи идею, затем выполни задание на доске.");
  };
  const completeLesson = (id: string) => {
    setCompleted((current) => {
      const next = current.includes(id) ? current : [...current, id];
      saveCompleted(next);
      return next;
    });
    setMessage("Урок завершён. Прогресс сохранён в этом браузере.");
  };
  const handleMove = (move: BoardMove): boolean => {
    if (!selected?.move || !selected.fen || completed.includes(selected.id)) return false;
    if (move.uci !== selected.move) {
      setMessage("Не тот ход. Сравни кандидатные ходы и проверь идею урока.");
      return false;
    }
    try {
      const chess = new Chess(position || selected.fen);
      const played = chess.move({ from: move.from as Square, to: move.to as Square, promotion: (move.uci[4] ?? "q") as never });
      if (!played) return false;
      setPosition(chess.fen());
      completeLesson(selected.id);
      return true;
    } catch { return false; }
  };

  return (
    <div className="min-h-screen bg-[#1b241c] p-4 text-[#edf3e8] sm:p-7">
      <div className="mx-auto max-w-[1320px]">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[.2em] text-[#a8d17a]">CHESSMART LEARN</div>
            <h1 className="mt-1 text-2xl font-black sm:text-3xl">Шахматная школа</h1>
            <p className="mt-1 max-w-2xl text-sm text-[#a8b5a0]">Короткие уроки, интерактивные задания и понятный путь от первых ходов до самостоятельного анализа.</p>
          </div>
          <button onClick={onBack} className="rounded-xl border border-[#52634b] bg-[#293429] px-4 py-2.5 text-xs font-bold hover:bg-[#344232]">← Назад</button>
        </header>

        <section className="mb-5 rounded-3xl border border-[#516646] bg-gradient-to-br from-[#34472f] via-[#29382a] to-[#202d22] p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div><div className="text-[9px] font-black uppercase tracking-[.2em] text-[#bad89e]">ТВОЙ УЧЕБНЫЙ МАРШРУТ</div><div className="mt-2 text-3xl font-black tabular-nums">{totalDone}<span className="text-lg text-[#a5b79a]"> / {totalLessons}</span></div><div className="mt-1 text-xs text-[#b5c2aa]">уроков завершено · {progress}% программы</div></div>
            <div className="w-full max-w-sm"><div className="mb-2 flex justify-between text-[10px] font-bold text-[#c8d6bd]"><span>Общий прогресс</span><span>{progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-black/25"><div className="h-full rounded-full bg-[#a5d17c] transition-all" style={{ width: progress + "%" }} /></div>{firstIncomplete && <button onClick={() => openLesson(firstIncomplete)} className="mt-3 rounded-lg bg-[#a5d17c] px-4 py-2 text-xs font-black text-[#172315] hover:bg-[#b8e28e]">Продолжить обучение →</button>}</div>
          </div>
        </section>

        {!selected && (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <button onClick={() => setFilter("all")} className={"rounded-lg px-3 py-2 text-xs font-bold " + (filter === "all" ? "bg-[#9bc96e] text-[#182315]" : "bg-[#293629] text-[#afbea7]")}>Все уровни</button>
              {COURSES.map((course) => <button key={course.id} onClick={() => setFilter(course.id)} className={"rounded-lg px-3 py-2 text-xs font-bold " + (filter === course.id ? "bg-[#9bc96e] text-[#182315]" : "bg-[#293629] text-[#afbea7]")}>{course.level}</button>)}
            </div>
            <div className="space-y-4">
              {visibleCourses.map((course) => {
                const index = COURSES.findIndex((item) => item.id === course.id);
                const unlocked = courseUnlocked(index);
                const done = countDone(course, completed);
                return (
                  <section key={course.id} className={"rounded-2xl border p-4 sm:p-5 " + (unlocked ? "border-[#44563c] bg-[#253126]" : "border-white/[.06] bg-[#202720] opacity-65")}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div><div className="text-[9px] font-black uppercase tracking-[.17em] text-[#a7c48f]">{course.level} · {unlocked ? "Доступен" : "Откроется после предыдущего уровня"}</div><h2 className="mt-1 text-lg font-black">{course.title}</h2><p className="mt-1 text-xs text-[#9daa94]">{course.subtitle}</p></div>
                      <div className="rounded-xl border border-white/[.07] bg-black/15 px-3 py-2 text-center"><div className="text-lg font-black tabular-nums">{done}/{course.lessons.length}</div><div className="text-[9px] font-bold uppercase text-[#8f9c87]">уроков</div></div>
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                      {course.lessons.map((lesson, lessonIndex) => {
                        const lessonUnlocked = unlocked && (lessonIndex === 0 || completed.includes(course.lessons[lessonIndex - 1].id));
                        const finished = completed.includes(lesson.id);
                        return (
                          <button key={lesson.id} disabled={!lessonUnlocked} onClick={() => openLesson(lesson)} className={"rounded-xl border p-3 text-left transition " + (finished ? "border-[#6a9151] bg-[#30452d]" : lessonUnlocked ? "border-white/[.08] bg-[#1d281f] hover:border-[#8aa96d] hover:bg-[#2c3b2d]" : "border-white/[.04] bg-black/10 opacity-50")}>
                            <div className="flex items-center justify-between gap-2"><span className="text-[9px] font-extrabold uppercase tracking-wide text-[#95a78b]">Урок {lessonIndex + 1}</span><span className="text-[10px]">{finished ? "✓" : lessonUnlocked ? lesson.duration + " мин" : "🔒"}</span></div>
                            <div className="mt-2 text-sm font-extrabold text-[#e8f0e2]">{lesson.title}</div>
                            <p className="mt-1 text-[10px] leading-relaxed text-[#9aa895]">{lesson.summary}</p>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}

        {selected && selectedCourse && (
          <section className="rounded-3xl border border-[#465a3e] bg-gradient-to-br from-[#29382a] to-[#1f2b21] p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><button onClick={() => setSelectedId(null)} className="text-xs font-bold text-[#aac994] hover:text-white">← К программе</button><div className="mt-3 text-[9px] font-black uppercase tracking-[.17em] text-[#a8c68e]">{selectedCourse.level} · {selected.duration} минут</div><h2 className="mt-1 text-2xl font-black">{selected.title}</h2><p className="mt-1 text-sm text-[#a9b7a1]">{selected.summary}</p></div>
              {completed.includes(selected.id) && <div className="rounded-lg bg-[#415b35] px-3 py-2 text-xs font-black text-[#d9edc7]">Пройдено ✓</div>}
            </div>
            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-3">
                {selected.explanation.map((paragraph, index) => <div key={index} className="rounded-xl border border-white/[.06] bg-black/[.12] p-4 text-sm leading-relaxed text-[#d1ddc9]">{paragraph}</div>)}
                <div className="rounded-xl border border-[#6a8556]/35 bg-[#2b3d2a] p-4"><div className="text-[9px] font-black uppercase tracking-wide text-[#abc995]">Главная мысль</div><div className="mt-1 text-sm font-bold text-[#e1eed8]">{selected.takeaway}</div></div>
                {selected.feature && <button onClick={() => onNavigate(selected.feature!)} className="rounded-xl border border-[#75945d] bg-[#3b5133] px-4 py-3 text-xs font-extrabold text-[#e0efd5] hover:bg-[#4a6540]">{selected.featureLabel ?? "Открыть тренировку"} →</button>}
                {!selected.move && !completed.includes(selected.id) && <button onClick={() => completeLesson(selected.id)} className="rounded-xl bg-[#a5d17c] px-4 py-3 text-xs font-black text-[#172315] hover:bg-[#b8e28e]">Отметить урок пройденным</button>}
                {selected.move && completed.includes(selected.id) && <button onClick={() => { setPosition(selected.fen ?? ""); setMessage("Повторное прохождение. Найди тот же правильный ход."); }} className="rounded-xl border border-white/[.12] px-4 py-2 text-xs font-bold text-[#c4d1bd]">Повторить задание</button>}
                <div className="rounded-xl border border-white/[.06] bg-black/10 p-3 text-xs text-[#b5c3ad]">{message}</div>
              </div>
              <aside className="space-y-3">
                {selected.move && selected.fen && <>
                  <div className="rounded-2xl border border-white/[.08] bg-[#18231a] p-3">
                    <div className="mb-2 flex items-center justify-between gap-2"><span className="text-xs font-extrabold">Практическое задание</span><span className="text-[9px] font-bold uppercase text-[#99b18a]">{completed.includes(selected.id) ? "Решено" : "Белые ходят"}</span></div>
                    <GameBoard fen={position || selected.fen} orientation="white" interactive={!completed.includes(selected.id)} allowedColor="w" onMove={handleMove} />
                    {!completed.includes(selected.id) && <button onClick={() => { setShowHint(true); setMessage(selected.hint ?? "Проверь шахи, взятия и угрозы."); }} className="mt-3 w-full rounded-lg border border-[#526b46] bg-[#2d402a] px-3 py-2 text-xs font-bold text-[#d4e5c9]">Подсказка</button>}
                    {showHint && <div className="mt-2 rounded-lg bg-[#34472d] p-2 text-xs text-[#d7e8c9]">{selected.hint}</div>}
                  </div>
                </>}
                <div className="rounded-xl border border-white/[.06] bg-[#18231a] p-3"><div className="text-[9px] font-black uppercase tracking-wide text-[#8fa387]">Твой прогресс в курсе</div><div className="mt-1 text-2xl font-black tabular-nums">{countDone(selectedCourse, completed)}/{selectedCourse.lessons.length}</div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/30"><div className="h-full rounded-full bg-[#9bc96e]" style={{ width: (countDone(selectedCourse, completed) / selectedCourse.lessons.length * 100) + "%" }} /></div></div>
              </aside>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
