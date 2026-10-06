// Разметка папки «Татьяна-Примеры документов» полная и согласованная — npm test.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { GOLD_FOLDER } from "./gold-folder.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Татьяна-Примеры документов");
const onDisk = (readdirSync(ROOT, { recursive: true }) as string[])
  .map((f) => f.split(path.sep).join("/"))
  .filter((f) => /\.(docx|doc|pdf|zip)$/i.test(f))
  .sort();

test("каждый документ папки размечен, и нет разметки на несуществующий файл", () => {
  assert.deepEqual(GOLD_FOLDER.map((d) => d.path).sort(), onDisk);
});

// «образец участника» может не содержать ФИО (техническое предложение только с ценами), поэтому его флаг не проверяем
test("бланк заказчика пустой — персональных данных в нём нет", () => {
  for (const d of GOLD_FOLDER) {
    if (d.kind === "бланк заказчика") assert.equal(d.personal, false, d.path);
  }
});

test("протокол отклонения указывает причину", () => {
  const protocol = GOLD_FOLDER.find((d) => d.path.endsWith("Протокол заседания комиссии.doc"));
  assert.match(protocol?.note ?? "", /отклонена/);
});
