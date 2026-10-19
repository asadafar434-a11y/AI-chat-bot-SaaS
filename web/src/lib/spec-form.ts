// Бланки заказчика «Спецификация» и «Расчёт цены оказываемых услуг» (приложения к договору), заполненные ценами участника. Бланк берётся из документов
// закупки как есть — столбцы, номера строк, заголовки групп, позиции, количества; код вписывает цены: итоговую цену участника раскладывает пропорционально
// начальным ценам заказчика (price-split.ts), с копейками и НДС. Начальные цены — из расчёта НМЦК, если он приложен к закупке (spec-table.ts), или цены
// единиц при торге по сумме цен единиц (unit-sum.ts). Нет начальных цен или нет итоговой цены — цены остаются жёлтыми «[впишите]», ничего не придумывается.
// Модуль без зависимостей от браузера и сервера.
import { findCustomers } from "@/lib/customers-table";
import { splitPrice, toKop, vatOf, type Split } from "@/lib/price-split";
import type { Profile } from "@/lib/profile";
import { vatRateOf } from "@/lib/spec-notes";
import { baseUnitPrices, findSpecification } from "@/lib/spec-table";
import type { DetectedForm } from "@/lib/tp";
import { findUnitSum } from "@/lib/unit-sum";

const HOLE = "[впишите]";
const money = (kop: number) =>
  (kop / 100)
    .toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/ /g, " ");

export type ColumnKind = "index" | "name" | "unit" | "qty" | "max" | "unitNoVat" | "sumNoVat" | "vat" | "unitVat" | "sumVat" | "unitPrice" | "sum" | "other";

// «в т.ч. НДС__%/без НДС»: в одном столбце участник сам называет ставку — это не столбец «без НДС» и не столбец «с НДС».
export const combinedVat = (label: string) => /в\s*т\.?\s*ч\.?\s*ндс|включ\S*\s+ндс|ндс\s*_+/.test(label.toLowerCase());

// Что за столбец в бланке — по его названию.
export function columnKind(label: string): ColumnKind {
  const t = label.toLowerCase().replace(/ё/g, "е");
  if (/максимальн\S*\s+значени/.test(t)) return "max";
  if (/^№|п\/п/.test(t)) return "index";
  if (/наименован/.test(t)) return "name";
  if (/кол-?\s?во|количеств/.test(t)) return "qty";
  if (/^ндс/.test(t)) return "vat";
  const combined = combinedVat(t);
  const noVat = !combined && /без\s+ндс/.test(t);
  const withVat = !combined && /\sс\s+ндс/.test(t);
  if (/сумм|стоимост/.test(t)) return noVat ? "sumNoVat" : withVat ? "sumVat" : "sum";
  if (/цен/.test(t)) return noVat ? "unitNoVat" : withVat ? "unitVat" : "unitPrice";
  if (/ед\.?\s*изм|единиц\S*\s+измерен/.test(t)) return "unit";
  return "other";
}

type Doc = { name: string; text: string };
export type SpecFormInput = {
  documents: Doc[];
  profile: Pick<Profile, "taxSystem" | "vatNote">;
  // Начальная цена закупки и цена участника (шаг «Цена»), в рублях.
  nmck: number | null;
  tpPrice: number | null | undefined;
};

