// База знаний из папки с документами: npm run kb:folder — отчёт по файлам; с флагом --ingest — запись в базу.
//
//   npm run kb:folder                                         отчёт, ничего не записывает
//   npm run kb:folder -- --ingest --owner-org=<id>            записать в базу одной организации
//   npm run kb:folder -- --ingest --global-approver=<имя>     записать в общую базу (только если это решено)
//
// Платного OCR здесь нет: сканы попадают в отчёт как «нужен OCR» и в базу не идут.
// База — файл web/data/knowledge-base.json (в git не попадает, см. .gitignore).

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { GOLD_FOLDER } from "../src/lib/gold-folder.ts";
import { ingestDocument } from "../src/lib/kb-ingest.ts";
import { documentTypeOf, documentText, flattenReports, reportOf, summarize, type FileReport } from "../src/lib/kb-folder.ts";
import { localEmbedder } from "../src/lib/kb-embed.ts";
import { createMemoryKbStore, type KbSnapshot } from "../src/lib/kb-store.ts";
import type { KbOwner } from "../src/lib/kb-types.ts";
import { extractDocument } from "../src/server/eis/extract/pipeline.ts";
import { NoopOcrProvider } from "../src/server/eis/extract/ocr.ts";
import type { EisNormalizedDocument } from "../src/server/eis/extract/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const args = new Map(process.argv.slice(2).map((a) => {
  const [key, ...rest] = a.replace(/^--/, "").split("=");
  return [key, rest.length ? rest.join("=") : "true"];
}));

const folder = resolve(String(args.get("folder") ?? join(webRoot, "..", "Татьяна-Примеры документов")));
const storePath = resolve(String(args.get("store") ?? join(webRoot, "data", "knowledge-base.json")));

function walk(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => !name.startsWith("."))
    .flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
}

const kindOf = (path: string) => GOLD_FOLDER.find((d) => d.path === path)?.kind;

async function extractAll(): Promise<{ path: string; doc: EisNormalizedDocument }[]> {
  const out: { path: string; doc: EisNormalizedDocument }[] = [];
  for (const file of walk(folder).sort()) {
    const path = relative(folder, file).split(sep).join("/");
    const bytes = new Uint8Array(readFileSync(file));
    const doc = await extractDocument(
      { id: createHash("sha1").update(path).digest("hex").slice(0, 12), tenderRegistryNumber: "folder", fileName: path.split("/").pop()!, documentType: "folder", bytes },
      { ocrProvider: new NoopOcrProvider() },
    );
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
  const extracted = await extractAll();
  const reports = extracted.map(({ path, doc }) => reportOf(path, doc));
  console.log(`Папка: ${folder}\n`);
  printReport(reports);

  if (!args.has("ingest")) {
    console.log("\nВ базу ничего не записано. Чтобы записать, укажите владельца: --owner-org=<id> или --global-approver=<имя>.");
    return;
  }
  const owner = ownerFromArgs();
  if (!owner) throw new Error("для записи укажите владельца: --owner-org=<id> или --global-approver=<имя>");

  const snapshot: KbSnapshot | undefined = existsSync(storePath) ? JSON.parse(readFileSync(storePath, "utf8")) : undefined;
  const store = createMemoryKbStore(snapshot);
  const now = new Date();
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;

  const items = extracted.flatMap(({ path, doc }) => {
    const walkChildren = (p: string, d: EisNormalizedDocument): { path: string; doc: EisNormalizedDocument }[] =>
      (d.children ?? []).flatMap((c) => {
        const childPath = `${p}!${c.document.fileName}`;
        return [{ path: childPath, doc: c }, ...walkChildren(childPath, c)];
      });
    return [{ path, doc }, ...walkChildren(path, doc)];
  });

  for (const { path, doc } of items) {
    if (doc.document.format === "zip") continue;
    const text = documentText(doc);
    if (!text || doc.extraction.status === "failed") {
      skipped++;
      continue;
    }
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
        meta: { documentType: documentTypeOf(kindOf(topPath)), reliability: "unverified" },
      },
      now,
    );
    if (result.status === "created") created++;
    else if (result.status === "updated") updated++;
    else unchanged++;
  }

  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(storePath, JSON.stringify(store.snapshot()));
  console.log(`\nВ базу: создано ${created}, обновлено ${updated}, без изменений ${unchanged}, пропущено (нет текста) ${skipped}.`);
  console.log(`Файл базы: ${storePath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
