// EIS Collector v1: unit-тесты config и секретов. Запуск: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EIS_MAX_TENDERS_HARD_CAP,
  loadEisConfig,
  parseDateParam,
  parseLaw,
  redactedConfig,
} from "../config.ts";
import { withEnv } from "./helpers.ts";

const CLEAN = {
  EIS_AUTH_TOKEN: undefined,
  EIS_BASE_URL: undefined,
  EIS_DRY_RUN: undefined,
  EIS_MAX_TENDERS: undefined,
  EIS_REQUEST_DELAY_MS: undefined,
  EIS_MAX_RETRIES: undefined,
  EIS_TIMEOUT_MS: undefined,
  EIS_STORAGE_PATH: undefined,
  EIS_USERNAME: undefined,
  EIS_CLIENT_ID: undefined,
};

test("config: defaults (dry-run, maxTenders=100, задержки)", () => {
  withEnv({ ...CLEAN, EIS_AUTH_TOKEN: "tok-123" }, () => {
    const cfg = loadEisConfig();
    assert.equal(cfg.dryRun, true);
    assert.equal(cfg.maxTenders, 100);
    assert.equal(cfg.requestDelayMs, 1000);
    assert.equal(cfg.maxRetries, 3);
    assert.equal(cfg.timeoutMs, 30000);
    assert.equal(cfg.storagePath, "./data");
    assert.ok(cfg.baseUrl.startsWith("https://"));
  });
});

test("config: без токена — CONFIG_ERROR (legacy логин не принимается)", () => {
  withEnv({ ...CLEAN, EIS_USERNAME: "user", EIS_CLIENT_ID: "cid" }, () => {
    assert.throws(() => loadEisConfig(), (err: unknown) => {
      assert.ok(err instanceof Error && err.message.includes("EIS_AUTH_TOKEN"));
      return true;
    });
  });
});

test("config: maxTenders > hard cap отклоняется (защита от 10k/50k)", () => {
  withEnv({ ...CLEAN, EIS_AUTH_TOKEN: "t", EIS_MAX_TENDERS: String(EIS_MAX_TENDERS_HARD_CAP + 1) }, () => {
    assert.throws(() => loadEisConfig(), /превышает жёсткий потолок/);
  });
  withEnv({ ...CLEAN, EIS_AUTH_TOKEN: "t", EIS_MAX_TENDERS: "1000" }, () => {
    assert.equal(loadEisConfig().maxTenders, 1000);
  });
});

test("config: overrides CLI приоритетнее ENV", () => {
  withEnv({ ...CLEAN, EIS_AUTH_TOKEN: "env-token", EIS_MAX_TENDERS: "50" }, () => {
    const cfg = loadEisConfig({ maxTenders: 10, dryRun: false });
    assert.equal(cfg.maxTenders, 10);
    assert.equal(cfg.dryRun, false);
    assert.equal(cfg.authToken, "env-token");
  });
});

test("config: redactedConfig не содержит секрета", () => {
  withEnv({ ...CLEAN, EIS_AUTH_TOKEN: "super-secret-token" }, () => {
    const redacted = JSON.stringify(redactedConfig(loadEisConfig()));
    assert.ok(!redacted.includes("super-secret-token"));
    assert.ok(redacted.includes("***"));
  });
});

test("config: parseLaw и parseDateParam", () => {
  assert.equal(parseLaw(undefined), "44fz");
  assert.equal(parseLaw("44fz"), "44fz");
  assert.equal(parseLaw("223-FZ"), "223fz");
  assert.throws(() => parseLaw("44"), /Неизвестный law/);
  assert.equal(parseDateParam("date-from", "2026-09-01"), "2026-09-01");
  assert.equal(parseDateParam("date-from", undefined), undefined);
  assert.throws(() => parseDateParam("date-from", "01.09.2026"), /YYYY-MM-DD/);
});
