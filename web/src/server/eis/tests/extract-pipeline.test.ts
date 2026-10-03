// EIS Document Intelligence: tender-pipeline (поиск RAW, идемпотентность, статистика, CLI). Запуск: npm test.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import ExcelJS from "exceljs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { pdf } from "../../../lib/pdf-fixtures.ts";
import { sha256Hex } from "../storage.ts";
import { extractTender, findTenderDirs } from "../extract/pipeline.ts";
import type { EisNormalizedDocument } from "../extract/types.ts";

const WEB_DIR = fileURLToPath(new URL("../../../..", import.meta.url));
const REG = "0373100130926000001";
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

async function xlsxBytes(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Спецификация");
  sheet.getCell("A1").value = "Наименование";
  sheet.getCell("B1").value = "Количество";
  sheet.getCell("A2").value = "Бумага";
  sheet.getCell("B2").value = 100;
  return new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer);
}

interface FakeTender {
  root: string;
  rawDir: string;
}

/** Поддельная закупка в RAW-раскладке коллектора: manifest + файлы. */
async function fakeTender(files: Array<{ name: string; bytes: Uint8Array }>): Promise<FakeTender> {
  const root = mkdtempSync(join(tmpdir(), "eis-extract-"));
  const rawDir = join(root, "raw", "44fz", "2026", "09", REG);
  mkdirSync(rawDir, { recursive: true });
  const documents = files.map((f) => {
    const fileName = `${f.name.replace(/[^a-z0-9._-]+/gi, "_")}__${f.name}`;
    writeFileSync(join(rawDir, fileName), f.bytes);
    return {
      tenderRegistryNumber: REG,
      law: "44fz" as const,
      documentId: f.name,
      documentType: "test",
      fileName: f.name,
      downloadedAt: "2026-10-03T00:00:00.000Z",
      sha256: sha256Hex(f.bytes),
      size: f.bytes.byteLength,
      localPath: `raw/44fz/2026/09/${REG}/${fileName}`,
    };
  });
  writeFileSync(
    join(rawDir, "manifest.json"),
    JSON.stringify({ schemaVersion: 1, tenderRegistryNumber: REG, law: "44fz", metadata: {}, documents, collectedAt: "", collectorVersion: "" }),
  );
  writeFileSync(join(rawDir, "tender.json"), JSON.stringify({ registryNumber: REG }));
  return { root, rawDir };
}

const readDoc = (root: string, name: string): EisNormalizedDocument =>
  JSON.parse(readFileSync(join(root, "normalized", "documents", REG, name), "utf-8")) as EisNormalizedDocument;

test("pipeline: находит закупку, извлекает все форматы, RAW неизменен", async () => {
  const xml = enc("<notice><title>Закупка</title></notice>");
  const { root, rawDir } = await fakeTender([
    { name: "notice.pdf", bytes: pdf(["PROTOKOL PODVEDENIYA ITOGOV ZAPROSA KOTIROVOK"]) },
    { name: "spec.xlsx", bytes: await xlsxBytes() },
    { name: "notice.xml", bytes: xml },
  ]);
  assert.equal(findTenderDirs(root, REG).length, 1);
  assert.equal(findTenderDirs(root, "0000000000000000000").length, 0);

  const stats = await extractTender(root, REG, {});
  assert.equal(stats.documents, 3);
  assert.ok(stats.pages >= 3);
  assert.ok(stats.tables >= 1);
  assert.equal(stats.failed, 0);
  assert.equal(stats.skipped, 0);

  const pdfDoc = readDoc(root, "notice.pdf__notice.pdf.json");
  assert.equal(pdfDoc.schemaVersion, 1);
  assert.equal(pdfDoc.document.sha256, sha256Hex(pdf(["PROTOKOL PODVEDENIYA ITOGOV ZAPROSA KOTIROVOK"])));
  assert.equal(pdfDoc.extraction.status, "complete");
  const xlsxDoc = readDoc(root, "spec.xlsx__spec.xlsx.json");
  assert.equal(xlsxDoc.tables[0]?.rows[1]?.[0]?.text, "Бумага");
  const xmlDoc = readDoc(root, "notice.xml__notice.xml.json");
  assert.ok((xmlDoc.elements ?? []).some((e) => e.text === "Закупка"));
  assert.ok((xmlDoc.xmlSource ?? "").includes("<notice>"));
  // RAW-файлы не тронуты.
  assert.deepEqual(new Uint8Array(readFileSync(join(rawDir, "notice.xml__notice.xml"))), xml);
});