export function specificationForms({ documents, profile, nmck, tpPrice }: SpecFormInput): DetectedForm[] {
  const spec = findSpecification(documents);
  if (!spec || !spec.hasPrice || spec.columns.length === 0) return [];
  const unit = findUnitSum(documents);
  // Торг по сумме цен единиц: цены единиц — те, из которых сложена начальная сумма (173 и 200), а не расчёт НМЦК.
  const bySum = unit !== null && unit.parts.length === spec.rows.length;
  const kinds = spec.columns.map(columnKind);
  const rate = vatRateOf(profile);

  let split: Split | null = null;
  if (bySum && unit && nmck && tpPrice) {
    const target = Math.round((toKop(unit.sum) * tpPrice) / nmck);
    split = splitPrice(spec.rows.map((r, i) => ({ name: r.name, qty: r.qty, baseKop: toKop(unit.parts[i]) })), target);
  } else if (!bySum && tpPrice) {
    const base = baseUnitPrices(spec.rows, documents);
    if (base) split = splitPrice(spec.rows.map((r, i) => ({ name: r.name, qty: r.qty, baseKop: toKop(base[i]) })), toKop(tpPrice));
  }

  const holes = new Set<string>();
  const total = { sumVat: 0, sumNoVat: 0, vat: 0 };
  // Ставка НДС в тексте ячейки, если в шапке она не разнесена по столбцам: «, в т.ч. НДС 5%», «, без НДС» или жёлтое место.
  const vatSuffix = (label: string, name: string) => {
    if (!combinedVat(label)) return "";
    if (rate === null) {
      holes.add(`НДС: ${name}`);
      return " [НДС __%/без НДС]";
    }
    return rate === 0 ? ", без НДС" : `, в т.ч. НДС ${rate}%`;
  };

  const cellOf = (kind: ColumnKind, label: string, i: number, max: number | null): string => {
    const row = spec.rows[i];
    const line = split?.lines[i];
    const hole = () => {
      holes.add(`${label}: ${row.name}`);
      return HOLE;
    };
    switch (kind) {
      case "index":
        return row.no ?? String(i + 1);
      case "name":
        return row.name;
      case "unit":
        return row.unit;
      case "qty":
        return String(row.qty);
      case "max":
        return max === null ? hole() : money(toKop(max));
      case "unitVat":
        return line ? money(line.unitKop) : hole();
      case "unitPrice":
        return line ? `${money(line.unitKop)}${vatSuffix(label, row.name)}` : hole();
      case "sumVat":
        return line ? money(line.sumKop) : hole();
      case "sum":
        return line ? `${money(line.sumKop)}${vatSuffix(label, row.name)}` : hole();
      case "unitNoVat":
        return line && rate !== null ? money(vatOf(line.unitKop, rate).withoutKop) : hole();
      case "sumNoVat":
        return line && rate !== null ? money(vatOf(line.sumKop, rate).withoutKop) : hole();
      case "vat":
        return line && rate !== null ? (rate === 0 ? "без НДС" : money(vatOf(line.sumKop, rate).vatKop)) : hole();
      default:
        return "";
    }
  };

  // Строки бланка в его порядке: позиции и заголовки групп («5. Оказание услуг по организации питания»).
  const rowsFor = (max: number | null) =>
    spec.layout.map((item) => {
      if (item.kind === "group") return kinds.map((kind) => (kind === "index" ? item.no : kind === "name" ? item.name : ""));
      const line = split?.lines[item.at];
      if (line && rate !== null) {
        const v = vatOf(line.sumKop, rate);
        total.sumVat += line.sumKop;
        total.sumNoVat += v.withoutKop;
        total.vat += v.vatKop;
      } else if (line) {
        total.sumVat += line.sumKop;
      }
      return spec.columns.map((label, c) => cellOf(kinds[c], label, item.at, max));
    });

  const table: string[][] = [spec.columns];
  const customers = bySum ? findCustomers(documents) : null;
  if (customers) {
    // Договор у каждого заказчика свой, поэтому бланк повторяется для каждого — со своим максимумом цены.
    for (const customer of customers.rows) {
      table.push([`Для заказчика: «${customer.short}»`, ...spec.columns.slice(1).map(() => "")]);
      table.push(...rowsFor(customer.max));
    }
  } else {
    table.push(...rowsFor(null));
  }

  let footer: string | undefined;
  if (!bySum) {
    // Итоговая строка в таблице — если в бланке есть столбцы сумм «с НДС», «без НДС» или НДС (как у «Спецификации» школы).
    if (kinds.some((kind) => kind === "sumVat" || kind === "sumNoVat" || kind === "vat")) {
      table.push(
        kinds.map((kind) => {
          if (kind === "name") return "ИТОГО:";
          if (kind === "sumVat") return split ? money(total.sumVat) : HOLE;
          if (kind === "sumNoVat") return split && rate !== null ? money(total.sumNoVat) : HOLE;
          if (kind === "vat") return split && rate !== null ? (rate === 0 ? "без НДС" : money(total.vat)) : HOLE;
          return "";
        }),
      );
    }
    const amount = split ? `${money(total.sumVat)} руб.` : HOLE;
    if (/ндс\s*_+/i.test(spec.totalLabel)) {
      // Итог под таблицей с выбором ставки («Итого, в т.ч. НДС__%/без НДС:»): ставка подставляется из реквизитов или остаётся жёлтой.
      const stated = rate === null ? "[в т.ч. НДС __%/без НДС]" : rate === 0 ? "без НДС" : `в т.ч. НДС ${rate}%`;
      footer = `${spec.totalLabel.replace(/в\s*т\.?\s*ч\.?\s*ндс\s*_+\s*%?\s*\/\s*без\s+ндс/i, stated)}: ${amount}`;
      if (rate === null) holes.add("Итого: НДС");
    } else {
      const vatText = !split || rate === null ? HOLE : rate === 0 ? "не облагается" : `${money(total.vat)} руб`;
      footer = `Всего: ${amount}, НДС: ${vatText}.`;
      if (!split) {
        holes.add("Всего");
        holes.add("НДС");
      }
    }
    if (!split) holes.add("Итого");
    if (split && split.shortKop > 0) {
      footer += `. Сумма по позициям на ${split.shortKop} коп. ниже итоговой цены: при этих количествах набрать итог точно нельзя`;
    }
  }

  return [
    {
      title: spec.title,
      source: spec.doc,
      fields: [...holes].slice(0, 60).map((label) => ({ label, value: "" })),
      table,
      ...(footer && { footer }),
    },
  ];
}
