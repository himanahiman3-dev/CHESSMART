# Проверки проекта

Проверки запускаются автоматически через GitHub Actions при каждом push в `main`, pull request в `main` и вручную через Workflow Dispatch.

Workflow: `.github/workflows/ci.yml`

1. `npm ci` — чистая установка зависимостей по lock-файлу.
2. `npx tsc --noEmit` — строгая проверка TypeScript без генерации файлов.
3. `npm run build` — production-сборка Vite.

Запуск локально:

```bash
npm ci
npx tsc --noEmit
npm run build
```

CI подтверждает типы и production-сборку, но не заменяет ручную проверку браузерных сценариев: запуск Stockfish/WASM, импорт PGN, ходы на доске, экспорт PGN, звуки и сохранение локального профиля.
