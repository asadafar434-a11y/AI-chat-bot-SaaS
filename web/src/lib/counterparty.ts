// Проверка контрагента по ИНН по открытым реестрам, без ИИ и без платы: что за организация и действует ли она (ЕГРЮЛ, Федресурс) и что у неё с отчётностью (ГИР БО ФНС).
// Модуль чистый: разбирает ответы реестров и собирает отчёт; сами запросы делает сервер (server/counterparty/). Чего реестры без капчи не дают — суды (КАД), приставы (ФССП),
// реестр недобросовестных поставщиков (ЕИС) — программа не выдумывает: даёт ссылку на ручную проверку и честно говорит «ждёт источника».
// Если у сервера есть ключ Checko API, те же сведения приходят одним ответом (ЕГРЮЛ, ГИР БО, РНП, КАД, ФССП) — см. parseChecko* ниже; форма отчёта от этого не меняется.
//
// Правило: показываем то, что написал реестр, с датой; вывода «надёжен» или «ненадёжен» нет. Отчётность в ГИР БО хранится в тысячах рублей.

export type InnKind = "legal" | "person";

export const normalizeInn = (raw: string): string => raw.replace(/\D/g, "");

const WEIGHTS_10 = [2, 4, 10, 3, 5, 9, 4, 6, 8];
const WEIGHTS_11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
const WEIGHTS_12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];

// Контрольная цифра по алгоритму ФНС: сумма цифр с весами по модулю 11, потом по модулю 10.
const control = (digits: number[], weights: number[]) => (weights.reduce((sum, w, i) => sum + w * digits[i], 0) % 11) % 10;

/** Что не так с ИНН (текст для человека) или null, если он годится: 10 цифр у организации, 12 у ИП, контрольные цифры сходятся. */
export function innProblem(raw: string): string | null {
  const inn = normalizeInn(raw);
  if (inn.length === 0) return "Впишите ИНН.";
  if (inn.length !== 10 && inn.length !== 12) return "ИНН — 10 цифр у организации или 12 у ИП, а у вас " + inn.length + ".";
  const d = [...inn].map(Number);
  const ok = inn.length === 10 ? control(d, WEIGHTS_10) === d[9] : control(d, WEIGHTS_11) === d[10] && control(d, WEIGHTS_12) === d[11];
  return ok ? null : "Контрольная цифра ИНН не сходится — проверьте, нет ли опечатки.";
}

export const innKind = (inn: string): InnKind => (inn.length === 12 ? "person" : "legal");

// ——— Поиск по названию, ФИО и ОГРН ———
// Одно поле на всё: цифры — ИНН (10/12) или ОГРН (13/15), буквы — название или фамилия. Что именно искать по тексту, выбирает человек (SEARCH_MODES).

/** Что искать по тексту: организацию по названию, ИП по ФИО или организации, где руководитель — этот человек. */
export type SearchMode = "org" | "ent" | "leader";
export const SEARCH_MODES: { id: SearchMode; label: string; hint: string }[] = [
  { id: "org", label: "Организация", hint: "название, например «Ростелеком»" },
  { id: "ent", label: "ИП", hint: "фамилия и имя предпринимателя" },
  { id: "leader", label: "Руководитель", hint: "фамилия и имя — найдёт организации, где он руководитель" },
];
export const isSearchMode = (value: unknown): value is SearchMode => value === "org" || value === "ent" || value === "leader";

export type Lookup = { kind: "inn" | "ogrn" | "text"; value: string };

/** Что вписал человек: только цифры (и пробелы с дефисами) — номер, иначе текст для поиска. Номер из 13 или 15 цифр — ОГРН, остальное — ИНН. */
export function lookupOf(raw: string): Lookup {
  const trimmed = raw.trim();
  if (trimmed && /^[\d\s-]+$/.test(trimmed)) {
    const digits = normalizeInn(trimmed);
    return { kind: digits.length === 13 || digits.length === 15 ? "ogrn" : "inn", value: digits };
  }
  return { kind: "text", value: trimmed.replace(/\s+/g, " ") };
}

/** Что не так с ОГРН (13 цифр у организации, 15 у ИП; контрольная цифра — остаток от деления на 11 или 13). */
export function ogrnProblem(raw: string): string | null {
  const ogrn = normalizeInn(raw);
  if (ogrn.length !== 13 && ogrn.length !== 15) return "ОГРН — 13 цифр у организации или 15 у ИП, а у вас " + ogrn.length + ".";
  const divisor = ogrn.length === 13 ? 11 : 13;
  let rest = 0;
  for (const digit of ogrn.slice(0, -1)) rest = (rest * 10 + Number(digit)) % divisor; // остаток от деления длинного числа без BigInt
  return rest % 10 === Number(ogrn.slice(-1)) ? null : "Контрольная цифра ОГРН не сходится — проверьте, нет ли опечатки.";
}

