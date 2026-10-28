/**
 * Проверка готовности Core v1: правила, flow и настроенные файловые провайдеры.
 *
 * Запуск (web/):
 *   npm run core:check
 *   REGISTRY_PROVIDER=file REGISTRY_FILE=... \
 *   MEDICINE_REFERENCE_PROVIDER=file MEDICINE_REFERENCE_FILE=... npm run core:check
 */
import { validateFlow } from "../src/lib/core/flow/validate.ts";
import { coreModules } from "../src/lib/core/modules/index.ts";
import { readMedicineReferenceFile } from "../src/server/core/reference/file.ts";
import { readRegistryFile } from "../src/server/core/registry/file.ts";

type RuleRow = {
  moduleKey: string;
  id: string;
  law: string;
  article: string;
  condition: string;
  requiredDocument: string | null;
  validationLogic: string;
  riskLevel: string;
  effectiveFrom: string;
  source: string;
  reviewedAt?: string;
  edition?: string;
  sourceUrl?: string;
  status: string;
};

type Issue = { code: string; message: string };

const byKey = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const countBy = (values: string[]): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
};

const signature = (row: RuleRow): string =>
  JSON.stringify({
    law: row.law,
    article: row.article,
    condition: row.condition,
    requiredDocument: row.requiredDocument,
    validationLogic: row.validationLogic,
    riskLevel: row.riskLevel,
    effectiveFrom: row.effectiveFrom,
    source: row.source,
    status: row.status,
  });

async function checkFileProvider(
  providerName: string,
  fileEnv: string,
  read: (filePath: string) => Promise<unknown>,
): Promise<{ provider: string; file: string | null; loaded: boolean; error?: string }> {
  const provider = (process.env[providerName] ?? "disabled").trim() || "disabled";
  if (!["disabled", "static", "file"].includes(provider)) {
    return { provider, file: null, loaded: false, error: `неизвестный ${providerName}` };
  }
  if (provider !== "file") return { provider, file: null, loaded: false };

  const file = (process.env[fileEnv] ?? "").trim();
  if (!file) return { provider, file: null, loaded: false, error: `не задан ${fileEnv}` };

  try {
    await read(file);
    return { provider, file, loaded: true };
  } catch (error) {
    return {
      provider,
      file,
      loaded: false,
      error: error instanceof Error ? error.message : "неизвестная ошибка",
    };
  }
}

async function main(): Promise<void> {
  const issues: Issue[] = [];
  const instances: RuleRow[] = [];

  for (const [moduleKey, flowModule] of Object.entries(coreModules)) {
    for (const flowIssue of validateFlow(flowModule)) {
      issues.push({
        code: "flow.invalid",
        message: `${moduleKey}: ${flowIssue.code}${flowIssue.nodeId ? ` [${flowIssue.nodeId}]` : ""} — ${flowIssue.message}`,
      });
    }
    for (const rule of flowModule.rules) {
      instances.push({
        moduleKey,
        id: rule.id,
        law: rule.law,
        article: rule.article,
        condition: rule.condition,
        requiredDocument: rule.requiredDocument,
        validationLogic: rule.validationLogic,
        riskLevel: rule.riskLevel,
        effectiveFrom: rule.effectiveFrom,
        source: rule.source,
        reviewedAt: rule.reviewedAt,
        edition: rule.edition,
        sourceUrl: rule.sourceUrl,
        status: rule.status,
      });
    }
  }

  const groups = new Map<string, RuleRow[]>();
  for (const row of instances) {
    const group = groups.get(row.id) ?? [];
    group.push(row);
    groups.set(row.id, group);
  }

  const uniqueRules: RuleRow[] = [];
  let sharedRules = 0;
  for (const [id, group] of groups) {
    const modules = [...new Set(group.map((row) => row.moduleKey))];
    const signatures = new Set(group.map(signature));
    const moduleCounts = countBy(group.map((row) => row.moduleKey));
    for (const [moduleKey, count] of Object.entries(moduleCounts)) {
      if (count > 1) {
        issues.push({ code: "rule.duplicate", message: `Дубликат правила ${id} в модуле ${moduleKey}` });
      }
    }
    if (modules.length > 1) {
      if (signatures.size > 1) {
        issues.push({ code: "rule.conflict", message: `Конфликтующее общее правило ${id}` });
      } else {
        sharedRules += 1;
      }
    }
    const first = group[0];
    if (first) uniqueRules.push(first);
  }

  uniqueRules.sort((left, right) => byKey(left.moduleKey, right.moduleKey) || byKey(left.id, right.id));

  for (const row of uniqueRules) {
    if (
      !row.id.trim() ||
      !row.law.trim() ||
      !row.article.trim() ||
      !row.condition.trim() ||
      !row.source.trim() ||
      !row.effectiveFrom.trim()
    ) {
      issues.push({ code: "rule.invalid", message: `Неполное правило ${row.id}` });
    }
    if (row.law !== "internal" && !row.requiredDocument) {
      issues.push({ code: "rule.document", message: `У правового правила ${row.id} нет requiredDocument` });
    }
    if (row.law !== "internal" && !row.sourceUrl) {
      issues.push({ code: "rule.source_url", message: `У правового правила ${row.id} нет sourceUrl` });
    }
    if (row.status === "legal_reviewed" && (!row.reviewedAt || !row.edition)) {
      issues.push({ code: "rule.review", message: `У legal_reviewed правила ${row.id} нет reviewedAt/edition` });
    }
  }

  const registry = await checkFileProvider("REGISTRY_PROVIDER", "REGISTRY_FILE", readRegistryFile);
  const medicineReference = await checkFileProvider(
    "MEDICINE_REFERENCE_PROVIDER",
    "MEDICINE_REFERENCE_FILE",
    readMedicineReferenceFile,
  );
  if (registry.error) issues.push({ code: "registry.provider", message: registry.error });
  if (medicineReference.error) {
    issues.push({ code: "reference.provider", message: medicineReference.error });
  }

  const statusCounts = countBy(uniqueRules.map((row) => row.status));

  console.log(
    JSON.stringify(
      {
        event: "core.check",
        ok: issues.length === 0,
        modules: Object.keys(coreModules).length,
        uniqueRules: uniqueRules.length,
        instances: instances.length,
        sharedRules,
        seed: statusCounts.seed ?? 0,
        sourceChecked: statusCounts.source_checked ?? 0,
        legalReviewed: statusCounts.legal_reviewed ?? 0,
        providers: { registry, medicineReference },
        issues,
      },
      null,
      2,
    ),
  );

  if (issues.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.log(
    JSON.stringify(
      {
        event: "core.check",
        ok: false,
        error: error instanceof Error ? error.message : "неизвестная ошибка",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
