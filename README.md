# CHESSMART — шахматная платформа со Stockfish 19

React + TypeScript + Vite + Tailwind CSS. Анализ партий, Stockfish 19 (WASM), дебютная база ECO и локальные тренировки работают в браузере. Сетевые партии с друзьями используют отдельный сервер Supabase и включаются после настройки backend.

## Запуск

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # сборка в dist/
npm run preview
```

## Дерево проекта

```
├─ index.html
├─ render.yaml                 # Render Blueprint для Docker Web Service
├─ public/
│  ├─ _headers                 # COOP/COEP для Netlify/Cloudflare/Render-совместимых хостингов
│  ├─ coi-serviceworker.js     # страховка: добавляет COOP/COEP на клиенте
│  └─ engine/                  # локальные копии Stockfish 19 Lite (≈3 МБ), GPL-3.0
├─ docs/vite.config.coop-coep.example.ts   # vite.config с server/preview.headers
└─ src/
   ├─ App.tsx, main.tsx, types.ts
   ├─ hooks/useEngine.tsx      # состояние движка, автозапуск из кэша, fallback threaded → single
   ├─ lib/
   │  ├─ engineFiles.ts        # скачивание .js/.wasm с прогрессом, Cache API + IndexedDB
   │  ├─ engine.ts             # UCI-обёртка над Worker (blob-воркер, MultiPV, очередь поисков)
   │  ├─ db.ts                 # IndexedDB: кэш позиций (FEN + глубина + MultiPV), манифест файлов
   │  ├─ analyze.ts            # конвейер обзора + классификация 10 типов ходов
   │  ├─ winprob.ts            # Win%, точность хода, CAPS2-точность партии, рейтинг партии
   │  ├─ openings.ts           # ECO A00–E99 (ru/en), книжные ходы
   │  ├─ see.ts                # статический размен (qsearch по взятиям), вилки, висящие фигуры
   │  ├─ coach.ts              # комментарии тренера на русском
   │  ├─ sound.ts              # игровые MP3-звуки + Web Audio для тренировок
   │  ├─ importers.ts          # примеры партий, загрузка с lichess.org
   │  └─ coi.ts                # регистрация coi-serviceworker
   └─ components/              # доска, обзор, тренер, игра, профиль, задачи и энциклопедия дебютов
