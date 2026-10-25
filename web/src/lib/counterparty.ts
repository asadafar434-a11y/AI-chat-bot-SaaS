// Проверка контрагента по ИНН по открытым реестрам, без ИИ и без платы: что за организация и действует ли она (ЕГРЮЛ, Федресурс) и что у неё с отчётностью (ГИР БО ФНС).
// Модуль чистый: разбирает ответы реестров и собирает отчёт; сами запросы делает сервер (server/counterparty/). Чего реестры без капчи не дают — суды (КАД), приставы (ФССП),
// реестр недобросовестных поставщиков (ЕИС) — программа не выдумывает: даёт ссылку на ручную проверку и честно говорит «ждёт источника».
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

// ——— Источники ———

export type SourceId = "egrul" | "fedresurs" | "bo";
export const SOURCE_NAMES: Record<SourceId, string> = { egrul: "ЕГРЮЛ", fedresurs: "Федресурс", bo: "ГИР БО ФНС" };
export type SourceState = { ok: true } | { ok: false; reason: string };

const isoOfRu = (s: unknown): string | null => {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(typeof s === "string" ? s.trim() : "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
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

// ——— Отчёт ———

export type Tone = "good" | "warn" | "danger" | "muted";
export type Fact = { id: string; label: string; text: string; tone: Tone };
export type ManualLink = { id: string; title: string; hint: string; url: string };

export type Parts = {
  inn: string;
  egrul: Identity | null;
  fedresurs: FedresursInfo | null;
  bo: BoOrganization | null;
  statements: Statement[];
  sources: Record<SourceId, SourceState>;
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
  sources: Record<SourceId, SourceState>;
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

/** Ссылки на то, что реестры без капчи не отдают: открываются в браузере участника, ИНН подставлен там, где сайт это позволяет. */
export function manualLinks(inn: string, fedresursGuid: string | null): ManualLink[] {
  return [
    { id: "rnp", title: "Реестр недобросовестных поставщиков", hint: "ЕИС, поиск по ИНН", url: `https://zakupki.gov.ru/epz/dishonestsupplier/search/results.html?searchString=${inn}` },
    { id: "kad", title: "Арбитражные дела", hint: `КАД: вставьте ИНН ${inn} в поиск`, url: "https://kad.arbitr.ru/" },
    { id: "fssp", title: "Исполнительные производства", hint: `ФССП: поиск по организации, ИНН ${inn}`, url: "https://fssp.gov.ru/iss/ip" },
    { id: "fedresurs", title: "Карточка на Федресурсе", hint: "сообщения о банкротстве и другие факты", url: fedresursGuid ? `https://fedresurs.ru/company/${fedresursGuid}` : "https://fedresurs.ru/search/entity" },
  ];
}

/** Собирает отчёт из того, что ответили реестры. Сам ничего не додумывает: не ответил реестр — этого факта нет, причина видна в sources. */
export function buildReport(parts: Parts, now: Date): CounterpartyReport {
  const { inn, egrul, fedresurs, bo, statements } = parts;
  const facts: Fact[] = [];

  // Статус: слова Федресурса; ЕГРЮЛ с датой прекращения сильнее — организации уже нет.
  let status: CounterpartyReport["status"] = null;
  if (egrul?.terminated) status = { text: `Деятельность прекращена ${ruDate(egrul.terminated)} (ЕГРЮЛ)`, tone: "danger" };
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

  const sorted = [...statements].sort((a, b) => b.year - a.year);
  const last = sorted[0];
  if (last) {
    // Отчётность за прошлый календарный год сдают до 31 марта: до апреля ждём ещё за позапрошлый.
    const due = now.getUTCFullYear() - (now.getUTCMonth() >= 3 ? 1 : 2);
    if (last.year < due) facts.push({ id: "stale", label: "Отчётность", text: `последняя в ГИР БО — за ${last.year} год, за ${due} не найдена`, tone: "warn" });
    if (last.netProfit !== null && last.netProfit < 0) facts.push({ id: "loss", label: "Результат", text: `убыток за ${last.year} год: ${thousandsText(last.netProfit)}`, tone: "warn" });
    if (last.equity !== null && last.equity < 0) facts.push({ id: "equity", label: "Капитал", text: `собственный капитал отрицательный на конец ${last.year} года: ${thousandsText(last.equity)} — обязательства больше активов`, tone: "danger" });
  } else if (parts.sources.bo.ok && (bo !== null || egrul !== null)) {
    facts.push({ id: "nostatements", label: "Отчётность", text: "в ГИР БО отчётности нет (бывает у ИП, малых и новых организаций)", tone: "muted" });
  }

  const name = egrul?.shortName ?? egrul?.name ?? fedresurs?.name ?? inn;
  return {
    inn,
    kind: innKind(inn),
    at: now.toISOString(),
    name,
    identity: egrul,
    address: fedresurs?.address ?? bo?.address ?? null,
    status,
    facts,
    statements: sorted,
    links: manualLinks(inn, fedresurs?.guid ?? null),
    sources: parts.sources,
  };
}

/** Ни один реестр не нашёл организацию: ИНН верный по цифрам, но такой организации нет (или реестры не ответили — тогда видно по sources). */
export const notFound = (report: CounterpartyReport): boolean => !report.identity && !report.status && report.statements.length === 0 && Object.values(report.sources).every((s) => s.ok);
