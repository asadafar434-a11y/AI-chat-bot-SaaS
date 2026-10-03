# Тендерный юрист — приложение

Помощник поставщика по 44-ФЗ и 223-ФЗ. Загружаете документы закупки — приложение выписывает требования
с цитатами, составляет черновик технического предложения, проверяет заявку перед подачей, ищет по словам
в документах, считает, до какой цены снижаться, и отвечает на вопросы по документам.

## Архитектура (Stage 11)

Продукт — серверное приложение на Next.js с PostgreSQL и объектным хранилищем:

```
UI (Next.js / экран продукта)
      ↓
server actions / route handlers
      ↓
доменные сервисы
      ↓
PostgreSQL (Prisma) · S6 object storage · pg-boss (S8) · AI provider
```

- **Аутентификация** — Auth.js v5, серверные сессии в PostgreSQL, роли `owner` / `member`,
  приглашения и сброс пароля. Каждый серверный доступ проверяет сессию, членство и организацию.
- **Данные** — PostgreSQL: закупки, документы (метаданные), факты, образцы, профили, аудит.
  Большие тексты документов и карты (`DocMap`) — в S6-совместимом объектном хранилище
  (`storageKey` / `textKey` / `mapKey`).
- **Чтение** — серверное (`/api/reads/*`), источник истины — PostgreSQL + S6.
- **Запись** — серверная (`/api/writes/*`). S5 dual-write (зеркало в IndexedDB браузера) сохранён
  для совместимости; IndexedDB **не является** источником чтения production-UI.
- **Аудит** — S7, неизменяемый журнал важных изменений.
- **Фоновые задачи** — S8, pg-boss поверх PostgreSQL.
- **Резервные копии** — S9, логический дамп PostgreSQL + объекты S6.

Платежи (S10) не реализованы: провайдер не выбран, см. `docs/stage-11/s10-payment-provider-freeze.md`.

## Запуск на своём компьютере

Продукт — два приложения: сервер (эта папка) и экран продукта
([`design-system/prototype`](../design-system/prototype/README.md)). Нужен весь репозиторий, а не только `web`.

```bash
# 1. PostgreSQL (Docker) и зависимости
cd web
npm run db:up            # docker compose -f docker-compose.postgres.yml up -d
npm install

# 2. Схема БД
cp .env.example .env      # задайте DATABASE_URL (и AUTH_SECRET для серверной сессии)
npx prisma migrate deploy # применить миграции
npx prisma generate

# 3. Сборка и запуск (экран + сервер одним адресом)
npm run build:host        # собрать экран в web/public/product, затем сервер (next build)
npm run start:local       # http://localhost:3000, без пароля, только для этого компьютера
```

Правки экрана удобнее парой с мгновенным обновлением: `npm run dev -- --port 3001` (сервер) и
`npm --prefix ../design-system/prototype run dev -- --port 3000` (экран).

## Переменные окружения

Полный список плейсхолдеров — в [`.env.example`](.env.example). Реальные секреты в Git не попадают;
в production они поставляются через переменные окружения или Docker secrets.

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | Подключение к PostgreSQL. Обязательна. |
| `DATABASE_POOL_MAX`, `DATABASE_LOG_LEVEL` | Пул соединений; уровень логов Prisma. |
| `AUTH_SECRET` | Подпись/шифрование сессий Auth.js. **Обязательна** в production. |
| `AUTH_URL` | Публичный адрес приложения. |
| `ACCESS_PASSWORD` | Переходный вход по общему паролю (этапы A–C); не задан — на хостинге `/api` закрыт. |
| `OPEN_ACCESS` | `1` — разрешить работу без пароля (только для `next start` на своём компьютере). |
| `SERVER_READS` | `1` — включить серверные эндпоинты чтения `/api/reads/*`. |
| `SERVER_WRITES` | `1` — включить серверные эндпоинты записи `/api/writes/*`. |
| `NEXT_PUBLIC_SERVER_READS` | Клиентское чтение; по умолчанию серверное, `0` — legacy-режим IndexedDB (тесты/dev). |
| `NEXT_PUBLIC_SERVER_WRITES` | `1` — клиентская половина S5 dual-write. |
| `STORAGE_BACKEND` | `s3` (production) или `fs` (только dev/test). |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Приватный S3-совместимый бакет в РФ. |
| `S3_SIGNED_URL_TTL_SECONDS`, `S3_FORCE_PATH_STYLE`, `STORAGE_ENABLED` | Короткоживущие ссылки; path-style; включение файловых endpoints. |
| `JOBS_ENABLED`, `JOBS_DATABASE_URL`, `JOBS_SCHEMA`, `JOBS_POLL_INTERVAL_MS`, `JOBS_MAX_RETRIES` | Фоновые задачи S8 (pg-boss). |
| `BACKUP_DIR`, `BACKUP_DATABASE`, `BACKUP_ENCRYPTION_KEY`, `BACKUP_PG_CONTAINER`, `BACKUP_PG_USER` | Резервные копии S9. |
| `ANTHROPIC_API_KEY` | Ключ Claude API (серверный). Без него ИИ-функции недоступны. |
| `AI_BUDGET_RUB`, `USD_RUB` | Лимит расходов ИИ и курс. |
| `OPERATOR_NAME`, `OPERATOR_INN`, `OPERATOR_OGRN`, `OPERATOR_ADDRESS`, `OPERATOR_EMAIL` | Оператор ПД: подставляется в правовые страницы. |
| `PD_MASK` | `off` — без маскирования ПД (только dev). |

