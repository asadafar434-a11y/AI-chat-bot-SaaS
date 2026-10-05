/**
 * Read reconciliation S4: сверка legacy-представления (из копии IndexedDB)
 * с серверным представлением (из PostgreSQL).
 *
 * Это тестовая реализация dual-read из migration-and-rollback.md: вместо
 * параллельного чтения в production сравниваются два представления одних данных
 * по каноническим правилам S3 (`stableStringify` + sha256). Расхождение —
 * повод разбираться, а не переключать чтение.
 *
 * Правила сравнения:
 * - закупки и факты — по `legacyId`, документы — по паре
 *   `(purchaseLegacyId, sha256 текста, имя)`, образцы — по `legacyId`;
 * - legacy-форма повторяет поведение браузерного чтения (`fromStore` +
 *   shaping-правила `readFact`/`readMyDocument`/`getProfile`; storage-модули
 *   сюда не импортируются, равенство с ними зафиксировано тестом);
 * - тексты документов и образцов сравниваются только хешами: сервер текстов
 *   не хранит до S6, и это ожидаемо, а не расхождение.
 */

import type { Dump } from "@/lib/backup-format";
import { fromStore } from "@/lib/data-format";
import { cleanAnswers, FACT_KINDS } from "@/lib/evidence-base";
import { EMPTY_PROFILE, PROFILE_KEYS } from "@/lib/profile";

import { recordChecksum, setChecksum, sha256Hex } from "../import/canonical.ts";
import { mapSample } from "../import/mapping.ts";
import {
  listDocuments,
  listFacts,
  listPurchases,
  listSamples,
  readProfile,
  type ReadContext,
} from "./services.ts";

export type ReadComparison = {
  entity: "purchases" | "documents" | "facts" | "samples" | "profile";
  sourceCount: number;
  serverCount: number;
  checksumMatch: boolean;
  sourceChecksum: string;
  serverChecksum: string;
  missing: string[];
  extra: string[];
  /** legacyId, встречающиеся более чем в одной серверной строке (этап S5). */
  duplicates: string[];
};

/** Идентификаторы, встречающиеся в списке более одного раза. */
export function findDuplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      dupes.add(id);
    }
    seen.add(id);
  }
  return [...dupes].sort();
}

type View = { key: string; checksum: string };

function purchaseViews(dump: Dump): View[] {
  const out: View[] = [];
  for (const raw of dump.purchases) {
    if (typeof (raw as { id?: unknown }).id !== "string") {
      continue;
    }
    let migrated: Record<string, unknown>;
    try {
      migrated = fromStore<Record<string, unknown>>("purchase", raw);
    } catch {
      continue;
    }
    const { id, v: _v, ...rest } = migrated as Record<string, unknown> & { id: string };
    void _v;
    out.push({ key: id, checksum: recordChecksum({ ...rest, id }) });
  }
  return out;
}

async function serverPurchaseViews(ctx: ReadContext): Promise<{ views: View[]; ids: string[] }> {
  const list = await listPurchases(ctx);
  const ids = list.map((p) => (p as unknown as { id: string }).id);
  const views = list.map((p) => {
    const { id, ...rest } = p as unknown as Record<string, unknown> & { id: string };
    return { key: id, checksum: recordChecksum({ ...rest, id }) };
  });
  return { views, ids };
}

async function documentViews(
  ctx: ReadContext,
  dump: Dump,
): Promise<{ legacy: View[]; server: View[]; ids: string[]; dupPurchases: string[] }> {
  const legacy: View[] = [];
  for (const [purchaseId, docs] of dump.documents) {
    for (const raw of docs) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        continue;
      }
      const doc = raw as Record<string, unknown>;
      if (typeof doc.name !== "string" || !doc.name) {
        continue;
      }
      const text = typeof doc.text === "string" ? doc.text : "";
      const sha = sha256Hex(text);
      legacy.push({
        key: `${purchaseId}:${sha}:${doc.name}`,
        checksum: recordChecksum({ purchaseLegacyId: purchaseId, name: doc.name, scan: doc.scan === true, sha256: sha }),
      });
    }
  }
  const server: View[] = [];
  const ids: string[] = [];
  const dupPurchases: string[] = [];
  for (const purchase of await listPurchases(ctx)) {
    const pid = (purchase as unknown as { id: string }).id;
    let metas;
    try {
      metas = await listDocuments(ctx, pid);
    } catch (error) {
      // Дубль закупки: чтение отказывает (fail closed), а диагностика обязана
      // показать дубль, а не упасть вместе с чтением.
      if (error instanceof Error && error.name === "DuplicateLegacyIdError") {
        dupPurchases.push(pid);
        continue;
      }
      throw error;
    }
    // purchaseLegacyId восстанавливается из ключа сервера: id сервера — это
    // legacyId, если он был, иначе восстановить принадлежность нельзя.
    for (const meta of metas) {
      ids.push(meta.id);
      server.push({
        key: `${pid}:${meta.sha256 ?? ""}:${meta.name}`,
        checksum: recordChecksum({ purchaseLegacyId: pid, name: meta.name, scan: meta.scan, sha256: meta.sha256 ?? "" }),
      });
    }
  }
  return { legacy, server, ids, dupPurchases };
}

