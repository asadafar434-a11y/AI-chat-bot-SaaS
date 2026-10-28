import { readFile } from "node:fs/promises";
import { calculators, findCalculator, listCalculators } from "../src/lib/core/calculators/registry.ts";
import type { CalculatorInput } from "../src/lib/core/calculators/types.ts";

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

if (process.argv.includes("--list")) {
  console.log(JSON.stringify({ calculators: listCalculators(), total: calculators.length }, null, 2));
  process.exit(0);
}

const sphereKey = arg("--sphere")?.trim();
const subSphereKey = arg("--subsphere")?.trim();
if (!sphereKey || !subSphereKey) {
  console.error("Укажите --sphere <key> --subsphere <key> или --list");
  process.exit(1);
}

const descriptor = findCalculator(sphereKey, subSphereKey);
if (!descriptor) {
  console.error(`Калькулятор не найден: ${sphereKey}/${subSphereKey}. Список — npm run core:calc -- --list`);
  process.exit(1);
}

try {
  const inputPath = arg("--input");
  const raw = inputPath ? await readFile(inputPath, "utf8") : await readStdin();
  const parsed = raw.trim().length > 0 ? (JSON.parse(raw) as unknown) : {};
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Вход должен быть объектом с полями калькулятора (см. inputSchema)");
  }
  const result = descriptor.calculate(parsed as CalculatorInput);
  console.log(
    JSON.stringify(
      { event: "core.calc", sphereKey, subSphereKey, title: descriptor.title, description: descriptor.description, result },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        event: "core.calc.error",
        sphereKey,
        subSphereKey,
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
