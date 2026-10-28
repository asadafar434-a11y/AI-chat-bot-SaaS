/**
 * Проверка покрытия калькуляторов: у каждой из 25 сфер есть хотя бы один калькулятор,
 * у каждого калькулятора — непустые ruleIds/sourceUrls/inputSchema, пары
 * sphereKey/subSphereKey не повторяются, и у каждой сферы есть файл тестов.
 *
 * Запуск (web/):
 *   npm run core:calculators:check
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { calculators, calculatorsBySphere } from "../src/lib/core/calculators/registry.ts";
import { coreModules } from "../src/lib/core/modules/index.ts";

type Issue = { code: string; message: string };

function main(): void {
  const issues: Issue[] = [];
  const calculatorsDir = fileURLToPath(new URL("../src/lib/core/calculators/", import.meta.url));

  for (const sphereKey of Object.keys(coreModules)) {
    const list = calculatorsBySphere[sphereKey] ?? [];
    if (list.length === 0) issues.push({ code: "sphere.no_calculator", message: `Сфера ${sphereKey} без калькулятора` });
  }

  for (const sphereKey of Object.keys(calculatorsBySphere)) {
    if (!Object.prototype.hasOwnProperty.call(coreModules, sphereKey)) {
      issues.push({ code: "sphere.unknown", message: `Калькулятор ссылается на неизвестную сферу ${sphereKey}` });
    }
  }

  const seen = new Map<string, number>();
  for (const descriptor of calculators) {
    const key = `${descriptor.sphereKey}/${descriptor.subSphereKey}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, count] of seen) {
    if (count > 1) issues.push({ code: "calculator.duplicate", message: `Повтор пары сфера/под-сфера: ${key} (${count})` });
  }

  for (const descriptor of calculators) {
    const label = `${descriptor.sphereKey}/${descriptor.subSphereKey}`;
    if (descriptor.ruleIds.length === 0) issues.push({ code: "calculator.rule_ids", message: `${label}: пустой ruleIds` });
    if (descriptor.sourceUrls.length === 0) issues.push({ code: "calculator.source_urls", message: `${label}: пустой sourceUrls` });
    if (descriptor.inputSchema.length === 0) issues.push({ code: "calculator.input_schema", message: `${label}: пустая inputSchema` });
    if (!descriptor.title.trim()) issues.push({ code: "calculator.title", message: `${label}: пустой title` });
  }

  for (const sphereKey of Object.keys(calculatorsBySphere)) {
    const testFile = `${calculatorsDir}${sphereKey}.test.ts`;
    if (!existsSync(testFile)) {
      issues.push({ code: "calculator.no_test", message: `Нет файла тестов для сферы ${sphereKey}: ${sphereKey}.test.ts` });
    }
  }

  console.log(
    JSON.stringify(
      {
        event: "core.calculators.check",
        ok: issues.length === 0,
        spheres: Object.keys(coreModules).length,
        calculators: calculators.length,
        issues,
      },
      null,
      2,
    ),
  );

  if (issues.length > 0) process.exitCode = 1;
}

main();
