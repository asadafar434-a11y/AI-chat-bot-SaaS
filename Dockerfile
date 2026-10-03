# syntax=docker/dockerfile:1
#
# Production image for the Tender Lawyer Next.js application.
#
# Build context is the repository ROOT, not web/: the product screen lives in
# design-system/prototype and is built into web/public/product before `next build`
# (web/scripts/build-host.mjs). This matches the existing production flow in web/README.md.
#
# The image only builds the app; PostgreSQL, S3-compatible storage, the pg-boss
# worker and secrets are supplied at runtime via environment variables (see web/.env.example).

FROM node:22-bookworm-slim AS builder
# OpenSSL must be present before `prisma generate`, otherwise Prisma generates the client for
# debian-openssl-1.1.x while the runtime is debian-openssl-3.0.x (engine mismatch).
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/web
# Dependencies first for layer caching. prisma/ is copied before `npm ci` because the
# package postinstall runs `prisma generate`.
COPY web/package.json web/package-lock.json ./
COPY web/prisma ./prisma
RUN npm ci --no-audit --no-fund
# Application source.
COPY web/ ./
# Build-time placeholders for config read at module load by Prisma/Auth.js during `next build`.
# They are not secrets and are NOT copied into the runtime stage; real values come from the
# runtime environment. Kept in a build-only file (not ENV) to avoid embedding secret-like names.
RUN printf 'DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"\nAUTH_SECRET="build-time-placeholder"\n' > .env.production
# Client-side flags are inlined by Next at build time. Production should build with
#   --build-arg NEXT_PUBLIC_SERVER_WRITES=1
# (server reads default to server unless NEXT_PUBLIC_SERVER_READS=0). Server-side counterparts
# SERVER_READS / SERVER_WRITES are supplied at run time.
ARG NEXT_PUBLIC_SERVER_WRITES
ARG NEXT_PUBLIC_SERVER_READS
ENV NEXT_PUBLIC_SERVER_WRITES=${NEXT_PUBLIC_SERVER_WRITES} \
    NEXT_PUBLIC_SERVER_READS=${NEXT_PUBLIC_SERVER_READS}
# Build the product screen (vite build --mode host) and then the server (next build).
WORKDIR /app
COPY design-system/prototype ./design-system/prototype
WORKDIR /app/web
RUN npm run build:host

FROM node:22-bookworm-slim AS runner
# Prisma's query engine needs OpenSSL, which the slim image does not ship; without it Prisma
# warns and may pick the wrong engine. ca-certificates is needed for outbound TLS (S3, AI).
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app/web
# node_modules is copied from the builder so the generated Prisma client and the
# serverExternalPackages (pdfmake, pdfkit, mammoth, pdf-parse, pg-boss, pg) are present.
COPY --from=builder --chown=node:node /app/web/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/web/.next ./.next
COPY --from=builder --chown=node:node /app/web/public ./public
COPY --from=builder --chown=node:node /app/web/package.json ./package.json
COPY --from=builder --chown=node:node /app/web/next.config.ts ./next.config.ts
COPY --from=builder --chown=node:node /app/web/prisma ./prisma
USER node
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
