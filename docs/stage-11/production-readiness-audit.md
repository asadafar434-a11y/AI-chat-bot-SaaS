# Production Readiness Re-Audit — Stage 11

**Verdict: READY**

Read-only аудит. Зафиксировано состояние на HEAD `04f8702` (`feat: complete production hardening`),
ветка `stage-11-server-migration`, tracked working tree чистый; `docs/legal-rf/` — intentionally untracked.

## Таблица по областям

| Area | Status | Evidence |
|---|---|---|
| Git/reproducibility | PASS | HEAD `04f8702`; цепочка `04f8702 → 950ad72 → bb2dc3d → 3a34f28 → aae21b3`; working tree чистый (кроме `docs/legal-rf/`). |
| Tests/build | PASS | canonical `npm test` 961: 917 passed / 0 failed / 43 skipped / 1 todo; с `TEST_DATABASE_URL` 961: 959 passed / 1 failed / 0 skipped / 1 todo; `tsc`, `eslint`, `next build` — PASS; `build:host` — в Docker. |
| Docker | PASS | Образ собран (2.16 ГБ); контейнер стартует; `/`→200, `/login`→200, `/api/auth/session`→null[200], `/api/reads/purchases`→401, `/api/health`→200, `/api/health/ready`→200 (БД ok), `POST /api/writes/wipe` без сессии→401, прямой Prisma-запрос→OK. |
| Database | PASS | 3 миграции; `prisma validate` valid; `migrate status` up to date; S11-R0 — только ADD COLUMN; destructive (DROP/TRUNCATE/DELETE) не найдено. |
| Auth/tenancy | PASS | Auth.js v5 DB-сессии; `requireReadScope`/`requireWriteScope` (session + Membership, `x-organization-id` как проверяемый выбор); fail-closed. |
| Server reads | PASS | `server-reads.ts` импортирует только типы; сторы — режим `serverReadsEnabled()`, без try/catch-фолбэка; `lib/cutover.test.ts` (IDB blocked/empty) зелёный. |
| Server writes | PASS | `/api/writes/*` + tenant-scoped сервисы; S5 dual-write сохранён; mutation→refetch; import `/api/writes/import`; wipe route. |
| S6 storage | PASS | `StorageAdapter`; fs запрещён в production без override; text/map ключи документов и образцов; `deleteRowObjects`; missing object → null/missing, без fabrication. |
| S7 audit | PASS | append-only; allowlist включает `organization.wiped`/`user.data_wiped`; `audit.test.ts` зелёный. |
| S8 jobs | PASS | pg-boss `QUEUE_REGISTRY`; `JOBS_ENABLED`; `documentExtractHandler` сохраняет text+map. |
| S9 backup/restore | PASS | `backup:create`/`backup:restore`; `OBJECT_KEYS_SQL` = Document.{storageKey,textKey,mapKey}+Sample.{textKey,mapKey}; реальный backup→restore→validation — PASS; прокси-лимит 45MB. |
| Wipe | PASS | owner → данные организации + личные; member → только личные; чужой tenant/без членства → отказ; объекты S6 удаляются; аудит сохраняется; ошибка сервера не маскируется. |
| Production config | PASS | README + `.env.example` соответствуют коду (все перечисленные переменные читаются). |
| IndexedDB boundary | PASS | `@/lib/db` только в backup (import/export), purchase/me/evidence-store (dual-write + режим `=0`), wipe (cleanup), тестах; production read fallback отсутствует. |
| Documentation | PASS | README под server-архитектуру; устаревших browser-only пользовательских текстов нет. |

## Итоговые вердикты

- **Stage 11 migration:** PASS
- **Production hardening:** PASS
- **S10 payment:** BLOCKED — provider not selected

## Known out-of-scope limitations

- `src/server/jobs/db-unavailable.integration.test.ts` — pre-existing падение pg-boss retry (только при
  `TEST_DATABASE_URL`; в canonical/CI пропускается). Не связано со Stage 11.
- In-memory rate-limit и AI-бюджет (`proxy.ts`, `rate-limit.ts`, `ai-meter.ts`) — не разделяются между
  репликами (известное ограничение R1; вне scope).
- Docker-образ 2.16 ГБ — уменьшение требует Next standalone (изменение next.config) — отложено.
- Коммиты Stage 11/P0/P1 не запушены в origin на момент аудита (операционный шаг `git push`).
- `docs/legal-rf/` — intentionally untracked (отдельный RF/legal пакет).
