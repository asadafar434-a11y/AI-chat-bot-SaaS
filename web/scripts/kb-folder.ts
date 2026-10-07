// База знаний из папки с документами: npm run kb:folder — отчёт по файлам; с флагом --ingest — запись в PostgreSQL.
//
//   npm run kb:folder                                         отчёт, ничего не записывает
//   npm run kb:folder -- --ingest --owner-org=<id>            записать в базу одной организации
//   npm run kb:folder -- --ingest --global-approver=<имя>     записать в общую базу (только если это решено)
//
// Для записи нужна DATABASE_URL (локальная база: npm run db:up, затем npm run db:migrate:deploy).
// Платного OCR здесь нет: сканы попадают в отчёт как «нужен OCR» и в базу не идут.

import { copyFileSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { GOLD_FOLDER } from "../src/lib/gold-folder.ts";
import { deleteDocument, ingestDocument } from "../src/lib/kb-ingest.ts";
import { dedupeByText, documentText, documentTypeOf, flattenReports, normativeDocumentType, reportOf, summarize, type FileReport } from "../src/lib/kb-folder.ts";
import { localEmbedder } from "../src/lib/kb-embed.ts";
import { createDbKbStore } from "../src/lib/kb-store-db.ts";
import { ownerKeyOf, type KbOwner } from "../src/lib/kb-types.ts";
import { disconnectPrisma, getDb } from "../src/server/db/client.ts";
import { extractDocument } from "../src/server/eis/extract/pipeline.ts";
import { NoopOcrProvider, resolveOcrProvider, type OcrProvider } from "../src/server/eis/extract/ocr.ts";
import type { EisNormalizedDocument } from "../src/server/eis/extract/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const args = new Map(process.argv.slice(2).map((a) => {
  const [key, ...rest] = a.replace(/^--/, "").split("=");
  return [key, rest.length ? rest.join("=") : "true"];
}));

const folder = resolve(String(args.get("folder") ?? join(webRoot, "..", "Татьяна-Примеры документов")));

function walk(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => !name.startsWith("."))
    .flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
}

