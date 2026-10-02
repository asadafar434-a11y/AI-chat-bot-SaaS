# AGENTS.md — Stage 11: Server Architecture & Production Migration (RF)

## 0. Mission

This repository is an existing application whose current business/data state is stored in the browser via IndexedDB.

Stage 11 goal: move the application toward a secure, multi-user, server-backed architecture without losing or corrupting existing IndexedDB data and without rewriting stable business logic unnecessarily.

Primary production target:
- Compute/backend: Russian-hosted VM/cloud compute, Dockerized.
- Database: PostgreSQL hosted in the Russian Federation.
- Files: S3-compatible object storage hosted in the Russian Federation.
- Auth: Auth.js / NextAuth.js v5-compatible architecture.
- Roles: `owner`, `member`.
- Payments: YooKassa API, added as a separate backend integration after core server architecture is stable.
- Jobs: pg-boss over PostgreSQL; do not add Redis unless a concrete requirement appears.
- Observability: structured JSON logs + server-side error monitoring; avoid sending personal data to third-party SaaS by default.

Recommended implementation principle:
> Build provider-agnostic application code, deployable with Docker, and keep all production personal data in RF-hosted infrastructure.

## 1. Non-negotiable data safety rules

1. IndexedDB is the current source of truth until migration is explicitly signed off.
2. NEVER delete, clear, truncate, reset, overwrite, or invalidate IndexedDB data as part of Stage 11 unless a migration runbook explicitly says to do so and a verified backup/export exists.
3. NEVER make a destructive DB migration during development without an explicit rollback path.
4. Before any data migration, create:
   - machine-readable export;
   - human-readable summary/checksums/counts;
   - rollback procedure;
   - idempotent migration script.
5. Prefer additive schema migrations first.
6. Never perform a one-way cutover when a dual-read/verification or staged cutover is practical.
7. Preserve stable business rules. Do not refactor unrelated UI or domain logic during migration work.
8. All production migrations must be repeatable or safely resumable.
9. Every migration must validate source count vs target count and important aggregates before considering cutover successful.
10. Keep feature flags/config switches for migration/cutover where practical.

## 2. Security model

### Authentication
- Use Auth.js / NextAuth.js v5-compatible patterns.
- Session handling must be server-side verifiable.
- Never trust a role, organization ID, or user ID supplied by the client.
- No secrets in client bundles.

### Authorization / tenant isolation
Every server-side data access path must establish:
1. authenticated user;
2. organization membership;
3. required role/capability;
4. ownership/organization scope of the target record.

A user from Organization A must never be able to read or mutate Organization B data by changing an ID in a URL, request body, or query parameter.

Use organization-scoped queries and explicit authorization helpers. Do not rely on UI hiding buttons as a security boundary.

### Validation
- Validate all external input at the server boundary.
- Prefer typed schemas (e.g. Zod if already used or if appropriate).
- Reject unknown/unsafe fields where practical.
- Do not pass raw request bodies directly into Prisma writes.

### Files
- Store binary documents in S3-compatible object storage, not PostgreSQL blobs unless there is a concrete reason.
- Keep object keys opaque and organization-scoped.
- Do not expose permanent public URLs for sensitive files.
- Use short-lived signed URLs or authenticated download endpoints.
- Never trust a client-provided object key without checking organization ownership.

### Payments
- Never store raw card data.
- Keep YooKassa secrets server-side only.
- Treat webhook payloads as untrusted input until signature/authenticity is verified according to the provider documentation.
- Make webhook processing idempotent.
- Store payment/event IDs and processing state to prevent duplicate fulfillment.

### Secrets
- `.env*` files with real secrets must never be committed.
- Maintain `.env.example` with placeholders only.
- Never print secrets in logs, errors, test snapshots, or telemetry.

## 3. Database rules

Use PostgreSQL + Prisma.

Core entities expected to evolve toward:
- Organization
- User
- Membership (preferred over putting organizationId directly on User if a user may later belong to multiple orgs)
- Purchase
- Document
- AuditEvent
- Payment (or equivalent payment model only when payment integration is implemented)
- Job-related tables as required by pg-boss / application logic

