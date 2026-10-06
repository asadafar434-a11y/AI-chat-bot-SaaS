// Граница между Golden Dataset (эталон) и базой знаний — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GOLD_FOLDER, type GoldDoc } from "./gold-folder.ts";
import { localEmbedder } from "./kb-embed.ts";
import { classifyGoldFolder, promoteGoldDocument, promotionDecision } from "./kb-golden.ts";
import { createMemoryKbStore } from "./kb-store.ts";

const entry = (over: Partial<GoldDoc>): GoldDoc => ({ path: "x.docx", kind: "прочее", personal: false, ...over });

test("в базу знаний по умолчанию не берётся ни один документ эталона", () => {
  const allowed = classifyGoldFolder().filter((row) => row.decision.allowed);
  assert.deepEqual(
    allowed.map((row) => row.path),
    [],
    "эталон — для проверки качества; переход в базу знаний только после переписывания и утверждения человеком",
  );
});

test("персональные данные участника — отказ даже после переписывания", () => {
  for (const kind of ["образец участника", "извещение", "техническое задание"] as const) {
    assert.equal(promotionDecision(entry({ kind, personal: true }), true).allowed, false, kind);
  }
});

test("протокол, архив и заполненный участником образец — отказ всегда", () => {
  for (const kind of ["протокол", "архив", "образец участника"] as const) {
    assert.equal(promotionDecision(entry({ kind }), true).allowed, false, kind);
  }
});

test("материал конкретной закупки — только после переписывания в общий вид", () => {
  const notice = entry({ kind: "извещение" });
  assert.equal(promotionDecision(notice, false).allowed, false);
  assert.equal(promotionDecision(notice, true).allowed, true);
});

test("явное добавление: отказ с причиной, а при разрешении — документ в общей базе со ссылкой на эталон", async () => {
  const store = createMemoryKbStore();
  const protocol = GOLD_FOLDER.find((d) => d.kind === "протокол")!;
  await assert.rejects(
    promoteGoldDocument(store, localEmbedder, {
      entry: protocol,
      text: "Протокол комиссии: заявка отклонена.",
      documentType: "filled_example",
      approvedBy: "Владелец продукта",
      rewritten: true,
      name: "Протокол",
    }),
    /результат конкретной закупки/,
  );
  assert.equal((await store.listDocuments()).length, 0);

  const generic = entry({ path: "Общий порядок подачи.docx", kind: "документация" });
  const result = await promoteGoldDocument(store, localEmbedder, {
    entry: generic,
    text: "Общий порядок: заявка подаётся в срок, указанный в извещении, с декларацией о соответствии.",
    documentType: "instruction",
    approvedBy: "Владелец продукта",
    rewritten: true,
    name: "Порядок подачи заявки (переписан)",
  });
  assert.equal(result.status, "created");
  assert.equal(result.document.sourceKey, "golden:Общий порядок подачи.docx");
  assert.equal(result.document.source, "golden_dataset");
  assert.equal(result.document.meta.reliability, "verified");
  assert.deepEqual(result.document.owner, { kind: "global", approvedBy: "Владелец продукта" });
});
