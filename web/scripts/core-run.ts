import { readFile } from "node:fs/promises";

import { runFlow } from "../src/lib/core/flow/engine.ts";
import type { FlowInput } from "../src/lib/core/flow/types.ts";
import { coreModules, findCoreModule } from "../src/lib/core/modules/index.ts";

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
  console.log(
    JSON.stringify(
      {
        modules: Object.entries(coreModules).map(([key, module]) => ({
          key,
          name: module.name,
          version: module.version,
          rules: new Set(module.rules.map((rule) => rule.id)).size,
        })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const moduleKey = arg("--module")?.trim();
if (!moduleKey) {
  console.error("Укажите --module <key> или --list");
  process.exit(1);
}

const coreModule = findCoreModule(moduleKey);
if (!coreModule) {
  console.error(`Неизвестный модуль: ${moduleKey}`);
  process.exit(1);
}

try {
  const inputPath = arg("--input");
  const raw = inputPath ? await readFile(inputPath, "utf8") : await readStdin();
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || !("data" in parsed)) {
    throw new Error("Вход должен быть объектом с полем data");
  }
  const result = runFlow(coreModule, parsed as FlowInput);
  console.log(JSON.stringify({ event: "core.run", moduleKey, result }, null, 2));
} catch (error) {
  console.error(
    JSON.stringify(
      {
        event: "core.run.error",
        moduleKey,
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
