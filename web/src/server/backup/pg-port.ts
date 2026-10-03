/**
 * Абстракция доступа к PostgreSQL для backup/restore (logical dump).
 *
 * Реализации:
 * - DockerPgPort — `docker exec <container> pg_dump|psql`: локальная разработка
 *   и тесты (контейнер проекта `tender-lawyer-postgres`). Выбирается, если задан
 *   `BACKUP_PG_CONTAINER`.
 * - DirectPgPort — бинарники `pg_dump`/`psql` рядом с приложением (production
 *   в РФ): параметры соединения берутся из `DATABASE_URL`.
 *
 * Формат — **logical** (`pg_dump --schema=public`): восстанавливает схему,
 * строки, индексы, ограничения, связи и метки времени. Схема pg-boss в backup
 * не входит: это ephemeral queue state.
 */

import { spawn } from "node:child_process";

import { BackupError } from "./types.ts";

const PUBLIC_TABLES_SQL =
  "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename";

export type PgPort = {
  /** Описание источника без секретов (для манифеста). */
  readonly description: string;
  /** Возвращает logical SQL-дамп схемы public указанной БД. */
  dumpSchema(database: string): Promise<string>;
  /** Выполняет SQL (восстановление дампа). */
  execSql(database: string, sql: string): Promise<void>;
  /** Выполняет запрос, возвращает stdout как есть (psql -tA). */
  query(database: string, sql: string): Promise<string>;
  createDatabase(name: string): Promise<void>;
  dropDatabase(name: string): Promise<void>;
  databaseExists(name: string): Promise<boolean>;
  listPublicTables(database: string): Promise<string[]>;
};

type RunResult = { code: number; stdout: string; stderr: string };

function run(bin: string, args: string[], options: { input?: string; env?: Record<string, string | undefined> } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    if (options.input !== undefined) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

const SAFE_NAME = /^[a-zA-Z0-9_]+$/;

function assertSafeName(name: string): void {
  if (!SAFE_NAME.test(name)) {
    throw new BackupError("bad-name", `недопустимое имя БД ${JSON.stringify(name)}`);
  }
}

// ─── Docker ──────────────────────────────────────────────────────────────────

function dockerPgPort(container: string, user: string): PgPort {
  const docker = process.env.BACKUP_DOCKER_BIN ?? "docker";
  const base = ["exec"];
  const exec = (args: string[], input?: string) => run(docker, [...base, ...args], { input });
  const execIn = (args: string[], input?: string) => run(docker, ["exec", "-i", ...args], { input });

  return {
    description: `docker:${container}`,
    async dumpSchema(database) {
      const res = await exec([container, "pg_dump", "-U", user, "-d", database, "--schema=public", "--clean", "--if-exists", "--no-owner", "--no-privileges"]);
      if (res.code !== 0) {
        throw new BackupError("pg-dump", `pg_dump завершился с кодом ${res.code}: ${res.stderr.trim()}`);
      }
      return res.stdout;
    },
    async execSql(database, sql) {
      const res = await execIn([container, "psql", "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-q"], sql);
      if (res.code !== 0) {
        throw new BackupError("pg-restore", `psql завершился с кодом ${res.code}: ${res.stderr.trim()}`);
      }
    },
    async query(database, sql) {
      const res = await exec([container, "psql", "-U", user, "-d", database, "-tA", "-c", sql]);
      if (res.code !== 0) {
        throw new BackupError("pg-query", `psql query код ${res.code}: ${res.stderr.trim()}`);
      }
      return res.stdout;
    },
    async createDatabase(name) {
      assertSafeName(name);
      await this.execSql("postgres", `CREATE DATABASE "${name}"`);
    },
    async dropDatabase(name) {
      assertSafeName(name);
      // WITH (FORCE) доступен с PostgreSQL 13.
      await this.execSql("postgres", `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    },
    async databaseExists(name) {
      assertSafeName(name);
      const out = await this.query("postgres", `SELECT 1 FROM pg_database WHERE datname='${name}'`);
      return out.trim() === "1";
    },
    async listPublicTables(database) {
      const out = await this.query(database, PUBLIC_TABLES_SQL);
      return out.split("\n").map((line) => line.trim()).filter(Boolean);
    },
  };
}

// ─── Direct binaries ─────────────────────────────────────────────────────────

function directPgPort(databaseUrl: string): PgPort {
  const url = new URL(databaseUrl);
  const host = url.hostname;
  const port = url.port || "5432";
  const user = decodeURIComponent(url.username || "postgres");
  const password = decodeURIComponent(url.password || "");
  const pgDump = process.env.PG_DUMP_BIN ?? "pg_dump";
  const psql = process.env.PSQL_BIN ?? "psql";
  const env = { PGPASSWORD: password };
  const conn = (database: string) => ["-h", host, "-p", port, "-U", user, "-d", database];

  return {
    description: `direct:${host}:${port}`,
    async dumpSchema(database) {
      const res = await run(pgDump, [...conn(database), "--schema=public", "--clean", "--if-exists", "--no-owner", "--no-privileges"], { env });
      if (res.code !== 0) {
        throw new BackupError("pg-dump", `pg_dump код ${res.code}: ${res.stderr.trim()}`);
      }
      return res.stdout;
    },
    async execSql(database, sql) {
      const res = await run(psql, [...conn(database), "-v", "ON_ERROR_STOP=1", "-q"], { input: sql, env });
      if (res.code !== 0) {
        throw new BackupError("pg-restore", `psql код ${res.code}: ${res.stderr.trim()}`);
      }
    },
    async query(database, sql) {
      const res = await run(psql, [...conn(database), "-tA", "-c", sql], { env });
      if (res.code !== 0) {
        throw new BackupError("pg-query", `psql query код ${res.code}: ${res.stderr.trim()}`);
      }
      return res.stdout;
    },
    async createDatabase(name) {
      assertSafeName(name);
      await this.execSql("postgres", `CREATE DATABASE "${name}"`);
    },
    async dropDatabase(name) {
      assertSafeName(name);
      await this.execSql("postgres", `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    },
    async databaseExists(name) {
      assertSafeName(name);
      const out = await this.query("postgres", `SELECT 1 FROM pg_database WHERE datname='${name}'`);
      return out.trim() === "1";
    },
    async listPublicTables(database) {
      const out = await this.query(database, PUBLIC_TABLES_SQL);
      return out.split("\n").map((line) => line.trim()).filter(Boolean);
    },
  };
}

export type PgPortConfig =
  | { mode: "docker"; container: string; user: string }
  | { mode: "direct"; databaseUrl: string };

export function createPgPort(config: PgPortConfig): PgPort {
  return config.mode === "docker"
    ? dockerPgPort(config.container, config.user)
    : directPgPort(config.databaseUrl);
}

export function pgPortConfigFromEnv(env: Record<string, string | undefined> = process.env): PgPortConfig {
  const container = (env.BACKUP_PG_CONTAINER ?? "").trim();
  if (container) {
    return { mode: "docker", container, user: (env.BACKUP_PG_USER ?? "postgres").trim() || "postgres" };
  }
  const databaseUrl = (env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    throw new BackupError("config", "нужен BACKUP_PG_CONTAINER (docker) или DATABASE_URL (direct)");
  }
  return { mode: "direct", databaseUrl };
}

