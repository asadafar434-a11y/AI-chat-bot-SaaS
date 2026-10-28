import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type Item = {
  registrationNumber: string;
  zhvnlp: boolean;
  maxPrice?: number;
  vatRate?: number;
};

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const required = (name: string): string => {
  const value = arg(name)?.trim();
  if (!value) throw new Error(`не задан ${name}`);
  return value;
};

const parseBoolean = (value: string, line: number): boolean => {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "да"].includes(normalized)) return true;
  if (["false", "0", "no", "нет"].includes(normalized)) return false;
  throw new Error(`строка ${line}: zhvnlp должен быть true/false`);
};

const parseNumber = (value: string, field: string, line: number): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const number = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(number) || number < 0) throw new Error(`строка ${line}: некорректный ${field}`);
  return number;
};

const parseCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (quoted) throw new Error("незакрытая кавычка в CSV");
  cells.push(current);
  return cells.map((cell) => cell.trim());
};

const normalized = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, "");

const parseCsv = (content: string): Item[] => {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new Error("CSV пуст");
  const header = parseCsvLine(lines[0]).map((cell) => cell.trim());
  const index = {
    registrationNumber: header.indexOf("registrationNumber"),
    zhvnlp: header.indexOf("zhvnlp"),
    maxPrice: header.indexOf("maxPrice"),
    vatRate: header.indexOf("vatRate"),
  };
  if (index.registrationNumber < 0 || index.zhvnlp < 0) {
    throw new Error("CSV: нужны колонки registrationNumber и zhvnlp");
  }
  const seen = new Set<string>();
  return lines.slice(1).map((line, offset) => {
    const lineNumber = offset + 2;
    const cells = parseCsvLine(line);
    const registrationNumber = cells[index.registrationNumber]?.trim() ?? "";
    if (!registrationNumber) throw new Error(`строка ${lineNumber}: пустой registrationNumber`);
    const key = normalized(registrationNumber);
    if (seen.has(key)) throw new Error(`строка ${lineNumber}: дубль ${registrationNumber}`);
    seen.add(key);
    const maxPrice = index.maxPrice >= 0 ? parseNumber(cells[index.maxPrice] ?? "", "maxPrice", lineNumber) : undefined;
    const vatRate = index.vatRate >= 0 ? parseNumber(cells[index.vatRate] ?? "", "vatRate", lineNumber) : undefined;
    return {
      registrationNumber,
      zhvnlp: parseBoolean(cells[index.zhvnlp] ?? "", lineNumber),
      ...(maxPrice === undefined ? {} : { maxPrice }),
      ...(vatRate === undefined ? {} : { vatRate }),
    };
  });
};

const effectiveFrom = required("--effective-from");
if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || Number.isNaN(Date.parse(effectiveFrom))) {
  throw new Error("--effective-from должен быть YYYY-MM-DD");
}
const source = required("--source");
const edition = required("--edition");
const csvPath = resolve(required("--csv"));
const items = parseCsv(await readFile(csvPath, "utf8"));
const payload = {
  source,
  edition,
  effectiveFrom,
  complete: process.argv.includes("--complete"),
  items,
};
const out = resolve(arg("--out") ?? "../docs/core/medicine-reference.json");
await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      event: "core.medicine-reference.imported",
      out,
      source,
      edition,
      effectiveFrom,
      complete: payload.complete,
      items: items.length,
    },
    null,
    2,
  ),
);
