/**
 * Инвентаризация правил Core v1 для юридического ревью.
 *
 * Запуск (web/):
 *   npm run core:rules:inventory
 *   npm run core:rules:inventory -- --check
 *
 * Пишет:
 *   docs/core/rules-inventory.json — машиночитаемый реестр;
 *   docs/core/rules-inventory.md   — человекочитаемый реестр и пробелы.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { validateFlow } from "../src/lib/core/flow/validate.ts";
import { coreModules } from "../src/lib/core/modules/index.ts";

type RuleInstance = {
  moduleKey: string;
  moduleName: string;
  moduleVersion: string;
  id: string;
  law: string;
  article: string;
  condition: string;
  requiredDocument: string | null;
  validationLogic: string;
  riskLevel: string;
  effectiveFrom: string;
  source: string;
  reviewedAt: string | null;
  edition: string | null;
  sourceUrl: string | null;
  status: string;
};

type UniqueRule = RuleInstance & {
  modules: string[];
  shared: boolean;
  instanceCount: number;
};

const DOCS_DIR = fileURLToPath(new URL("../../docs/core/", import.meta.url));
const CHECK = process.argv.includes("--check");
const GENERATED_AT = process.env.CORE_INVENTORY_DATE ?? new Date().toISOString().slice(0, 10);

const byKey = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const countBy = <T extends string>(values: T[]): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
};

const escapeCell = (value: string): string => value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

const formatCell = (value: string | null): string => (value && value.trim().length > 0 ? escapeCell(value) : "—");

const ruleSignature = (row: RuleInstance): string =>
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

const instances: RuleInstance[] = [];
const validationIssues: Array<{ moduleKey: string; code: string; nodeId?: string; message: string }> = [];

for (const [moduleKey, module] of Object.entries(coreModules)) {
  for (const issue of validateFlow(module)) {
    validationIssues.push({ moduleKey, ...issue });
  }
  for (const rule of module.rules) {
    instances.push({
      moduleKey,
      moduleName: module.name,
      moduleVersion: module.version,
      id: rule.id,
      law: rule.law,
      article: rule.article,
      condition: rule.condition,
      requiredDocument: rule.requiredDocument,
      validationLogic: rule.validationLogic,
      riskLevel: rule.riskLevel,
      effectiveFrom: rule.effectiveFrom,
      source: rule.source,
      reviewedAt: rule.reviewedAt ?? null,
      edition: rule.edition ?? null,
      sourceUrl: rule.sourceUrl ?? null,
      status: rule.status,
    });
  }
}

instances.sort((left, right) => byKey(left.moduleKey, right.moduleKey) || byKey(left.id, right.id));

const groups = new Map<string, RuleInstance[]>();
for (const row of instances) {
  const group = groups.get(row.id) ?? [];
  group.push(row);
  groups.set(row.id, group);
}

const sameModuleDuplicateIds: string[] = [];
const conflictingSharedIds: string[] = [];
const sharedRuleIds: string[] = [];
const uniqueRules: UniqueRule[] = [];

for (const [id, group] of groups) {
  const modules = [...new Set(group.map((row) => row.moduleKey))].sort(byKey);
  const moduleCounts = countBy(group.map((row) => row.moduleKey));
  for (const [moduleKey, count] of Object.entries(moduleCounts)) {
    if (count > 1) sameModuleDuplicateIds.push(`${id}@${moduleKey}`);
  }

  const signatures = new Set(group.map(ruleSignature));
  if (modules.length > 1) {
    if (signatures.size > 1) conflictingSharedIds.push(id);
    else sharedRuleIds.push(id);
  }

  const first = group[0];
  if (!first) continue;
  uniqueRules.push({
    ...first,
    modules,
    shared: modules.length > 1,
    instanceCount: group.length,
  });
}

uniqueRules.sort((left, right) => byKey(left.moduleKey, right.moduleKey) || byKey(left.id, right.id));

const missingRequiredDocument = uniqueRules.filter((row) => row.law !== "internal" && !row.requiredDocument);
const invalidRules = uniqueRules.filter(
  (row) =>
    !row.id.trim() ||
    !row.law.trim() ||
    !row.article.trim() ||
    !row.condition.trim() ||
    !row.source.trim() ||
    !row.effectiveFrom.trim(),
);
const legalReviewedMissingMetadata = uniqueRules.filter(
  (row) => row.status === "legal_reviewed" && (!row.reviewedAt || !row.edition),
);
const seedRules = uniqueRules.filter((row) => row.status === "seed");
const sourceCheckedRules = uniqueRules.filter((row) => row.status === "source_checked");
const legalReviewedRules = uniqueRules.filter((row) => row.status === "legal_reviewed");
const internalRules = uniqueRules.filter((row) => row.law === "internal");
const withoutSourceUrl = uniqueRules.filter((row) => !row.sourceUrl);
const legalWithoutSourceUrl = uniqueRules.filter((row) => row.law !== "internal" && !row.sourceUrl);
const internalWithoutSourceUrl = uniqueRules.filter((row) => row.law === "internal" && !row.sourceUrl);
const sharedRules = uniqueRules.filter((row) => row.shared);
const sharedInstanceCount = instances.filter((row) => sharedRuleIds.includes(row.id)).length;

const moduleSummaries = Object.entries(coreModules)
  .map(([moduleKey, module]) => {
    const moduleInstances = instances.filter((row) => row.moduleKey === moduleKey);
    const ownRules = uniqueRules.filter((row) => !row.shared && row.moduleKey === moduleKey);
    const ownRiskCounts = countBy(ownRules.map((row) => row.riskLevel));
    const ownStatusCounts = countBy(ownRules.map((row) => row.status));
    return {
      key: moduleKey,
      name: module.name,
      version: module.version,
      ownRules: ownRules.length,
      flowInstances: moduleInstances.length,
      sharedInstances: moduleInstances.length - ownRules.length,
      seed: ownStatusCounts.seed ?? 0,
      sourceChecked: ownStatusCounts.source_checked ?? 0,
      legalReviewed: ownStatusCounts.legal_reviewed ?? 0,
      blocker: ownRiskCounts.blocker ?? 0,
      high: ownRiskCounts.high ?? 0,
      medium: ownRiskCounts.medium ?? 0,
      low: ownRiskCounts.low ?? 0,
      withSourceUrl: ownRules.filter((row) => row.sourceUrl).length,
    };
  })
  .sort((left, right) => byKey(left.key, right.key));

const gaps = {
  sameModuleDuplicateIds,
  conflictingSharedIds,
  sharedRuleIds: [...sharedRuleIds].sort(byKey),
  missingRequiredDocument: missingRequiredDocument.map((row) => row.id),
  invalidRules: invalidRules.map((row) => row.id),
  legalReviewedMissingMetadata: legalReviewedMissingMetadata.map((row) => row.id),
  modulesWithoutRules: moduleSummaries.filter((module) => module.flowInstances === 0).map((module) => module.key),
  seed: seedRules.length,
  sourceChecked: sourceCheckedRules.length,
  legalReviewed: legalReviewedRules.length,
  internal: internalRules.length,
  withoutSourceUrl: withoutSourceUrl.length,
  legalWithoutSourceUrl: legalWithoutSourceUrl.map((row) => row.id),
  internalWithoutSourceUrl: internalWithoutSourceUrl.length,
  validationIssues: validationIssues.length,
};

const payload = {
  generatedAt: GENERATED_AT,
  source: "web/src/lib/core/modules/index.ts",
  moduleCount: moduleSummaries.length,
  uniqueRuleCount: uniqueRules.length,
  instanceCount: instances.length,
  sharedRuleCount: sharedRules.length,
  sharedInstanceCount,
  ownRuleCount: uniqueRules.length - sharedRules.length,
  statusCounts: countBy(uniqueRules.map((row) => row.status)),
  instanceStatusCounts: countBy(instances.map((row) => row.status)),
  riskCounts: countBy(uniqueRules.map((row) => row.riskLevel)),
  instanceRiskCounts: countBy(instances.map((row) => row.riskLevel)),
  gaps,
  modules: moduleSummaries,
  sharedRules,
  rules: uniqueRules,
  instances: instances.map((row) => ({ moduleKey: row.moduleKey, id: row.id })),
};

const checkFailed =
  gaps.sameModuleDuplicateIds.length > 0 ||
  gaps.conflictingSharedIds.length > 0 ||
  gaps.invalidRules.length > 0 ||
  gaps.legalReviewedMissingMetadata.length > 0 ||
  gaps.modulesWithoutRules.length > 0 ||
  gaps.validationIssues > 0 ||
  gaps.legalWithoutSourceUrl.length > 0;

const summaryLines = [
  "# Core v1 — реестр правил для юридического ревью",
  "",
  `Сгенерировано: ${GENERATED_AT}`,
  `Источник: \`${payload.source}\``,
  "",
  "## 1. Сводка",
  "",
  `- Модулей: **${payload.moduleCount}**`,
  `- Уникальных правил (по ID): **${payload.uniqueRuleCount}**`,
  `- Вхождений правил в flow: **${payload.instanceCount}**`,
  `- Общих правил участника: **${payload.sharedRuleCount}** (${payload.sharedInstanceCount} вхождений)`,
  `- Собственных правил модулей: **${payload.ownRuleCount}**`,
  `- seed (не проверялись): **${gaps.seed}**`,
  `- source_checked (источник и статья сверены): **${gaps.sourceChecked}**`,
  `- legal_reviewed: **${gaps.legalReviewed}**`,
  `- внутренних правил (не правовые нормы): **${gaps.internal}**`,
  `- без sourceUrl: **${gaps.withoutSourceUrl}** (внутренних: ${gaps.internalWithoutSourceUrl}, правовых: ${gaps.legalWithoutSourceUrl.length})`,
  `- дубликатов в одном модуле: **${gaps.sameModuleDuplicateIds.length}**`,
  `- конфликтов между общими правилами: **${gaps.conflictingSharedIds.length}**`,
  `- правовых правил без requiredDocument: **${gaps.missingRequiredDocument.length}**`,
  `- legal_reviewed без reviewedAt/edition: **${gaps.legalReviewedMissingMetadata.length}**`,
  `- ошибок validateFlow: **${gaps.validationIssues}**`,
  "",
  "## 2. Сводка по модулям",
  "",
  "Собственные правила не включают 7 общих правил участника; они проверяются один раз и входят в каждый flow.",
  "",
  "| Модуль | Ключ | Версия | Собственных | В flow | seed | legal_reviewed | blocker | high | medium | low | sourceUrl |",
  "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...moduleSummaries.map(
    (module) =>
      `| ${escapeCell(module.name)} | \`${module.key}\` | ${escapeCell(module.version)} | ${module.ownRules} | ${module.flowInstances} | ${module.seed} | ${module.legalReviewed} | ${module.blocker} | ${module.high} | ${module.medium} | ${module.low} | ${module.withSourceUrl} |`,
  ),
  "",
  "## 3. Общие правила участника",
  "",
  "| ID | Риск | Статус | Норма | Условие | Документ | Модулей |",
  "|---|---|---|---|---|---|---:|",
  ...sharedRules.map(
    (row) =>
      `| \`${row.id}\` | ${row.riskLevel} | ${row.status} | ${escapeCell(row.law)} ${escapeCell(row.article)} | ${escapeCell(row.condition)} | ${formatCell(row.requiredDocument)} | ${row.modules.length} |`,
  ),
  "",
  "## 4. Пробелы и приоритеты",
  "",
  "1. Все правила сейчас в статусе `seed`: юридическое подтверждение источников, редакций и применимости ещё не проводилось.",
  "2. `sourceUrl` заполнен из `source` для правовых правил; у внутренних правил URL нет по определению.",
  "3. Для каждого правила нужно проверить `law`, `article`, `condition`, `requiredDocument`, `riskLevel`, `effectiveFrom` и `source`.",
  "4. После проверки юрист проставляет `status: \"legal_reviewed\"`, `reviewedAt`, `edition` и уточняет `sourceUrl`.",
  "5. Внутренние правила (`law: \"internal\"`) — продуктовая политика, а не норма права; их можно проверять отдельно.",
  "",
];

if (gaps.sameModuleDuplicateIds.length > 0) {
  summaryLines.push(
    `- Дубликаты в одном модуле: ${gaps.sameModuleDuplicateIds.map((id) => `\`${id}\``).join(", ")}`,
  );
}
if (gaps.conflictingSharedIds.length > 0) {
  summaryLines.push(
    `- Конфликтующие общие правила: ${gaps.conflictingSharedIds.map((id) => `\`${id}\``).join(", ")}`,
  );
}
if (gaps.missingRequiredDocument.length > 0) {
  summaryLines.push(
    `- Без requiredDocument: ${gaps.missingRequiredDocument.map((id) => `\`${id}\``).join(", ")}`,
  );
}
if (gaps.legalWithoutSourceUrl.length > 0) {
  summaryLines.push(
    `- Правовые правила без sourceUrl: ${gaps.legalWithoutSourceUrl.map((id) => `\`${id}\``).join(", ")}`,
  );
}
if (gaps.legalReviewedMissingMetadata.length > 0) {
  summaryLines.push(
    `- legal_reviewed без метаданных: ${gaps.legalReviewedMissingMetadata.map((id) => `\`${id}\``).join(", ")}`,
  );
}
if (validationIssues.length > 0) {
  summaryLines.push(
    ...validationIssues.map(
      (issue) =>
        `- ${issue.moduleKey}:${issue.code}${issue.nodeId ? ` [${issue.nodeId}]` : ""} — ${issue.message}`,
    ),
  );
}

summaryLines.push("", "## 5. Собственные правила по модулям", "");

// Скрипт запускается из консоли, не страницей Next.js: правило про переменную module к нему не относится.
// eslint-disable-next-line @next/next/no-assign-module-variable
for (const module of moduleSummaries) {
  const ownRows = uniqueRules.filter((row) => !row.shared && row.moduleKey === module.key);
  summaryLines.push(`### ${module.name} (\`${module.key}\`)`, "");
  if (ownRows.length === 0) {
    summaryLines.push("Собственных правил нет.", "");
    continue;
  }
  summaryLines.push(
    "| ID | Риск | Статус | Норма | Условие | Документ | Действует с | Источник |",
    "|---|---|---|---|---|---|---|---|",
  );
  for (const row of ownRows) {
    summaryLines.push(
      `| \`${row.id}\` | ${row.riskLevel} | ${row.status} | ${escapeCell(row.law)} ${escapeCell(row.article)} | ${escapeCell(row.condition)} | ${formatCell(row.requiredDocument)} | ${row.effectiveFrom} | ${formatCell(row.sourceUrl ?? row.source)} |`,
    );
  }
  summaryLines.push("");
}

summaryLines.push(
  "## 6. Как обновлять",
  "",
  "1. Внести правки в правила в `web/src/lib/core/modules/*`.",
  "2. Запустить `npm run core:rules:inventory` из `web/`.",
  "3. Проверить `docs/core/rules-inventory.json` и `.md`.",
  "4. Для CI-проверки использовать `npm run core:rules:inventory -- --check`.",
  "",
);

const markdown = `${summaryLines.join("\n").replace(/\n+$/, "")}\n`;

await mkdir(DOCS_DIR, { recursive: true });
await writeFile(`${DOCS_DIR}rules-inventory.json`, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
await writeFile(`${DOCS_DIR}rules-inventory.md`, markdown, "utf8");

console.log(
  JSON.stringify(
    {
      event: "core.rules.inventory",
      modules: payload.moduleCount,
      uniqueRules: payload.uniqueRuleCount,
      instances: payload.instanceCount,
      sharedRules: payload.sharedRuleCount,
      seed: gaps.seed,
      sourceChecked: gaps.sourceChecked,
      legalReviewed: gaps.legalReviewed,
      sameModuleDuplicates: gaps.sameModuleDuplicateIds.length,
      conflictingShared: gaps.conflictingSharedIds.length,
      missingRequiredDocument: gaps.missingRequiredDocument.length,
      legalWithoutSourceUrl: gaps.legalWithoutSourceUrl.length,
      validationIssues: gaps.validationIssues,
      check: CHECK,
      ok: !checkFailed,
    },
    null,
    2,
  ),
);

if (CHECK && checkFailed) {
  process.exitCode = 1;
}