/** Текст поиска: не короче четырёх знаков (так требует поиск Checko), не длиннее ста двадцати. */
export function textQueryProblem(raw: string): string | null {
  const query = raw.trim();
  if (query.length < 4) return "Для поиска впишите не меньше четырёх букв названия или фамилии — или ИНН, или ОГРН.";
  if (query.length > 120) return "Слишком длинный запрос — сократите до названия или фамилии с именем.";
  return null;
}

/** Одна найденная организация или ИП — чтобы выбрать нужную и проверить по её ИНН. */
export type SearchHit = {
  inn: string;
  ogrn: string | null;
  name: string;
  kind: "org" | "ent";
  status: string | null;
  region: string | null;
  address: string | null;
  registered: string | null;
  terminated: string | null;
};

/** /search: записи организаций (obj=org) или ИП (obj=ent). Запись без ИНН пропускается — по ней проверить нечего. */
export function parseCheckoSearch(json: unknown, kind: "org" | "ent"): { hits: SearchHit[]; more: boolean } {
  const data = obj(obj(json).data);
  const hits: SearchHit[] = [];
  for (const r of arr(data.Записи)) {
    const inn = text(r.ИНН);
    if (!inn || !/^\d{10}(\d{2})?$/.test(inn)) continue;
    const name = kind === "ent" ? text(r.ФИО) : (text(r.НаимСокр) ?? text(r.НаимПолн));
    hits.push({
      inn,
      ogrn: text(r.ОГРН) ?? text(r.ОГРНИП),
      name: name ?? inn,
      kind,
      status: text(r.Статус),
      region: text(r.РегионКод),
      address: kind === "org" ? text(r.ЮрАдрес) : null,
      registered: isoAny(r.ДатаРег),
      terminated: isoAny(r.ДатаЛикв) ?? isoAny(r.ДатаПрекращ),
    });
  }
  const pages = num(data.СтрВсего);
  return { hits, more: pages !== null && pages > 1 };
}

// ——— Источники ———

export type SourceId = "egrul" | "fedresurs" | "bo" | "checko";
export const SOURCE_NAMES: Record<SourceId, string> = { egrul: "ЕГРЮЛ", fedresurs: "Федресурс", bo: "ГИР БО ФНС", checko: "Checko (ЕГРЮЛ, ФНС, КАД, ФССП)" };
export type SourceState = { ok: true } | { ok: false; reason: string };

const isoOfRu = (s: unknown): string | null => {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(typeof s === "string" ? s.trim() : "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
// Checko отдаёт даты то по-русски (19.12.2005), то по ISO (2021-03-23) — принимаем оба вида.
const isoAny = (s: unknown): string | null => isoOfRu(s) ?? (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s.trim()) ? s.trim().slice(0, 10) : null);
const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map((x) => obj(x)) : []);
const bool = (v: unknown): boolean => v === true;
const rublesToThousands = (v: number | null): number | null => (v === null ? null : Math.round(v / 1000));
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const stripTags = (s: string) => s.replace(/<[^>]*>/g, "");

export type Identity = {
  name: string;
  shortName: string | null;
  ogrn: string | null;
  kpp: string | null;
  /** Дата регистрации, ГГГГ-ММ-ДД. */
  registered: string | null;
  /** Дата прекращения деятельности, если ЕГРЮЛ её называет. */
  terminated: string | null;
  headRole: string | null;
  headName: string | null;
  region: string | null;
};

/** Ответ ЕГРЮЛ на поиск по ИНН: строка с этим ИНН или null. */
export function parseEgrul(json: unknown, inn: string): Identity | null {
  const rows = (json as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) return null;
  const row = rows.find((r) => text((r as Record<string, unknown>)?.i) === inn) as Record<string, unknown> | undefined;
  if (!row) return null;
  const head = text(row.g);
  const [role, name] = head && head.includes(":") ? [head.slice(0, head.indexOf(":")).trim(), head.slice(head.indexOf(":") + 1).trim()] : [null, null];
  return {
    name: text(row.n) ?? text(row.c) ?? inn,
    shortName: text(row.c),
    ogrn: text(row.o),
    kpp: text(row.p),
    registered: isoOfRu(row.r),
    terminated: isoOfRu(row.e),
    headRole: role ? role.charAt(0) + role.slice(1).toLowerCase() : null,
    headName: name,
    region: text(row.rn),
  };
}

export type FedresursInfo = { guid: string; name: string; status: string; address: string | null };

