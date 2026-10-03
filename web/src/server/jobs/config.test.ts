import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_POLL_INTERVAL_MS,
  jobsConfigFromEnv,
  MAX_MAX_RETRIES,
  MIN_POLL_INTERVAL_MS,
} from "./config.ts";

test("по умолчанию фоновые задачи выключены", () => {
  const config = jobsConfigFromEnv({});
  assert.equal(config.enabled, false);
  assert.equal(config.schema, "pgboss");
  assert.equal(config.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);
  assert.equal(config.maxRetries, DEFAULT_MAX_RETRIES);
});

test("JOBS_ENABLED=1 включает; schema берётся из env", () => {
  const config = jobsConfigFromEnv({ JOBS_ENABLED: "1", JOBS_SCHEMA: "jobs" });
  assert.equal(config.enabled, true);
  assert.equal(config.schema, "jobs");
});

test("databaseUrl: JOBS_DATABASE_URL важнее DATABASE_URL, иначе fallback", () => {
  assert.equal(jobsConfigFromEnv({ DATABASE_URL: "postgres://a" }).databaseUrl, "postgres://a");
  assert.equal(
    jobsConfigFromEnv({ DATABASE_URL: "postgres://a", JOBS_DATABASE_URL: "postgres://b" }).databaseUrl,
    "postgres://b",
  );
});

test("pollIntervalMs ограничивается снизу и мусор отбрасывается", () => {
  assert.equal(jobsConfigFromEnv({ JOBS_POLL_INTERVAL_MS: "1" }).pollIntervalMs, MIN_POLL_INTERVAL_MS);
  assert.equal(jobsConfigFromEnv({ JOBS_POLL_INTERVAL_MS: "5000" }).pollIntervalMs, 5000);
  assert.equal(jobsConfigFromEnv({ JOBS_POLL_INTERVAL_MS: "мусор" }).pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);
});

test("maxRetries ограничивается сверху и не бывает отрицательным", () => {
  assert.equal(jobsConfigFromEnv({ JOBS_MAX_RETRIES: "999" }).maxRetries, MAX_MAX_RETRIES);
  assert.equal(jobsConfigFromEnv({ JOBS_MAX_RETRIES: "-3" }).maxRetries, 0);
  assert.equal(jobsConfigFromEnv({ JOBS_MAX_RETRIES: "мусор" }).maxRetries, DEFAULT_MAX_RETRIES);
});