function factViews(dump: Dump): View[] {
  const out: View[] = [];
  for (const raw of dump.facts) {
    const id = (raw as { id?: unknown }).id;
    if (typeof id !== "string" || !id) {
      continue;
    }
    let f: Record<string, unknown>;
    try {
      f = fromStore<Record<string, unknown>>("fact", raw);
    } catch {
      continue;
    }
    // Shaping повторяет `readFact` (evidence-store.ts:10-30) по доменным частям.
    if (typeof f.id !== "string" || typeof f.title !== "string" || typeof f.kind !== "string" || !(f.kind in FACT_KINDS)) {
      continue;
    }
    const origin = f.origin === "ai" ? "ai" : "human";
    const answers = cleanAnswers(f.answers);
    out.push({
      key: id,
      checksum: recordChecksum({
        id,
        kind: f.kind,
        title: f.title,
        fields: f.fields ?? {},
        measures: f.measures ?? [],
        validity: f.validity ?? {},
        source: f.source ?? {},
        origin,
        confirmed: origin === "human" ? true : f.confirmed === true,
        ...(answers.length > 0 ? { answers } : {}),
      }),
    });
  }
  return out;
}

async function serverFactViews(ctx: ReadContext): Promise<{ views: View[]; ids: string[] }> {
  const list = await listFacts(ctx);
  const ids = list.map((f) => (f as unknown as { id: string }).id);
  const views = list.map((f) => {
    const row = f as unknown as Record<string, unknown> & { id: string };
    const { id, createdAt: _c, updatedAt: _u, ...rest } = row;
    void _c;
    void _u;
    return { key: id, checksum: recordChecksum({ ...rest, id }) };
  });
  return { views, ids };
}

function sampleViews(dump: Dump): View[] {
  const out: View[] = [];
  for (const raw of dump.samples) {
    const mapped = mapSample(raw, sha256Hex);
    if (!mapped.ok) {
      continue;
    }
    out.push({
      key: mapped.record.legacyId,
      checksum: recordChecksum({ legacyId: mapped.record.legacyId, kinds: mapped.record.kinds, about: mapped.record.about }),
    });
  }
  return out;
}

async function serverSampleViews(ctx: ReadContext): Promise<{ views: View[]; ids: string[] }> {
  const list = await listSamples(ctx);
  const ids = list.map((s) => s.id);
  const views = list.map((s) => ({
    key: s.id,
    checksum: recordChecksum({ legacyId: s.id, kinds: s.kinds, about: s.about }),
  }));
  return { views, ids };
}

function profileLegacyView(dump: Dump): { present: boolean; checksum: string } {
  let profileRaw: unknown;
  for (const [key, value] of dump.settings) {
    if (key === "profile") {
      profileRaw = value;
    }
  }
  if (profileRaw === undefined) {
    return { present: false, checksum: "" };
  }
  let migrated: Record<string, unknown>;
  try {
    migrated = fromStore<Record<string, unknown>>("profile", profileRaw);
  } catch {
    return { present: false, checksum: "" };
  }
  // Как `getProfile` (me-store.ts:57-60): поверх EMPTY_PROFILE, но только
  // известные ключи — неизвестные импорт отбрасывает (см. splitProfile).
  const known: Record<string, unknown> = {};
  for (const key of PROFILE_KEYS) {
    if (key in migrated) {
      known[key] = migrated[key];
    }
  }
  return { present: true, checksum: recordChecksum({ ...EMPTY_PROFILE, ...known }) };
}

