# S10 — Payment Provider Selection: FROZEN

Status: **provider NOT SELECTED**. This note freezes S10 at the discovery/design stage.
It records a repository state; it is not a provider decision.

## Decision state

- The payment provider has **not** been selected by the project owner.
- No provider is approved for implementation.
- S10 implementation must not begin until the owner makes an explicit provider decision.

## Repository references (not approval)

YooKassa appears in the repository as a **proposed / designated reference only**:

- `AGENTS.md` — payments described with a YooKassa target and `PaymentAdapter` boundary.
- `docs/stage-11/data-model.md` §3.17 — proposed `Payment` model with `provider = "yookassa"`.
- `docs/stage-11/storage-jobs-payments.md` §3 — proposed YooKassa integration contract.
- `docs/stage-11/architecture.md`, `migration-and-rollback.md`, `operations.md`, `README.md` — S10 named as YooKassa.
- `web/.env.example` — placeholder names `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`.

None of the above is treated as an owner-approved provider selection. Placeholder env
variable names and design documents are reference material, not a business decision.

## Current implementation state

- No payment provider implemented (no YooKassa, Stripe, Adyen, or other).
- No `Payment` / `Order` / `Invoice` / `Subscription` / `Refund` Prisma model and no migration.
- No payment API routes.
- No webhook endpoint.
- No payment SDK dependency.
- No payment queues added to S8.
- No payment actions/entity types added to the S7 audit taxonomy.
- No S9 backup/restore changes for payments.
- No payment secrets in `.env`; only `.env.example` placeholders exist.
- Frontend `/tariffs` remains display-only ("Купить" disabled / "скоро"); no checkout.

## Forbidden until an explicit owner decision

- choosing a provider (including YooKassa);
- provider-specific implementation or SDK installation;
- creating `Payment` model / migration;
- creating payment API routes, checkout, subscription, or refund flows;
- creating webhook endpoints;
- adding payment jobs to S8;
- changing the S7 audit taxonomy for payments;
- changing S9 backup/restore for payments;
- adding or changing payment secrets in `.env`;
- deciding one-time vs subscription, payment methods, refunds, currencies,
  receipts/tax/54-ФЗ, fulfillment, or supported countries/regions.

## Required next decision

The project owner must explicitly select the payment provider (and the related business
decisions) before any S10 implementation begins. Until then S10 remains **BLOCKED —
awaiting provider selection**.