```

## Stockfish 19 и кэширование

* Используется пакет [`stockfish` 19.0.1](https://www.npmjs.com/package/stockfish) (Stockfish.js от Chess.com):
  `stockfish-19` (многопоточный, ≈99 МБ), `stockfish-19-single` (однопоточный), а также Lite-варианты (≈1.7 МБ).
* **Нейросеть NNUE вшита в .wasm** — отдельного `.nnue`-файла у этой сборки нет. Скачиваются два файла (`.js` + `.wasm`),
  прогресс показывается в МБ и %.
* Файлы лежат в **Cache API** (резерв — IndexedDB); манифест (версия, размер, дата) — в IndexedDB. При следующих
  заходах движок поднимается из локального кэша без сети.
* Источники: `./engine/*` (локальные копии Lite) → `https://unpkg.com/stockfish@19.0.1/bin/*` (CORS + CORP).
  Полная версия не лежит в репозитории из-за размера (99 МБ) и скачивается с CDN один раз.
  Хотите полностью офлайн-хостинг — положите `stockfish-19*.js/.wasm` из npm-пакета в `public/engine/`.
* Результаты анализа позиций кэшируются в IndexedDB по ключу `FEN | глубина | MultiPV`.
* Многопоточность: нужен `crossOriginIsolated`. Режим выбирается автоматически; если многопоточный движок не
  стартовал — автоматический fallback на однопоточный.

## COOP / COEP

1. **Render.com** — production запускается как Docker Web Service: `Dockerfile` собирает Vite, Nginx из `docker/default.conf.template` отдаёт SPA и COOP/COEP/CORP-заголовки. `render.yaml` описывает эту Docker-конфигурацию; перед первым Blueprint sync обязательно проверь план изменений, чтобы не создать дубликат уже существующего сервиса.
2. **Service Worker** — `public/coi-serviceworker.js`: если хостинг не отдал заголовки, SW добавит их и страница
   один раз перезагрузится.
3. **Dev/preview** — текущий `vite.config.ts` уже выставляет COOP/COEP/CORP для `server` и `preview`. Service Worker остаётся запасным механизмом для хостингов, которые не умеют отдавать эти заголовки.

## Алгоритм обзора партии

* **Движок:** локальный Stockfish 19 с полной NNUE-сетью или Lite-сборкой. Позиции анализируются с MultiPV 2; доступная глубина зависит от выбранного режима и производительности устройства.
* **Оценка шансов:** движковая оценка преобразуется в Win% / Expected Points с поправкой на рейтинг игрока. Это приближение Chessmart: точная таблица Expected Points и модель Chess.com не опубликованы.
* **Классификация обычных ходов:** границы ориентированы на публичные пороги Chess.com Classification V2: Excellent — потеря до 2 п.п., Good — 2–5, Inaccuracy — 5–10, Mistake — 10–20, Blunder — более 20 п.п. Это те же пороги потери Expected Points, но наши Expected Points и глубина анализа остаются собственной реализацией.
* **Специальные классы:** Brilliant ищет хорошую жертву фигуры, которая близка к лучшему ходу, оставляет приемлемую позицию и не возникает из уже полностью выигранного положения. Great и Miss используют эвристики критичности хода и упущенного шанса. Точные пороги Chess.com закрыты, поэтому эти классы не являются побитовой копией их сервиса.
* **Accuracy:** оценка отдельного хода использует опубликованную формулу Lichess на основе потери Win%; точность партии Chessmart объединяет волатильность позиций и гармоническое среднее. Это собственная метрика, **не официальный CAPS2 Chess.com**: Chess.com раскрывает общую идею CAPS2, но не его точную математику.
* **Рейтинг партии:** приблизительная оценка по точности и Elo из PGN. Это не официальный Game Rating Chess.com и не новый рейтинг аккаунта.
* **Стадии партии:** дебют, миттельшпиль и эндшпиль делятся приближённо по номеру хода и оставшемуся материалу.

## Горячие клавиши

← → — ход назад/вперёд, ↑ / Home — в начало, ↓ / End — в конец, F — перевернуть доску, ? — показать подсказку.


## Возможности приложения

* **Обзор партии:** импорт PGN из файла, текста, буфера обмена или поддерживаемой ссылки; анализ Stockfish 19 с классификацией ходов, графиком преимущества и комментариями тренера.
* **Разбор и исследование:** переход по ходам, варианты движка, собственные продолжения, подсветка лучшего хода и повтор ошибок на доске. Лаборатория позиции добавляет загрузку/проверку FEN, историю с отменой и повтором, фильтры легальных ходов (взятия, шахи, рокировки, превращения), материальный баланс, сведения о правах рокировки и en passant, копирование SAN/UCI и три линии Stockfish.
* **Экспорт:** скачивание аннотированной PGN-партии или копирование её в буфер обмена. Комментарии включают класс хода, объяснение тренера и лучший ход Stockfish.
* **FEN:** копирование текущей позиции, в том числе позиции собственного варианта или тренировочной попытки.
* **Игра и обучение:** партии против Stockfish с выбором силы, задачи на основе собственных ошибок и упражнения по эндшпилю.
* **Профиль:** локальная статистика, точность по стадиям, дебюты, Brilliant/Miss, рейтинг против бота и список тренировочных задач.
* **Резервная копия:** экспорт и восстановление профиля из JSON. Перед восстановлением файл проверяется, а замена существующих данных требует подтверждения.
* **Личные предпочтения:** приложение запоминает включение/выключение звуков и выбранную глубину анализа.

Профиль и история обучения хранятся в браузере и не синхронизируются автоматически между устройствами. Для переноса используй резервную копию профиля.

## Проверки

GitHub Actions автоматически запускает чистую установку зависимостей, строгую проверку TypeScript, проверку легальности дебютных линий и production-сборку при каждом обновлении `main` и pull request.


## Большое обновление интерфейса и дебютной базы

* Обзор получил автопроигрывание партии с тремя скоростями, режим фокуса и четыре цветовые темы доски. Тема доски сохраняется в браузере.
* Список ходов поддерживает фильтры «Ошибки», «Brilliant», «Дебют» и поиск по номеру, SAN/русской нотации и комментарию.
* Раздел **«Дебюты»** открывает энциклопедию с поиском по ECO, русскому/английскому названию и последовательности ходов. Для выбранной линии показываются доска, SAN и FEN; позицию и линию можно скопировать.
* Каталог расширен до 4,055 уникальных ECO/SAN-записей: 3,478 новых записей импортированы из Lichess Openings. Локальные русские названия сохранены как приоритетные. Источник и лицензия: [docs/OPENINGS_SOURCE.md](docs/OPENINGS_SOURCE.md).
* `npm run validate:openings` проверяет структуру строк и проигрывает каждую импортированную SAN-линию через `chess.js`. Этот тест выполняется и в GitHub Actions до production-сборки.


## CHESSMART Online и расширенная тренировка

* **Новая навигация платформы:** отдельные зоны «Играть», «Тренировка» и «Изучать», адаптивная боковая панель и собственные SVG-иконки.
* **Анализ движка:** переработанная панель без эмодзи, с оценкой, глубиной, числом линий и потоков Stockfish. Клик по варианту продолжает позицию.
* **Библиотека задач:** отдельный рейтинг Puzzle, режим «Задача дня», подбор по тактической теме, подсказка, показ решения, серия и статистика. При первом открытии приложение загружает и проверяет 3 500 легальных задач из открытого набора Lichess; затем сохраняет их локально. Для первой загрузки нужен доступ к Hugging Face Datasets Server.
* **Игры с друзьями:** комнаты по приглашению, код и ссылка, Bullet / Blitz / Rapid controls, серверная проверка легальности ходов, часы с добавлением времени, сдача и timeout.
* **Настоящий сетевой Elo:** Bullet, Blitz и Rapid считаются отдельно на сервере по результату партии. Это не локальный рейтинг Stockfish и не рейтинг задач.

### Настройка сетевой игры

Онлайн-режим не активируется только статическим деплоем. Нужен собственный Supabase backend. Полная инструкция, SQL-схема, Edge Function и безопасная настройка секретов находятся в [docs/ONLINE_SETUP.md](docs/ONLINE_SETUP.md). Без переменных окружения приложение показывает экран настройки, а не имитирует подключённую сеть.

Сейчас реализованы **комнаты по приглашению**. Публичный случайный матчмейкинг, поиск друзей, турниры, чат, модерация и полноценная античит-система остаются отдельными задачами и не заявляются как готовые функции.


## Nickname accounts, live matchmaking and beginner bots

* Online accounts use a unique nickname and password. The profile is stored in Supabase, not just localStorage. A session token is cached in the browser, while the same account can sign in from another device.
* Players can challenge a username directly, accept/decline incoming invitations, or use **Find opponent**. Queue matching is grouped by Bullet/Blitz/Rapid and starts within a nearby Elo range that widens over time.
* Public matchmaking and invitations are implemented in Supabase server functions; the browser never writes Elo or game positions directly. The server validates moves and applies rating changes once per finished rated game.
* Static hosting on Render is supported. Supabase migrations and Edge Function must be applied/deployed separately; see [docs/ONLINE_SETUP.md](docs/ONLINE_SETUP.md).
* Low-level Stockfish bots now deliberately make occasional random legal moves and choose weaker MultiPV alternatives. This makes the 100–700 levels noticeably less accurate rather than trusting Stockfish's Skill Level alone.
* Training tasks have mission filters for mate in 1, mate in 2, mate in 3, punishing mistakes, forks, defensive moves and winning material. The default difficulty filter is Easy (up to 1200 puzzle rating).