function compare(legacy: View[], server: View[]): { match: boolean; missing: string[]; extra: string[]; sourceChecksum: string; serverChecksum: string } {
  const legacyByKey = new Map(legacy.map((v) => [v.key, v.checksum]));
  const serverByKey = new Map(server.map((v) => [v.key, v.checksum]));
  const missing = [...legacyByKey.keys()].filter((k) => !serverByKey.has(k));
  const extra = [...serverByKey.keys()].filter((k) => !legacyByKey.has(k));
  const commonMismatch = [...legacyByKey.keys()].filter((k) => serverByKey.has(k) && serverByKey.get(k) !== legacyByKey.get(k));
  const sourceChecksum = setChecksum(legacy.map((v) => v.checksum));
  const serverChecksum = setChecksum(server.map((v) => v.checksum));
  return {
    match: missing.length === 0 && extra.length === 0 && commonMismatch.length === 0,
    missing: [...missing, ...commonMismatch.map((k) => `${k}~`)],
    extra,
    sourceChecksum,
    serverChecksum,
  };
}

/**
 * Сверяет копию IndexedDB с серверным чтением. Возвращает сравнение по каждой
 * сущности и общий флаг. Не пишет ничего никуда.
 */
export async function reconcileReads(
  ctx: ReadContext,
  dump: Dump,
): Promise<{ comparisons: ReadComparison[]; match: boolean }> {
  const comparisons: ReadComparison[] = [];

  const legacyPurchases = purchaseViews(dump);
  const serverPurchased = await serverPurchaseViews(ctx);
  const comparedPurchases = compare(legacyPurchases, serverPurchased.views);
  comparisons.push({
    entity: "purchases",
    sourceCount: legacyPurchases.length,
    serverCount: serverPurchased.views.length,
    checksumMatch: comparedPurchases.match,
    sourceChecksum: comparedPurchases.sourceChecksum,
    serverChecksum: comparedPurchases.serverChecksum,
    missing: comparedPurchases.missing,
    extra: comparedPurchases.extra,
    duplicates: findDuplicates(serverPurchased.ids),
  });

  const docs = await documentViews(ctx, dump);
  const comparedDocs = compare(docs.legacy, docs.server);
  comparisons.push({
    entity: "documents",
    sourceCount: docs.legacy.length,
    serverCount: docs.server.length,
    checksumMatch: comparedDocs.match && docs.dupPurchases.length === 0,
    sourceChecksum: comparedDocs.sourceChecksum,
    serverChecksum: comparedDocs.serverChecksum,
    missing: comparedDocs.missing,
    extra: comparedDocs.extra,
    duplicates: [...findDuplicates(docs.ids), ...docs.dupPurchases].sort(),
  });

  const legacyFacts = factViews(dump);
  const serverFacted = await serverFactViews(ctx);
  const comparedFacts = compare(legacyFacts, serverFacted.views);
  comparisons.push({
    entity: "facts",
    sourceCount: legacyFacts.length,
    serverCount: serverFacted.views.length,
    checksumMatch: comparedFacts.match,
    sourceChecksum: comparedFacts.sourceChecksum,
    serverChecksum: comparedFacts.serverChecksum,
    missing: comparedFacts.missing,
    extra: comparedFacts.extra,
    duplicates: findDuplicates(serverFacted.ids),
  });

  const legacySamples = sampleViews(dump);
  const serverSampled = await serverSampleViews(ctx);
  const comparedSamples = compare(legacySamples, serverSampled.views);
  comparisons.push({
    entity: "samples",
    sourceCount: legacySamples.length,
    serverCount: serverSampled.views.length,
    checksumMatch: comparedSamples.match,
    sourceChecksum: comparedSamples.sourceChecksum,
    serverChecksum: comparedSamples.serverChecksum,
    missing: comparedSamples.missing,
    extra: comparedSamples.extra,
    duplicates: findDuplicates(serverSampled.ids),
  });

  const legacyProfile = profileLegacyView(dump);
  const serverProfile = await readProfile(ctx);
  const serverChecksum = recordChecksum(serverProfile.profile);
  const profileMatch =
    legacyProfile.present &&
    serverChecksum === legacyProfile.checksum &&
    (serverProfile.meta.version as number) >= 1;
  comparisons.push({
    entity: "profile",
    sourceCount: legacyProfile.present ? 1 : 0,
    serverCount: 1,
    checksumMatch: profileMatch,
    sourceChecksum: legacyProfile.checksum,
    serverChecksum,
    missing: legacyProfile.present && !profileMatch ? ["profile"] : [],
    extra: [],
    duplicates: [],
  });

  return { comparisons, match: comparisons.every((c) => c.checksumMatch) };
}
