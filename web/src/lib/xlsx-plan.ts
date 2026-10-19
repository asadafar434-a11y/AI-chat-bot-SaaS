// Что вписать в Excel-бланк заказчика (lib/xlsx-form.ts): реквизиты участника напротив их названий и сведения о товарах (страна, производитель, реестровый номер)
// в строки таблицы. Берётся только то, что участник сам сказал: реквизиты из «Реквизитов», страна, производитель и номер — из карточки товара (в ТЗ заказчик
// пишет, чего хочет он, это не значение участника). Цены, даты, номера писем, «да/нет» и всё незнакомое остаётся как есть — участник впишет в самом файле.
// Модуль без зависимостей от браузера и сервера.
import { profileValueOf } from "@/lib/blank-fill";
import type { Profile } from "@/lib/profile";
import { lowerWords, nameTerms, stemWord } from "@/lib/registry-text";
import { refOf, type CellEdit, type FormBook, type FormCell, type FormSheet } from "@/lib/xlsx-form";

export type ExcelGood = {
  name: string;
  /** Страна происхождения, как назвал участник. */
  country?: string;
  /** Производитель, как назвал участник. */
  manufacturer?: string;
  /** Реестр и номер записи, готовые к вписыванию («РПП (ПП 719), № 123456»); пометка «ПРОВЕРЬТЕ» — часть строки. */
  registry?: string;
};

export type FillInput = { profile: Profile; subject: string; goods: ExcelGood[] };

export type FillItem = { sheet: string; ref: string; label: string; value: string; kind: "requisite" | "position" };
export type FillPlan = {
  edits: CellEdit[];
  filled: FillItem[];
  /** Что бланк просит, а у приложения этого нет: участнику вписать самому. */
  left: string[];
};

// «…», «___», «-» в пустой графе — подсказка заказчика «впишите сюда», а не значение.
const isBlank = (text: string) => /^[\s….._\-–—]*$/.test(text);
const isNumber = (text: string) => /^\d{1,3}$/.test(text.trim());
const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const norm = (text: string) => lowerWords(text).join(" ");

// Не про участника: реквизиты заказчика, организатора, покупателя в бланк не вписываются.
const NOT_PARTICIPANT = /заказчик|организатор|покупател|продавц|получател|плательщик/i;
// Одно слово «Наименование» — заголовок графы таблицы, а не строка «Наименование участника».
const PARTICIPANT_WORD = /участник|организаци|компани|заявител|поставщик|исполнител|подрядчик|претендент|контрагент|фирменн|юридическ|предприниматель/i;