Important:
- Use UUID/CUID-style opaque IDs as appropriate for the existing codebase.
- Add timestamps (`createdAt`, `updatedAt`) consistently.
- Prefer explicit relations and foreign keys.
- Use database indexes for organization-scoped lookups and common query paths.
- Add uniqueness constraints only when the business rule is known.
- Do not invent business rules merely to satisfy a schema.

## 4. API / server architecture

Prefer this dependency direction:

UI -> server action/route/service -> domain logic -> Prisma/repositories
                                      -> object storage
                                      -> payment provider
                                      -> job queue

Do not let React components contain direct database/provider credentials or privileged operations.

Keep provider integrations behind small adapters/interfaces where reasonable:
- StorageAdapter
- PaymentAdapter

This makes RF provider changes and future migrations easier.

## 5. Migration strategy

Expected migration sequence:
1. inventory existing IndexedDB stores, schemas, indexes, and business rules;
2. create server schema additively;
3. implement export/import tooling;
4. migrate a copy/sample;
5. compare counts and semantic aggregates;
6. implement server reads behind a feature flag;
7. run dual-read verification when practical;
8. cut over writes only after verification;
9. retain IndexedDB as read-only recovery data during an initial stabilization window;
10. only later remove legacy code after explicit sign-off.

Never assume IndexedDB records map 1:1 to the future relational model. Write a mapping document and migration tests.

## 6. Testing gates

Before claiming a phase is complete:
- run typecheck;
- run lint;
- run unit/integration tests;
- run relevant e2e tests if the repo has them;
- run a security-focused review of changed server paths;
- report exact commands and results.

For migration work, add fixtures covering:
- empty data;
- one organization / one user;
- multiple organizations;
- duplicate-like records;
- missing optional fields;
- malformed legacy records;
- documents with and without metadata;
- interrupted/resumed migration.

## 7. Git / change discipline

- Work in small, reviewable commits when asked.
- Do not rewrite git history.
- Do not reset or clean user changes unless explicitly instructed.
- Before editing, inspect current git status and preserve unrelated work.
- Do not modify lockfiles/dependencies unless needed for the current phase.
- Avoid broad formatting passes.

## 8. Deployment assumptions for RF production

Design for:
- Dockerized Next.js application;
- Linux host in RF;
- PostgreSQL in RF;
- S3-compatible object storage in RF;
- HTTPS;
- automated deployment from a trusted CI/CD pipeline;
- private network connectivity between app and DB where available;
- firewall/security-group rules allowing only required inbound traffic;
- SSH access restricted by key, with password login disabled when operationally appropriate.

Do not hardcode vendor-specific SDK assumptions unless needed. Prefer standards-compatible interfaces.

## 9. Observability

Use structured JSON logs with:
- timestamp;
- level;
- event name;
- request/correlation ID;
- organization ID when safe;
- user ID when safe;
- duration/status.

Never log:
- passwords;
- session tokens;
- access tokens;
- payment secrets;
- full sensitive document contents;
- unnecessary personal data.

Use error monitoring only after defining data scrubbing/redaction.

## 10. OpenCode operating rules

Before making a significant change:
1. inspect the relevant code and current architecture;
2. state assumptions;
3. identify migration/security risks;
4. propose the smallest safe change;
5. implement;
6. test;
7. summarize changed files, tests, risks, and rollback.

When asked to implement a phase, do not silently continue into the next phase.

If a requirement conflicts with this file, stop and explain the conflict before making a risky change.

If the repository already uses a technology that differs from this document, prefer compatibility and migration over unnecessary replacement, unless the task explicitly calls for replacement.

## 11. Definition of Done for Stage 11

Stage 11 is not complete until:
- authenticated multi-user access works;
- roles and organization boundaries are server-enforced;
- PostgreSQL persistence is live and tested;
- IndexedDB migration has been validated with rollback;
- sensitive files are stored privately in RF-hosted object storage;
- audit events are recorded for important mutations;
- background jobs are idempotent and retryable where used;
- backups are configured and a restore test has been performed;
- production secrets are externalized;
- security review covers authz, tenant isolation, file access, webhooks, and common API abuse cases;
- Dockerized deployment can be reproduced;
- production data locations and third-party integrations have been explicitly reviewed for RF personal-data requirements.

## 12. Working style

Be conservative with data and aggressive with tests.

Do not optimize for speed at the expense of reversibility.
Do not say “migration complete” unless verification evidence exists.