// Старый .doc (Word 97–2003) читает antiword, если он установлен. Путь с кириллицей копируем во временный
// файл с латинским именем: так antiword его открывает. Без antiword .doc остаётся нечитаемым, как и раньше.
function antiwordText(file: string): string | null {
  try {
    const dir = mkdtempSync(join(tmpdir(), "kb-doc-"));
    const copy = join(dir, "source.doc");
    copyFileSync(file, copy);
    const text = execFileSync("antiword", ["-m", "UTF-8.txt", copy], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
    return text || null;
  } catch {
    return null;
  }
}

const kindOf = (path: string) => GOLD_FOLDER.find((d) => d.path === path)?.kind;

// --ocr=anthropic: сканы читает ИИ. Это платно (около 3 ₽ за страницу), поэтому без флага не запускается.
async function ocrFromArgs(): Promise<OcrProvider> {
  const kind = args.get("ocr");
  if (!kind || kind === "true") return new NoopOcrProvider();
  if (kind !== "anthropic") throw new Error("--ocr: поддерживается только anthropic");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("--ocr=anthropic: нет ANTHROPIC_API_KEY в окружении (см. web/.env.local)");
  return resolveOcrProvider("anthropic");
}

const docOverrides = new Map<string, string>();

async function extractAll(ocrProvider: OcrProvider): Promise<{ path: string; doc: EisNormalizedDocument }[]> {
  const out: { path: string; doc: EisNormalizedDocument }[] = [];
  for (const file of walk(folder).sort()) {
    const path = relative(folder, file).split(sep).join("/");
    const bytes = new Uint8Array(readFileSync(file));
    const doc = await extractDocument(
      { id: createHash("sha1").update(path).digest("hex").slice(0, 12), tenderRegistryNumber: "folder", fileName: path.split("/").pop()!, documentType: "folder", bytes },
      { ocrProvider },
    );
    if (file.toLowerCase().endsWith(".doc")) {
      const text = antiwordText(file);
      if (text) docOverrides.set(path, text);
    }
    out.push({ path, doc });
  }
  return out;
}

function printReport(reports: FileReport[]) {
  for (const r of flattenReports(reports)) {
    const indent = r.path.includes("!") ? "    " : "";
    console.log(`${indent}${r.status.padEnd(11)} ${String(r.chars).padStart(7)}  ${r.path}${r.note ? `  — ${r.note}` : ""}`);
  }
  console.log("\nИтого:", JSON.stringify(summarize(reports)));
}

function ownerFromArgs(): KbOwner | null {
  const org = args.get("owner-org");
  const approver = args.get("global-approver");
  if (org && approver) throw new Error("укажите одного владельца: --owner-org или --global-approver");
  if (org && org !== "true") return { kind: "org", organizationId: org };
  if (approver && approver !== "true") return { kind: "global", approvedBy: approver };
  return null;
}

async function main() {
  const extracted = await extractAll(await ocrFromArgs());
  const reports = extracted.map(({ path, doc }) => {
    const report = reportOf(path, doc);
    const text = docOverrides.get(path);
    return text ? { ...report, status: "readable" as const, chars: text.length, note: "прочитан через antiword" } : report;
  });
  console.log(`Папка: ${folder}\n`);
  printReport(reports);

  if (!args.has("ingest")) {
    console.log("\nВ базу ничего не записано. Чтобы записать, укажите владельца: --owner-org=<id> или --global-approver=<имя>.");
    return;
  }
  const owner = ownerFromArgs();
  if (!owner) throw new Error("для записи укажите владельца: --owner-org=<id> или --global-approver=<имя>");
  if (!process.env.DATABASE_URL) throw new Error("для записи нужна DATABASE_URL (локальная база: npm run db:up, затем npm run db:migrate:deploy)");

  const store = createDbKbStore(getDb());
  const now = new Date();
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let removed = 0;
  let metadataUpdated = 0;

  // Элементы папки: сами файлы и вложения архивов (архив целиком в базу не идёт).
  const items = extracted.flatMap(({ path, doc }) => {
    const walkChildren = (p: string, d: EisNormalizedDocument): { path: string; doc: EisNormalizedDocument }[] =>
      (d.children ?? []).flatMap((c) => {
        const childPath = `${p}!${c.document.fileName}`;
        return [{ path: childPath, doc: c }, ...walkChildren(childPath, c)];
      });
    return [{ path, doc }, ...walkChildren(path, doc)];
  });

  const withText = items
    // README — пояснение для человека, не знание для базы.
    .filter(({ path, doc }) => doc.document.format !== "zip" && path.split("/").pop() !== "README.txt" && (doc.extraction.status !== "failed" || docOverrides.has(path)))
    .map(({ path, doc }) => ({ path, doc, text: docOverrides.get(path) ?? documentText(doc) }))
    .filter((item) => {
      if (!item.text) skipped++;
      return !!item.text;
    });

  // Одинаковые тексты (например, один и тот же файл в корне, в «архив 223» и в zip) — одна копия в базе.
  // Копии, которые уже записаны раньше, снимаем с поиска.
  const { kept, duplicates } = dedupeByText(withText.map(({ path, text }) => ({ path, text })));
  const keep = new Set(kept);
  for (const dup of duplicates) {
    const before = await store.getDocument(ownerKeyOf(owner), `folder:${dup.path}`);
    if (before?.status === "active") {
      await deleteDocument(store, owner, `folder:${dup.path}`, now);
      removed++;
    }
  }
  if (duplicates.length) console.log(`\nОдинаковые копии (в базу не берём): ${duplicates.length}`, duplicates.map((d) => `\n  ${d.path}  =  ${d.of}`).join(""));

  for (const { path, text } of withText) {
    if (!keep.has(path)) continue;
    const topPath = path.split("!")[0];
    const result = await ingestDocument(
      store,
      localEmbedder,
      {
        owner,
        sourceKey: `folder:${path}`,
        name: path.split("/").pop()!.split("!").pop()!,
        source: "папка «Татьяна-Примеры документов»",
        text,
        meta: { documentType: normativeDocumentType(topPath) ?? documentTypeOf(kindOf(topPath)), reliability: "unverified" },
      },
      now,
    );
    if (result.status === "created") created++;
    else if (result.status === "updated") updated++;
    else if (result.status === "metadata_updated") metadataUpdated++;
    else unchanged++;
  }

  console.log(`\nВ базу (PostgreSQL): создано ${created}, обновлено ${updated}, метаданные обновлены ${metadataUpdated}, без изменений ${unchanged}, пропущено (нет текста) ${skipped}, снято с поиска (старые копии) ${removed}.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