test("pipeline: повторный запуск идемпотентен (skipped, файлы не переписываются)", async () => {
  const { root } = await fakeTender([{ name: "a.pdf", bytes: pdf(["Pervichnyj tekst izveshcheniya o zakupke"]) }]);
  const first = await extractTender(root, REG, {});
  assert.equal(first.skipped, 0);
  const path = join(root, "normalized", "documents", REG, "a.pdf__a.pdf.json");
  const before = readFileSync(path, "utf-8");
  const second = await extractTender(root, REG, {});
  assert.equal(second.documents, 1);
  assert.equal(second.skipped, 1);
  assert.equal(readFileSync(path, "utf-8"), before);
});

test("pipeline: изменившийся hash → новая версия, неизменённые → skipped", async () => {
  const { root, rawDir } = await fakeTender([
    { name: "a.pdf", bytes: pdf(["Pervaya redakciya izveshcheniya o provedenii zakupki"]) },
    { name: "b.xml", bytes: enc("<v>1</v>") },
  ]);
  await extractTender(root, REG, {});
  writeFileSync(join(rawDir, "a.pdf__a.pdf"), pdf(["Vtoraya redakciya izveshcheniya posle vneseniya izmenenij"]));
  const stats = await extractTender(root, REG, {});
  assert.equal(stats.skipped, 1);
  const updated = JSON.parse(
    readFileSync(join(root, "normalized", "documents", REG, "a.pdf__a.pdf.json"), "utf-8"),
  ) as EisNormalizedDocument;
  assert.ok(updated.pages[0]?.blocks.some((b) => b.text.includes("Vtoraya redakciya")));
});

test("pipeline: битый файл и отсутствующий RAW — failed, остальные обрабатываются", async () => {
  const { root } = await fakeTender([
    { name: "good.xml", bytes: enc("<ok>yes</ok>") },
    { name: "bad.pdf", bytes: enc("%PDF-1.4 broken"),
    },
  ]);
  const manifestPath = join(root, "raw", "44fz", "2026", "09", REG, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { documents: Array<Record<string, unknown>> };
  manifest.documents.push({ documentId: "ghost.pdf", fileName: "ghost.pdf", localPath: "raw/nope.pdf", sha256: "0".repeat(64) });
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const stats = await extractTender(root, REG, {});
  assert.equal(stats.documents, 2);
  assert.equal(stats.failed, 2);
  assert.equal(stats.ocrRequired, 0);
});

test("pipeline: несуществующая закупка — понятная ошибка", async () => {
  const root = mkdtempSync(join(tmpdir(), "eis-empty-"));
  await assert.rejects(() => extractTender(root, "0000000000000000000", {}), /не найдена/);
});

test("pipeline: CLI eis:extract печатает статистику documents/pages/tables/ocrRequired/failed", async () => {
  const { root } = await fakeTender([
    { name: "a.pdf", bytes: pdf(["Tekst izveshcheniya dlya komandy izvlecheniya dokumentov"]) },
    { name: "scan.pdf", bytes: pdf([null]) },
  ]);
  const spawned = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./scripts/test-alias.mjs", "scripts/eis-extract.ts", `--tender=${REG}`, `--storage=${root}`],
    { cwd: WEB_DIR, encoding: "utf-8", timeout: 120000, env: { ...process.env, EIS_OCR_PROVIDER: "none" } },
  );
  const out = `${spawned.stdout ?? ""}\n${spawned.stderr ?? ""}`;
  assert.equal(spawned.status, 0, out);
  for (const line of ["documents: 2", "pages: 2", "tables: 0", "ocrRequired: 1", "failed: 0"]) {
    assert.ok(out.includes(line), `${line}\n${out}`);
  }
  assert.ok(existsSync(join(root, "normalized", "documents", REG, "scan.pdf__scan.pdf.json")));
});