## Production (Docker)

Образ собирается из корня репозитория (нужен экран продукта в `design-system/prototype`):

```bash
docker build --build-arg NEXT_PUBLIC_SERVER_WRITES=1 -t tender-lawyer-web .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://…" \
  -e AUTH_SECRET="…" \
  -e SERVER_READS=1 -e SERVER_WRITES=1 \
  -e STORAGE_BACKEND=s3 -e S3_ENDPOINT=… -e S3_REGION=… -e S3_BUCKET=… \
  -e S3_ACCESS_KEY_ID=… -e S3_SECRET_ACCESS_KEY=… \
  -e JOBS_ENABLED=1 \
  tender-lawyer-web
```

`NEXT_PUBLIC_*` инлайнятся Next при сборке — клиентские флаги задаются как `--build-arg`. Серверные
флаги (`SERVER_READS`, `SERVER_WRITES`, `STORAGE_BACKEND`, `JOBS_ENABLED`, `AUTH_SECRET`, `DATABASE_URL`)
задаются в runtime-окружении. Воркер фоновых задач запускается отдельным процессом: `npm run jobs:worker`.

Проверки состояния: `GET /api/health` — liveness (процесс жив), `GET /api/health/ready` — readiness
(доступность PostgreSQL; `503`, если БД недоступна). Оба доступны без входа.

## Резервные копии и восстановление (S9)

```bash
npm run backup:create     # дамп PostgreSQL + объекты S6 + манифест
npm run backup:restore    # восстановление в отдельную БД + проверка контрольных сумм
```

Ключ `BACKUP_ENCRYPTION_KEY` хранится вне артефакта. Секреты (API-ключи, пароли БД) в backup не попадают.

## Закрытая ссылка

1. Выложите весь репозиторий (нужен `design-system/prototype`). В `web`: `npm install`, затем
   `npm run build:host` (собирает экран и сервер), запуск — `npm start`.
2. Задайте `DATABASE_URL`, `AUTH_SECRET`, `ACCESS_PASSWORD` (или используйте серверные сессии и вход).
3. Приложение за обратным прокси: он должен дописывать `X-Forwarded-For` (иначе лимиты на адрес
   обходятся). Заголовки безопасности — в `next.config.ts`.

## Лимиты и расходы на ИИ

Главная защита бюджета — месячный лимит расходов в консоли Anthropic. Сервер тоже считает запросы
(`src/lib/rate-limit.ts`, `src/proxy.ts`): запросы к ИИ, загрузки файлов и попытки входа ограничены на адрес.
Счёт — в памяти процесса: после перезапуска начинается заново, на нескольких серверах у каждого свой
(для нескольких реплик нужен общий счётчик — отдельная задача).

## Персональные данные

Claude работает у Anthropic в США — это трансграничная передача (152-ФЗ). Перед отправкой сервер заменяет
персональные данные метками (`⟦ФИО-1⟧`, `⟦ТЕЛЕФОН-2⟧`) и возвращает их обратно в ответе
([`src/lib/pd-mask.ts`](src/lib/pd-mask.ts)). Замена уменьшает передачу, но не отменяет её: уведомления в
Роскомнадзор нужны. Правовые страницы (`/privacy`, `/consent`, `/consent-transfer`, `/terms`, `/contacts`)
открыты без пароля; тексты — шаблон с пометкой «ТРЕБУЕТ ПРОВЕРКИ ЮРИСТОМ» (`src/lib/legal.ts`).

## Проверка

```bash
npm test && npx eslint src && npx next typegen && npx tsc --noEmit && npx next build
```

Полная проверка «как на хостинге» — `npm run build:host && npm run check:host`. То же запускает
автопроверка на GitHub — [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