function valueFor(label: string, input: FillInput): { value: string; known: boolean } | null {
  const text = flat(label);
  // «(Должность руководителя …) ______ И.О. Фамилия» — строка подписи, а не реквизит.
  if (text.length < 4 || text.length > 400 || isNumber(text) || NOT_PARTICIPANT.test(text) || /^\(|_{3,}|м\.\s?п\./i.test(text)) return null;
  if (/^предмет\s+(договора|закупки)\s*:?\s*$|^наименование\s+закупки\s*:?\s*$|^объект\s+закупки\s*:?\s*$/i.test(text)) {
    return { value: input.subject.trim(), known: input.subject.trim() !== "" };
  }
  const lowered = text.toLowerCase();
  // «Наименование» без слова об участнике — графа таблицы; остальные реквизиты (ИНН, КПП, телефон) узнаются и без него.
  const bare = /наименовани|фамилия, имя, отчество/.test(lowered) && !PARTICIPANT_WORD.test(lowered);
  if (bare && !/\b(инн|кпп|огрн)\b/.test(lowered)) return null;
  const value = profileValueOf(text, input.profile);
  if (value) return { value, known: true };
  // Строка про участника есть, а в «Реквизитах» поля нет: узнаём название строки, чтобы сказать «впишите сами».
  const asked = profileValueOf(text, FULL_PROFILE);
  return asked ? { value: "", known: false } : null;
}

// Пробный профиль, в котором заполнено всё: по нему видно, какие строки бланка — про реквизиты.
const FULL_PROFILE = Object.fromEntries(
  ["fullName", "shortName", "inn", "kpp", "ogrn", "okved", "smeCategory", "taxSystem", "vatNote", "legalAddress", "postalAddress", "account", "bankName", "bik", "corrAccount", "head", "signer", "contactPerson", "phone", "email"].map((k) => [k, "x"]),
) as Profile;

function rowsOf(sheet: FormSheet): Map<number, FormCell[]> {
  const rows = new Map<number, FormCell[]>();
  for (const cell of sheet.cells.values()) rows.set(cell.row, [...(rows.get(cell.row) ?? []), cell]);
  for (const list of rows.values()) list.sort((a, b) => a.col - b.col);
  return rows;
}

// ---------- реквизиты напротив названий ----------

function planRequisites(sheet: FormSheet, rows: Map<number, FormCell[]>, input: FillInput, plan: FillPlan, taken: Set<string>) {
  for (const [row, cells] of rows) {
    const texts = cells.filter((c) => !isBlank(c.text) && !isNumber(c.text));
    // Строка с несколькими заполненными ячейками — таблица: подписи граф к реквизитам не относятся.
    if (cells.filter((c) => !isBlank(c.text)).length > 3) continue;
    for (const label of texts) {
      const found = valueFor(label.text, input);
      if (!found) continue;
      const after = label.col + (label.span?.cols ?? 1);
      let target: FormCell | null = null;
      let blocked = false;
      for (let col = after; col <= after + 12; col++) {
        const cell = sheet.cells.get(refOf(row, col));
        if (!cell) continue;
        if (isBlank(cell.text) && !cell.formula) target = cell;
        else blocked = true;
        break;
      }
      if (blocked) continue;
      const ref = target?.ref ?? refOf(row, after);
      if (taken.has(`${sheet.name}!${ref}`)) continue;
      const title = flat(label.text).slice(0, 90);
      if (!found.known) {
        plan.left.push(`«${title}» — в «Реквизитах» этого поля нет`);
        continue;
      }
      taken.add(`${sheet.name}!${ref}`);
      plan.edits.push({ sheet: sheet.name, ref, value: found.value });
      plan.filled.push({ sheet: sheet.name, ref, label: title, value: found.value, kind: "requisite" });
    }
  }
}

// ---------- товары по строкам таблицы ----------

type Column = "country" | "manufacturer" | "registry";
const COLUMN_NAMES: Record<Column, string> = { country: "страна происхождения", manufacturer: "производитель", registry: "реестровый номер" };

function columnOf(header: string): Column | null {
  const t = header.toLowerCase().replace(/ё/g, "е");
  if (/страна\s+происхождени/.test(t)) return "country";
  if (/реестр/.test(t) && /номер|запис/.test(t)) return "registry";
  if (/производител|изготовител/.test(t) && !/инн/.test(t)) return "manufacturer";
  return null;
}

function score(rowTexts: string[], good: ExcelGood): number {
  const name = norm(good.name);
  if (name.length < 4) return 0;
  let best = 0;
  for (const text of rowTexts) {
    const t = norm(text);
    if (!t) continue;
    if (t === name) return 3;
    if (t.includes(name) || (t.length >= 8 && name.includes(t))) best = Math.max(best, 2);
  }
  if (best === 0) {
    const terms = nameTerms(good.name).slice(0, 2);
    const stems = new Set(rowTexts.flatMap((t) => lowerWords(t).map(stemWord)));
    if (terms.length > 0 && terms.every((term) => stems.has(term))) best = 1;
  }
  return best;
}

function planGoods(sheet: FormSheet, rows: Map<number, FormCell[]>, input: FillInput, plan: FillPlan, taken: Set<string>, used: Set<number>) {
  const numbers = [...rows.keys()].sort((a, b) => a - b);
  for (const headerRow of numbers) {
    const header = rows.get(headerRow)!;
    const columns = new Map<Column, number>();
    for (const cell of header) {
      const kind = columnOf(cell.text);
      if (kind && !columns.has(kind)) columns.set(kind, cell.col);
    }
    if (columns.size === 0 || header.filter((c) => !isBlank(c.text)).length < 3) continue;

    let dead = 0;
    for (let row = headerRow + 1; row <= headerRow + 300 && dead < 5; row++) {
      const cells = rows.get(row) ?? [];
      const filled = cells.filter((c) => !isBlank(c.text));
      // Строка номеров граф «1 2 3 4 …» и пустая строка — пропуск.
      if (filled.length === 0 || filled.every((c) => isNumber(c.text))) {
        dead += filled.length === 0 ? 1 : 0;
        continue;
      }
      const targets = [...columns].filter(([, col]) => {
        const cell = sheet.cells.get(refOf(row, col));
        return !cell?.formula && (!cell || isBlank(cell.text));
      });
      if (targets.length === 0) {
        dead++;
        continue;
      }
      dead = 0;
      const targetCols = new Set(targets.map(([, col]) => col));
      const texts = cells.filter((c) => !targetCols.has(c.col) && !isNumber(c.text) && !isBlank(c.text)).map((c) => c.text);
      let pick = -1;
      let top = 0;
      input.goods.forEach((good, i) => {
        if (used.has(i)) return;
        const s = score(texts, good);
        if (s > top) {
          top = s;
          pick = i;
        }
      });
      if (pick < 0) {
        // Строка с номером позиции — товар, которого нет в предложении; итоговые и пояснительные строки без номера не считаем.
        const label = flat(texts.find((t) => /\p{L}{3,}/u.test(t)) ?? `строка ${row}`).slice(0, 80);
        if (filled[0] && isNumber(filled[0].text)) plan.left.push(`Строка ${row} «${label}» — не нашёл такого товара в вашем предложении`);
        continue;
      }
      used.add(pick);
      const good = input.goods[pick];
      for (const [kind, col] of targets) {
        const value = (kind === "country" ? good.country : kind === "manufacturer" ? good.manufacturer : good.registry)?.trim();
        const ref = refOf(row, col);
        if (!value) {
          plan.left.push(`«${flat(good.name).slice(0, 70)}»: ${COLUMN_NAMES[kind]} — не указано`);
          continue;
        }
        if (taken.has(`${sheet.name}!${ref}`)) continue;
        taken.add(`${sheet.name}!${ref}`);
        plan.edits.push({ sheet: sheet.name, ref, value });
        plan.filled.push({ sheet: sheet.name, ref, label: `${flat(good.name).slice(0, 70)} — ${COLUMN_NAMES[kind]}`, value, kind: "position" });
      }
    }
  }
}

export function planFill(book: FormBook, input: FillInput): FillPlan {
  const plan: FillPlan = { edits: [], filled: [], left: [] };
  const taken = new Set<string>();
  const used = new Set<number>();
  for (const sheet of book.sheets) {
    if (sheet.hidden) continue;
    const rows = rowsOf(sheet);
    planRequisites(sheet, rows, input, plan, taken);
    planGoods(sheet, rows, input, plan, taken, used);
  }
  // Одно и то же «не указано» по десяти позициям — одной строкой.
  const seen = new Set<string>();
  plan.left = plan.left.filter((line) => (seen.has(line) ? false : (seen.add(line), true)));
  return plan;
}
