# Stage 11 — журнал процесса

Краткая хронология этапов миграции IndexedDB → PostgreSQL/S6 и production hardening. Цель — чтобы
контекст процесса был доступен в репозитории, а не только в истории переписки.

## Этапы и вердикты

| Этап | Результат |
|---|---|
| S0 Architecture Contract | PASS |
| S1 PostgreSQL + Prisma | PASS |
| S2 Auth.js + tenancy | PASS |
| S3 IndexedDB → PostgreSQL migration | PASS |
| S4 Server Reads | PASS |
| S5 Server Writes (dual-write) | PASS |
| S6 File/Object Storage | PASS |
| S7 Audit Log | PASS |
| S8 Background Jobs | PASS* |
| S9 Backups + Restore | PASS |
| S11-R0 Read Model Completion + Legacy Backfill | PASS |
| S11-RC Read Model Completeness Acceptance | PASS |
| S11 Final Read Cutover | PASS |
| Production Readiness Audit | NOT READY (P0 blockers) |
| P0 — Commit S11 + Docker | PASS |
| P1 — Production Hardening (health, README, UI copy, wipe, config, Docker opt) | PASS |
| Final Production Readiness Re-Audit | READY |
| S10 — Payment Discovery | COMPLETE |
| S10 — Payment Provider Selection | BLOCKED — provider NOT SELECTED |

`*` S8: pre-existing падение `jobs/db-unavailable.integration.test.ts` (pg-boss retry) при
`TEST_DATABASE_URL`; в canonical/CI тест пропускается. Не связано со Stage 11.

## Ключевые коммиты

| Коммит | Содержание |
|---|---|
| `1543bce` | docs: define stage 11 architecture contract |
| `939db95` | feat: add PostgreSQL foundation for stage 11 |
| `a0238c4` | feat: add auth and tenancy for stage 11 |
| `30eb0cb` | feat: add safe IndexedDB to PostgreSQL migration |
| `aae21b3` | docs: add RF production and privacy constraints |
| `3a34f28` | docs: freeze S10 pending payment provider selection |
| `bb2dc3d` | feat: add stage 11 server reads/writes, storage, audit, jobs, backups and read cutover |
| `950ad72` | chore: add production Dockerfile and align product screen with data-events |
| `04f8702` | feat: complete production hardening |

## Что зафиксировано отдельными документами

- Архитектурный контракт S0–S9 — `docs/stage-11/` (architecture, data-model, decisions-and-risks,
  migration-and-rollback, operations, preserved-code, storage-jobs-payments, README).
- S10: `s10-payment-provider-freeze.md` (NOT SELECTED), `s10-payment-discovery.md` (сравнение).
- Production readiness: `production-readiness-audit.md` (READY + known limitations).

## Известные ограничения / остаётся на будущее

- S10 Payments — BLOCKED до выбора провайдера владельцем.
- In-memory rate-limit / AI-бюджет — не для нескольких реплик.
- Docker-образ 2.16 ГБ — оптимизация через Next standalone отложена.
- `docs/legal-rf/data-inventory.md` — отдельный RF/legal пакет, untracked.
- S8 pg-boss retry integration test — pre-existing, вне scope.
