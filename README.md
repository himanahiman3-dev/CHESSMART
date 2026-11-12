# Chess Review — «Game Review» как на Chess.com (Stockfish 19, 100 % в браузере)

React + TypeScript + Vite + Tailwind CSS. Никаких серверов и платных API: PGN-разбор, Stockfish 19 (WASM),
классификация ходов, дебютная база ECO и кэширование работают на стороне клиента.

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
├─ render.yaml                 # Render.com Blueprint (static site + COOP/COEP заголовки)
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
   │  ├─ sound.ts              # звуки Web Audio API
   │  ├─ importers.ts          # примеры партий, загрузка с lichess.org
   │  └─ coi.ts                # регистрация coi-serviceworker
   └─ components/              # доска, шкала оценки, график, обзор, ходы, анализ, тренер
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

1. **Render.com** — `render.yaml` (Blueprint) и/или `public/_headers` добавляют заголовки автоматически.
2. **Service Worker** — `public/coi-serviceworker.js`: если хостинг не отдал заголовки, SW добавит их и страница
   один раз перезагрузится.
3. **Dev/preview** — скопируйте `docs/vite.config.coop-coep.example.ts` в `vite.config.ts`, чтобы заголовки отдавал
   сам Vite (`server.headers`, `preview.headers`). Без этого в dev включится Service Worker.

## Алгоритм анализа

* `Win% = 50 + 50·(2/(1+exp(−0.00368208·cp)) − 1)`, мат — 100 % / 0 %.
* `Accuracy = 103.1668·exp(−0.04354·Δ) − 3.1669` (0…100), итог по партии — среднее взвешенного (волатильность
  Win% в окне) и гармонического средних (CAPS2).
* Классы: Brilliant (лучший ход + жертва по qsearch-SEE, оценка до хода ≤ +4.5), Great (единственный ход:
  разрыв с 2-й линией > 150 cp или > 10 %), Best, Excellent (<2 %), Good (2–5 %), Book (ECO), Inaccuracy (5–10 %,
  плюс исключение «потеря пешки при перевесе > +3.0»), Mistake (10–20 %), Miss (соперник ошибся, а ход вернул
  равенство), Blunder (> 20 % или упущенный/допущенный мат).
* Рейтинг партии — приблизительная оценка по точности и Elo из PGN (это оценка, а не официальная формула Chess.com).

## Горячие клавиши

← → — ход назад/вперёд, ↑ — в начало, ↓ — в конец, F — перевернуть доску.