/** Ответ Федресурса на поиск по ИНН: статус организации словами реестра («Действующее», «признано несостоятельным (банкротом)…»). */
export function parseFedresurs(json: unknown, inn: string): FedresursInfo | null {
  const list = (json as { pageData?: unknown })?.pageData;
  if (!Array.isArray(list)) return null;
  const item = list.find((x) => text((x as Record<string, unknown>)?.inn) === inn) as Record<string, unknown> | undefined;
  const guid = text(item?.guid);
  const status = text(item?.status);
  if (!item || !guid || !status) return null;
  return { guid, name: text(item.name) ?? inn, status, address: text(item.egrulAddress) };
}

export type BoOrganization = { id: number; status: string | null; statusDate: string | null; address: string | null };

/** Ответ ГИР БО на поиск: организация с этим ИНН (в ответе ИНН обёрнут в тег подсветки). */
export function parseBoSearch(json: unknown, inn: string): BoOrganization | null {
  const list = (json as { content?: unknown })?.content;
  if (!Array.isArray(list)) return null;
  const item = list.find((x) => stripTags(text((x as Record<string, unknown>)?.inn) ?? "") === inn) as Record<string, unknown> | undefined;
  const id = num(item?.id);
  if (!item || id === null) return null;
  const address = [text(item.index), text(item.region), text(item.city), text(item.street), text(item.house) && `д. ${text(item.house)}`].filter(Boolean).join(", ");
  return { id, status: text(item.statusCode), statusDate: text(item.statusDate), address: address || null };
}

export type BoReport = { id: number; period: number };

/** Список бухгалтерской отчётности организации: самая свежая по году, а в году — по дате последней корректировки. */
export function latestBoReport(json: unknown): BoReport | null {
  if (!Array.isArray(json)) return null;
  const reports = json
    .map((r) => r as Record<string, unknown>)
    .map((r) => ({ id: num(r.id), period: Number(r.period), date: text(r.actualCorrectionDate) ?? text(r.actualBfoDate) ?? "" }))
    .filter((r): r is { id: number; period: number; date: string } => r.id !== null && Number.isInteger(r.period) && r.period > 1990)
    .sort((a, b) => b.period - a.period || b.date.localeCompare(a.date));
  return reports[0] ? { id: reports[0].id, period: reports[0].period } : null;
}

/** Показатели за год, тысячи рублей. null — в отчёте показателя нет. */
export type Statement = { year: number; revenue: number | null; netProfit: number | null; assets: number | null; equity: number | null };

/** Детали отчёта ГИР БО: баланс за три даты (код 1600 — валюта баланса, 1300 — капитал и резервы) и финансовый результат за два года (2110 — выручка, 2400 — чистая прибыль). */
export function parseBoDetails(json: unknown, period: number): Statement[] {
  const d = (Array.isArray(json) ? json[0] : json) as { balance?: Record<string, unknown>; financialResult?: Record<string, unknown> } | undefined;
  if (!d) return [];
  const b = d.balance ?? {};
  const f = d.financialResult ?? {};
  const at = (kind: "current" | "previous" | "beforePrevious", year: number): Statement => ({
    year,
    revenue: kind === "beforePrevious" ? null : num(f[`${kind}2110`]),
    netProfit: kind === "beforePrevious" ? null : num(f[`${kind}2400`]),
    assets: num(b[`${kind}1600`]),
    equity: num(b[`${kind}1300`]),
  });
  return [at("current", period), at("previous", period - 1), at("beforePrevious", period - 2)].filter((s) => s.assets !== null || s.revenue !== null);
}

// ——— Checko API ———
// Ответы Checko разбираются теми же правилами, что и реестры: только факты и даты. Деньги в /finances и /enforcements — рубли,
// поэтому в отчёт они попадают в тысячах, как и ГИР БО. Ключ API здесь не участвует: модуль чистый.

export type CourtRole = "plaintiff" | "defendant" | "other";
export type CourtCase = {
  number: string;
  date: string | null;
  url: string | null;
  role: CourtRole;
  claimSum: number | null;
  active: boolean;
  result: string | null;
  opponent: string | null;
};
export type CourtsInfo = { total: number; active: number; plaintiff: number; defendant: number; claimSum: number | null; cases: CourtCase[] };
export type Enforcement = { number: string | null; date: string | null; subject: string | null; debt: number | null; outstanding: number | null };
export type EnforcementsInfo = { total: number; debtSum: number; outstandingSum: number; items: Enforcement[] };
export type RnpRecord = { number: string | null; date: string | null; customer: string | null; purchase: string | null };
export type RnpInfo = { included: boolean; records: RnpRecord[] };
export type TaxesInfo = { year: string | null; paid: number | null; arrears: number | null; arrearsDate: string | null; regimes: string[] };
export type MspInfo = { category: string; since: string | null };
export type EfrsbMessage = { type: string | null; date: string | null; caseNumber: string | null };
export type SanctionsInfo = { included: boolean; countries: string[]; founderLinked: boolean };
export type ContactsInfo = { phones: string[]; emails: string[]; website: string | null };
export type ReliabilityFactor = { code: string | null; tone: Tone; weight: number | null; text: string };
export type ReliabilityInfo = {
  scale: number | null;
  nominality: { level: number | null; text: string | null };
  financial: { level: number | null; text: string | null };
  balance: { good: number; warn: number; bad: number };
  factors: ReliabilityFactor[];
};

