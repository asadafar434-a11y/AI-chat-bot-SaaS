import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { Rule } from "../src/lib/core/flow/types.ts";
import { coreModules } from "../src/lib/core/modules/index.ts";

type ReviewRow = {
  id: string;
  modules: string[];
  rule: Rule;
};

const rows = (): ReviewRow[] => {
  const byId = new Map<string, ReviewRow>();
  for (const [moduleKey, module] of Object.entries(coreModules)) {
    for (const rule of module.rules) {
      const existing = byId.get(rule.id);
      if (existing) {
        if (!existing.modules.includes(moduleKey)) existing.modules.push(moduleKey);
      } else {
        byId.set(rule.id, { id: rule.id, modules: [moduleKey], rule });
      }
    }
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
};

const csvValue = (value: unknown): string => `"${String(value ?? "").replace(/"/g, '""')}"`;

const toCsv = (items: ReviewRow[]): string => {
  const header = [
    "id",
    "modules",
    "reviewScope",
    "law",
    "article",
    "condition",
    "requiredDocument",
    "riskLevel",
    "effectiveFrom",
    "source",
    "sourceUrl",
    "status",
    "reviewedAt",
    "reviewedBy",
    "edition",
    "decision",
    "notes",
  ];
  const lines = items.map(({ id, modules, rule }) =>
    [
      id,
      modules.sort().join("|"),
      rule.law === "internal" ? "internal" : "legal",
      rule.law,
      rule.article,
      rule.condition,
      rule.requiredDocument ?? "",
      rule.riskLevel,
      rule.effectiveFrom,
      rule.source,
      rule.sourceUrl ?? "",
      rule.status,
      rule.reviewedAt ?? "",
      rule.reviewedBy ?? "",
      rule.edition ?? "",
      "",
      "",
    ]
      .map(csvValue)
      .join(","),
  );
  return [header.map(csvValue).join(","), ...lines].join("\n") + "\n";
};

const check = (items: ReviewRow[]) => {
  const legalReviewed = items.filter(({ rule }) => rule.status === "legal_reviewed");
  const sourceChecked = items.filter(({ rule }) => rule.status === "source_checked");
  const seed = items.filter(({ rule }) => rule.status === "seed");
  const internalRules = items.filter(({ rule }) => rule.law === "internal");
  const legalRules = items.filter(({ rule }) => rule.law !== "internal");
  const missingSourceUrl = legalRules.filter(({ rule }) => !rule.sourceUrl);
  const missingRequiredDocument = items.filter(
    ({ rule }) => rule.law !== "internal" && !rule.requiredDocument,
  );
  const incompleteLegal = legalReviewed.filter(
    ({ rule }) => !rule.reviewedAt || !rule.reviewedBy || !rule.edition || !rule.sourceUrl,
  );
  const result = {
    event: "core.legal_review.check",
    ok: missingRequiredDocument.length === 0 && incompleteLegal.length === 0,
    uniqueRules: items.length,
    internalRules: internalRules.length,
    legalRules: legalRules.length,
    seed: seed.length,
    sourceChecked: sourceChecked.length,
    legalReviewed: legalReviewed.length,
    pendingLegalReview: legalRules.length - legalReviewed.length,
    missingSourceUrl: missingSourceUrl.length,
    missingRequiredDocument: missingRequiredDocument.length,
    incompleteLegal: incompleteLegal.length,
  };
  return result;
};

const argValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const checkUrl = async (url: string): Promise<{ url: string; ok: boolean; status?: number; error?: string }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    let response = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    if (response.status === 403 || response.status === 405 || response.status === 501) {
      response = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
    }
    return { url, ok: response.ok, status: response.status };
  } catch (error) {
    return {
      url,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
};

const items = rows();
const result = check(items);

if (process.argv.includes("--urls")) {
  const urls = [
    ...new Set(
      items
        .filter(({ rule }) => rule.law !== "internal")
        .map(({ rule }) => rule.sourceUrl)
        .filter((url): url is string => Boolean(url)),
    ),
  ];
  const results: Array<{ url: string; ok: boolean; status?: number; error?: string }> = [];
  for (let index = 0; index < urls.length; index += 5) {
    results.push(...(await Promise.all(urls.slice(index, index + 5).map(checkUrl))));
  }
  const failed = results.filter((entry) => !entry.ok);
  console.log(
    JSON.stringify(
      {
        event: "core.legal_review.urls",
        checked: results.length,
        ok: results.length - failed.length,
        failed: failed.length,
        failures: failed,
      },
      null,
      2,
    ),
  );
  if (failed.length > 0) process.exitCode = 1;
} else if (process.argv.includes("--check")) {
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} else {
  const out = resolve(argValue("--out") ?? "../docs/core/legal-review.csv");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, toCsv(items), "utf8");
  console.log(JSON.stringify({ ...result, out }, null, 2));
}
