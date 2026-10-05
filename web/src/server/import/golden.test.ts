/**
 * Каркас golden-standard тестов переноса S3 (задача S3.L).
 *
 * Эталонные пары лежат в `web/tests/golden/cases/`:
 * `<name>.backup.json` (сырая копия) + `<name>.expected.json` (ожидаемая сверка).
 * Здесь — только механизм: поиск пар, прогон pipeline на чистой in-memory БД,
 * сравнение подмножества сверки. Самих эталонов в репозитории пока нет —
 * реальные обезличенные пары добавим отдельно; пустой каталог — проходящий
 * тест с явной пометкой, а не молчание.
 *
 * Формат `expected.json` описан в `docs/stage-11/golden-standards/README.md`.
 */

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { withRunner } from "../auth/transaction.ts";
import { orgScope } from "../db/org-scope.ts";
import { createMemoryDb } from "../auth/testing/memory-db.ts";
import { runLegacyImport } from "./pipeline.ts";

const CASES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "golden", "cases");

async function listBackups(): Promise<string[]> {
  try {
    return (await readdir(CASES)).filter((f) => f.endsWith(".backup.json")).sort();
  } catch {
    return [];
  }
}

test("golden: эталонные сверки переноса", async () => {
  const backups = await listBackups();
  if (backups.length === 0) {
    assert.ok(true, "эталонов пока нет: каркас готов, ждём реальные обезличенные пары");
    return;
  }
  for (const file of backups) {
    const name = file.replace(/\.backup\.json$/, "");
    const raw = await readFile(join(CASES, file), "utf8");
    let expected: Record<string, unknown>;
    try {
      expected = JSON.parse(await readFile(join(CASES, `${name}.expected.json`), "utf8")) as Record<string, unknown>;
    } catch {
      assert.fail(`эталон ${name}: нет парного ${name}.expected.json`);
    }
    const memory = createMemoryDb();
    const organizationId = expected.organizationId as string;
    const userId = expected.userId as string;
    memory.table("membership").push({ organizationId, userId });
    const run = await runLegacyImport({
      db: memory.db,
      run: withRunner(memory.db),
      scope: orgScope(organizationId),
      userId,
      raw,
      batchKey: `golden-${name}`,
    });

    assert.equal(run.reconciliation.verdict, expected.verdict, `${name}: verdict`);
    const counts = expected.counts as Record<string, Record<string, number>> | undefined;
    for (const [entity, want] of Object.entries(counts ?? {})) {
      const got = run.reconciliation.counts[entity as keyof typeof run.reconciliation.counts];
      for (const [key, value] of Object.entries(want)) {
        assert.equal(
          (got as Record<string, number>)[key],
          value,
          `${name}: counts.${entity}.${key}`,
        );
      }
    }
    const checksums = expected.checksums as Record<string, string> | undefined;
    for (const [entity, want] of Object.entries(checksums ?? {})) {
      assert.equal(
        run.reconciliation.checksums[entity as keyof typeof run.reconciliation.checksums].source,
        want,
        `${name}: checksums.${entity}`,
      );
    }
    if (expected.aggregates !== undefined) {
      assert.deepEqual(run.reconciliation.aggregates.source, expected.aggregates, `${name}: aggregates`);
    }
  }
});