export type CheckoCompany = {
  identity: Identity | null;
  address: string | null;
  statusText: string | null;
  rnp: RnpInfo;
  taxes: TaxesInfo | null;
  msp: MspInfo | null;
  staff: number | null;
  efrsb: EfrsbMessage[];
  sanctions: SanctionsInfo;
  contacts: ContactsInfo;
};

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map((x) => text(x)).filter((x): x is string => x !== null) : []);

/** /company или /entrepreneur: реквизиты, статус, адрес, руководитель, РНП, налоги, МСП, численность, ЕФРСБ, санкции, контакты. */
export function parseCheckoCompany(json: unknown, inn: string): CheckoCompany | null {
  const data = obj(obj(json).data);
  const status = obj(data.Статус);
  const terminated = isoAny(obj(data.Ликвид).Дата) ?? isoAny(obj(data.Прекращ).Дата);
  const isIp = inn.length === 12 || text(data.ОГРНИП) !== null;
  const shortName = text(data.НаимСокр);
  const fullName = text(data.НаимПолн);
  const personName = text(data.ФИО);
  const name = isIp ? personName : (fullName ?? shortName);
  const ogrn = text(data.ОГРН) ?? text(data.ОГРНИП);
  const registered = isoAny(data.ДатаРег);
  const head = arr(data.Руковод)[0];
  const headRole = isIp ? null : (text(head?.НаимДолжн) ?? text(head?.ВидДолжн));
  const headName = isIp ? null : text(head?.ФИО);

  const identity: Identity | null =
    name || ogrn || registered
      ? {
          name: name ?? inn,
          shortName: isIp ? name : shortName,
          ogrn,
          kpp: isIp ? null : text(data.КПП),
          registered,
          terminated,
          headRole,
          headName,
          region: text(obj(data.Регион).Наим),
        }
      : null;

  const address = isIp ? text(data.НасПункт) : text(obj(data.ЮрАдрес).АдресРФ);

  const records: RnpRecord[] = arr(data.НедобПостЗап)
    .map((r) => ({
      number: text(r.РеестрНомер),
      date: isoAny(r.ДатаПуб) ?? isoAny(r.ДатаУтв),
      customer: text(r.ЗаказНаимСокр) ?? text(r.ЗаказНаимПолн),
      purchase: text(r.ЗакупОпис) ?? text(r.ЗакупНомер),
    }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const rnp: RnpInfo = { included: bool(data.НедобПост) || records.length > 0, records };

  const taxesRaw = obj(data.Налоги);
  const regimes = (Array.isArray(taxesRaw.ОсобРежим) ? taxesRaw.ОсобРежим : []).map((x) => text(x)).filter((x): x is string => x !== null);
  const paid = num(taxesRaw.СумУпл);
  const arrears = num(taxesRaw.СумНедоим);
  const taxes: TaxesInfo | null =
    regimes.length > 0 || paid !== null || arrears !== null
      ? { year: text(taxesRaw.СведУплГод), paid, arrears, arrearsDate: isoAny(taxesRaw.НедоимДата), regimes }
      : null;

  const mspRaw = obj(data.РМСП);
  const category = text(mspRaw.Кат);
  const msp: MspInfo | null = category ? { category: category.toLowerCase(), since: isoAny(mspRaw.ДатаВкл) } : null;
  const staff = num(data.СЧР);

  const efrsb: EfrsbMessage[] = arr(data.ЕФРСБ)
    .map((r) => ({ type: text(r.Тип), date: isoAny(r.Дата), caseNumber: text(r.Дело) }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const sanctions: SanctionsInfo = { included: bool(data.Санкции), countries: strings(data.СанкцииСтраны), founderLinked: bool(data.СанкцУчр) };
  const contactsRaw = obj(data.Контакты);
  const contacts: ContactsInfo = { phones: strings(contactsRaw.Тел), emails: strings(contactsRaw.Емэйл), website: text(contactsRaw.ВебСайт) };

  if (!identity && !taxes && !msp && records.length === 0) return null;
  return { identity, address, statusText: text(status.Наим), rnp, taxes, msp, staff: staff !== null && staff > 0 ? staff : null, efrsb, sanctions, contacts };
}

/** /finances: выручка 2110, чистая прибыль 2400, активы 1600, капитал 1300 — за последние пять лет, в тысячах рублей. */
export function parseCheckoFinances(json: unknown): Statement[] {
  const data = obj(obj(json).data);
  return Object.entries(data)
    .filter(([year]) => /^\d{4}$/.test(year))
    .map(([year, raw]): Statement => {
      const row = obj(raw);
      return {
        year: Number(year),
        revenue: rublesToThousands(num(row["2110"])),
        netProfit: rublesToThousands(num(row["2400"])),
        assets: rublesToThousands(num(row["1600"])),
        equity: rublesToThousands(num(row["1300"])),
      };
    })
    .filter((s) => s.revenue !== null || s.netProfit !== null || s.assets !== null || s.equity !== null)
    .sort((a, b) => b.year - a.year)
    .slice(0, 5);
}

/** /legal-cases: сколько дел, роль, активность, сумма исков и последние дела. Сумма — рубли. */
export function parseCheckoLegalCases(json: unknown, inn: string): CourtsInfo | null {
  const data = obj(json).data;
  if (data === undefined || data === null) return null;
  const d = obj(data);
  const roleOf = (record: Record<string, unknown>): CourtRole => {
    if (arr(record.Ответ).some((p) => text(p.ИНН) === inn)) return "defendant";
    if (arr(record.Ист).some((p) => text(p.ИНН) === inn)) return "plaintiff";
    return "other";
  };
  const opponentOf = (record: Record<string, unknown>, role: CourtRole): string | null => {
    const side = role === "defendant" ? arr(record.Ист) : role === "plaintiff" ? arr(record.Ответ) : [];
    return text(side[0]?.Наим);
  };
  const cases: CourtCase[] = arr(d.Записи)
    .map((r) => {
      const role = roleOf(r);
      return {
        number: text(r.Номер) ?? "—",
        date: isoAny(r.Дата),
        url: text(r.СтрКАД),
        role,
        claimSum: num(r.СуммИск),
        active: bool(r.ПрАктив),
        result: text(r.ИсходТекст),
        opponent: opponentOf(r, role),
      };
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const claimSum = num(d.ОбщСуммИск) ?? (cases.some((c) => c.claimSum !== null) ? cases.reduce((sum, c) => sum + (c.claimSum ?? 0), 0) : null);
  return {
    total: num(d.ЗапВсего) ?? cases.length,
    active: cases.filter((c) => c.active).length,
    plaintiff: cases.filter((c) => c.role === "plaintiff").length,
    defendant: cases.filter((c) => c.role === "defendant").length,
    claimSum,
    cases,
  };
}

/** /enforcements: производства ФССП, суммы долга и остатка — рубли. */
export function parseCheckoEnforcements(json: unknown): EnforcementsInfo | null {
  const data = obj(json).data;
  if (data === undefined || data === null) return null;
  const items: Enforcement[] = arr(obj(data).Записи)
    .map((r) => ({
      number: text(r.ИспПрНомер),
      date: isoAny(r.ИспПрДата),
      subject: text(r.ПредмИсп),
      debt: num(r.СумДолг),
      outstanding: num(r.ОстЗадолж),
    }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return {
    total: items.length,
    debtSum: items.reduce((sum, i) => sum + (i.debt ?? 0), 0),
    outstandingSum: items.reduce((sum, i) => sum + (i.outstanding ?? 0), 0),
    items,
  };
}

/** /reliability: оценка Checko — масштаб, риск номинальности и финансовый, баланс факторов. Это мнение сервиса, не наш вывод. */
export function parseCheckoReliability(json: unknown): ReliabilityInfo | null {
  const data = obj(json).data;
  if (data === undefined || data === null) return null;
  const d = obj(data);
  const tone = (type: string | null): Tone => (type === "Полож" ? "good" : type === "Негатив" ? "danger" : "warn");
  const factors: ReliabilityFactor[] = arr(d.Факторы).map((f) => ({
    code: text(f.Код),
    tone: tone(text(f.Тип)),
    weight: num(f.Вес),
    text: text(f.Текст) ?? "",
  })).filter((f) => f.text.length > 0);
  const balance = obj(d.Баланс);
  const nominality = obj(d.Номинальность);
  const financial = obj(d.ФинРиски);
  return {
    scale: num(d.Масштаб),
    nominality: { level: num(nominality.Уровень), text: text(nominality.Наим) },
    financial: { level: num(financial.Уровень), text: text(financial.Наим) },
    balance: { good: num(balance.Полож) ?? 0, warn: num(balance.ТрВним) ?? 0, bad: num(balance.Негатив) ?? 0 },
    factors,
  };
}

/** Блокировка счетов отдельным полем в API нет: Checko показывает её как фактор надёжности. */
export type BlockingInfo = { blocked: boolean; text: string };
export function accountBlocking(reliability: ReliabilityInfo | null | undefined): BlockingInfo | null {
  if (!reliability) return null;
  const factor = reliability.factors.find((f) => /блокиров|приостановлен[^.]*счет|операций по счет/i.test(f.text));
  return factor ? { blocked: true, text: factor.text } : { blocked: false, text: "Сведений о приостановлении операций по счетам нет" };
}

// ——— Отчёт ———

export type Tone = "good" | "warn" | "danger" | "muted";
export type Fact = { id: string; label: string; text: string; tone: Tone };
export type ManualLink = { id: string; title: string; hint: string; url: string };
/** Кто ответил: открытые реестры напрямую или Checko API (в нём те же реестры одним ответом). */
export type ReportProvider = "direct" | "checko";

export type Parts = {
  inn: string;
  egrul: Identity | null;
  fedresurs: FedresursInfo | null;
  bo: BoOrganization | null;
  statements: Statement[];
  /** Адрес, если его назвал не ЕГРЮЛ, Федресурс и не ГИР БО (например, Checko). */
  address?: string | null;
  /** Статус словами реестра, когда он пришёл не через Федресурс (Checko: ЕГРЮЛ). */
  statusText?: string | null;
  rnp?: RnpInfo | null;
  taxes?: TaxesInfo | null;
  msp?: MspInfo | null;
  staff?: number | null;
  courts?: CourtsInfo | null;
  enforcements?: EnforcementsInfo | null;
  efrsb?: EfrsbMessage[] | null;
  sanctions?: SanctionsInfo | null;
  contacts?: ContactsInfo | null;
  reliability?: ReliabilityInfo | null;
  provider?: ReportProvider;
  sources: Partial<Record<SourceId, SourceState>>;
};

export type CounterpartyReport = {
  inn: string;
  kind: InnKind;
  at: string;
  name: string;
  identity: Identity | null;
  address: string | null;
  /** Статус словами реестра и его тон; null — ни один реестр статус не назвал. */
  status: { text: string; tone: Tone } | null;
  facts: Fact[];
  statements: Statement[];
  links: ManualLink[];
  provider?: ReportProvider;
  rnp?: RnpInfo | null;
  taxes?: TaxesInfo | null;
  msp?: MspInfo | null;
  staff?: number | null;
  courts?: CourtsInfo | null;
  enforcements?: EnforcementsInfo | null;
  efrsb?: EfrsbMessage[] | null;
  sanctions?: SanctionsInfo | null;
  contacts?: ContactsInfo | null;
  reliability?: ReliabilityInfo | null;
  sources: Partial<Record<SourceId, SourceState>>;
};

/** Тон статуса по словам реестра: банкротство и ликвидация — красным, «Действующее» — зелёным, остальное — внимание. */
export function statusTone(statusText: string): Tone {
  if (/банкрот|несостоятельн|ликвидац|прекращ|исключ[её]н/i.test(statusText)) return "danger";
  if (/^действу/i.test(statusText.trim())) return "good";
  return "warn";
}

const ruDate = (iso: string) => iso.split("-").reverse().join(".");
const yearsBetween = (fromIso: string, to: Date) => {
  const from = new Date(`${fromIso}T00:00:00Z`);
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  if (to.getUTCMonth() < from.getUTCMonth() || (to.getUTCMonth() === from.getUTCMonth() && to.getUTCDate() < from.getUTCDate())) years -= 1;
  return Math.max(0, years);
};
const plural = (n: number, one: string, few: string, many: string) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);

/** Сумма в тысячах рублей → «140,9 млрд ₽», «115,3 млн ₽», «830 тыс. ₽» (минус настоящий). Нет числа — тире. */
export function thousandsText(valueK: number | null): string {
  if (valueK === null) return "—";
  const sign = valueK < 0 ? "−" : "";
  const abs = Math.abs(valueK);
  const fmt = (n: number, digits: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: digits });
  const body = abs >= 1_000_000 ? `${fmt(abs / 1_000_000, 1)} млрд ₽` : abs >= 1_000 ? `${fmt(abs / 1_000, 1)} млн ₽` : `${fmt(abs, 0)} тыс. ₽`;
  return `${sign}${body}`.replace(/[  ]/g, " ").replace(/ /g, " ");
}

/** Порог «молодой компании»: меньше года с регистрации. */
export const YOUNG_COMPANY_YEARS = 1;

/** Рубли (КАД, ФССП, налоги Checko) → та же шкала, что у отчётности: тысячи рублей. */
const rublesText = (rub: number | null): string => thousandsText(rub === null ? null : Math.round(rub / 10) / 100);

/** Ссылки на то, что реестры без капчи не отдают: открываются в браузере участника, ИНН подставлен там, где сайт это позволяет. */
export function manualLinks(inn: string, fedresursGuid: string | null, auto: { rnp?: boolean; kad?: boolean; fssp?: boolean } = {}): ManualLink[] {
  const links: ManualLink[] = [
    { id: "rnp", title: "Реестр недобросовестных поставщиков", hint: "ЕИС, поиск по ИНН", url: `https://zakupki.gov.ru/epz/dishonestsupplier/search/results.html?searchString=${inn}` },
    { id: "kad", title: "Арбитражные дела", hint: `КАД: вставьте ИНН ${inn} в поиск`, url: "https://kad.arbitr.ru/" },
    { id: "fssp", title: "Исполнительные производства", hint: `ФССП: поиск по организации, ИНН ${inn}`, url: "https://fssp.gov.ru/iss/ip" },
    { id: "fedresurs", title: "Карточка на Федресурсе", hint: "сообщения о банкротстве и другие факты", url: fedresursGuid ? `https://fedresurs.ru/company/${fedresursGuid}` : "https://fedresurs.ru/search/entity" },
  ];
  return links.filter((l) => !(l.id === "rnp" && auto.rnp) && !(l.id === "kad" && auto.kad) && !(l.id === "fssp" && auto.fssp));
}

/** Собирает отчёт из того, что ответили реестры. Сам ничего не додумывает: не ответил реестр — этого факта нет, причина видна в sources. */
export function buildReport(parts: Parts, now: Date): CounterpartyReport {
  const { inn, egrul, fedresurs, bo, statements } = parts;
  const facts: Fact[] = [];

  // Статус: слова ЕГРЮЛ из Checko, затем Федресурса; дата прекращения в ЕГРЮЛ сильнее — организации уже нет.
  let status: CounterpartyReport["status"] = null;
  if (egrul?.terminated) status = { text: `Деятельность прекращена ${ruDate(egrul.terminated)} (ЕГРЮЛ)`, tone: "danger" };
  else if (parts.statusText) status = { text: parts.statusText, tone: statusTone(parts.statusText) };
  else if (fedresurs) status = { text: fedresurs.status, tone: statusTone(fedresurs.status) };
  else if (bo?.status) status = { text: bo.status === "ACTIVE" ? "Действующее" : bo.status, tone: bo.status === "ACTIVE" ? "good" : "warn" };

  if (egrul?.registered) {
    const years = yearsBetween(egrul.registered, now);
    facts.push({
      id: "age",
      label: "Возраст",
      text: `зарегистрирована ${ruDate(egrul.registered)}, ${years < 1 ? "меньше года" : `${years} ${plural(years, "год", "года", "лет")}`}`,
      tone: years < YOUNG_COMPANY_YEARS ? "warn" : "muted",
    });
  }
  if (egrul?.headName) facts.push({ id: "head", label: egrul.headRole ?? "Руководитель", text: egrul.headName, tone: "muted" });

  if (parts.rnp?.included) {
    const n = parts.rnp.records.length;
    const latest = parts.rnp.records[0];
    facts.push({
      id: "rnp",
      label: "РНП",
      text: `в реестре недобросовестных поставщиков${n > 0 ? `: ${n} ${plural(n, "запись", "записи", "записей")}${latest?.date ? `, последняя от ${ruDate(latest.date)}` : ""}` : ""}`,
      tone: "danger",
    });
  }

  if (parts.taxes) {
    const t = parts.taxes;
    const bits: string[] = [];
    if (t.paid !== null) bits.push(`уплачено ${rublesText(t.paid)}${t.year ? ` за ${t.year} год` : ""}`);
    if (t.regimes.length > 0) bits.push(`режим: ${t.regimes.join(", ")}`);
    if (bits.length > 0) facts.push({ id: "taxes", label: "Налоги", text: bits.join("; "), tone: "muted" });
    if (t.arrears !== null && t.arrears > 0) {
      facts.push({ id: "tax-arrears", label: "Задолженность", text: `${rublesText(t.arrears)} по налогам${t.arrearsDate ? ` на ${ruDate(t.arrearsDate)}` : ""}`, tone: "warn" });
    }
  }

  if (parts.msp) {
    const since = parts.msp.since;
    facts.push({ id: "msp", label: "МСП", text: `${parts.msp.category}${since ? ` с ${ruDate(since)}` : ""}`, tone: "muted" });
  }

  if (parts.staff !== null && parts.staff !== undefined) {
    facts.push({ id: "staff", label: "Сотрудники", text: `${parts.staff} ${plural(parts.staff, "человек", "человека", "человек")}`, tone: "muted" });
  }

  if (parts.courts) {
    const c = parts.courts;
    if (c.total === 0) facts.push({ id: "courts", label: "Арбитраж", text: "дел не найдено", tone: "muted" });
    else {
      const bits = [`${c.total} ${plural(c.total, "дело", "дела", "дел")}`];
      if (c.defendant > 0) bits.push(`ответчик — ${c.defendant}`);
      if (c.active > 0) bits.push(`активных — ${c.active}`);
      if (c.claimSum !== null && c.claimSum > 0) bits.push(`сумма исков ${rublesText(c.claimSum)}`);
      const latest = c.cases[0];
      if (latest?.date) bits.push(`последнее № ${latest.number} от ${ruDate(latest.date)}`);
      facts.push({ id: "courts", label: "Арбитраж", text: bits.join("; "), tone: c.active > 0 ? "warn" : "muted" });
    }
  }

  if (parts.enforcements) {
    const e = parts.enforcements;
    if (e.total === 0) facts.push({ id: "fssp", label: "Приставы", text: "производств не найдено", tone: "muted" });
    else {
      const bits = [`${e.total} ${plural(e.total, "производство", "производства", "производств")}`];
      if (e.outstandingSum > 0) bits.push(`остаток долга ${rublesText(e.outstandingSum)}`);
      else if (e.debtSum > 0) bits.push(`долг ${rublesText(e.debtSum)}`);
      const latest = e.items[0];
      if (latest?.date) bits.push(`последнее от ${ruDate(latest.date)}`);
      facts.push({ id: "fssp", label: "Приставы", text: bits.join("; "), tone: e.outstandingSum > 0 ? "warn" : "muted" });
    }
  }

  const sorted = [...statements].sort((a, b) => b.year - a.year);
  const last = sorted[0];
  if (last) {
    // Отчётность за прошлый календарный год сдают до 31 марта: до апреля ждём ещё за позапрошлый.
    const due = now.getUTCFullYear() - (now.getUTCMonth() >= 3 ? 1 : 2);
    if (last.year < due) facts.push({ id: "stale", label: "Отчётность", text: `последняя в ГИР БО — за ${last.year} год, за ${due} не найдена`, tone: "warn" });
    if (last.netProfit !== null && last.netProfit < 0) facts.push({ id: "loss", label: "Результат", text: `убыток за ${last.year} год: ${thousandsText(last.netProfit)}`, tone: "warn" });
    if (last.equity !== null && last.equity < 0) facts.push({ id: "equity", label: "Капитал", text: `собственный капитал отрицательный на конец ${last.year} года: ${thousandsText(last.equity)} — обязательства больше активов`, tone: "danger" });
  } else if (parts.sources.bo?.ok && (bo !== null || egrul !== null)) {
    facts.push({ id: "nostatements", label: "Отчётность", text: "в ГИР БО отчётности нет (бывает у ИП, малых и новых организаций)", tone: "muted" });
  }

  const name = egrul?.shortName ?? egrul?.name ?? fedresurs?.name ?? inn;
  return {
    inn,
    kind: innKind(inn),
    at: now.toISOString(),
    name,
    identity: egrul,
    address: fedresurs?.address ?? bo?.address ?? parts.address ?? null,
    status,
    facts,
    statements: sorted,
    links: manualLinks(inn, fedresurs?.guid ?? null, { rnp: parts.rnp !== null && parts.rnp !== undefined, kad: parts.courts !== null && parts.courts !== undefined, fssp: parts.enforcements !== null && parts.enforcements !== undefined }),
    provider: parts.provider ?? "direct",
    rnp: parts.rnp ?? null,
    taxes: parts.taxes ?? null,
    msp: parts.msp ?? null,
    staff: parts.staff ?? null,
    courts: parts.courts ?? null,
    enforcements: parts.enforcements ?? null,
    efrsb: parts.efrsb ?? null,
    sanctions: parts.sanctions ?? null,
    contacts: parts.contacts ?? null,
    reliability: parts.reliability ?? null,
    sources: parts.sources,
  };
}

/** Ни один реестр не нашёл организацию: ИНН верный по цифрам, но такой организации нет (или реестры не ответили — тогда видно по sources). */
export const notFound = (report: CounterpartyReport): boolean => !report.identity && !report.status && report.statements.length === 0 && Object.values(report.sources).every((s) => s.ok);
