// Скрытые затраты и риски: типовые гипотезы по виду закупки, сравнение места поставки с регионом компании и реестр решений участника по каждой гипотезе.
// Это ГИПОТЕЗЫ, а не находки из документов: код не знает цен и не доказывает, что затрата будет, — он напоминает, что проверить, и не даёт забыть. Поэтому в экране каждая помечена «Гипотеза».
// Найденное в договоре (неустойки, сроки оплаты, обеспечение, расходы исполнителя) — отдельно, с цитатами: lib/contract-risks.ts.
// Подтверждать гипотезы поиском и дополнять их под ваш объект будет ИИ и российский поиск — это следующий шаг плана; здесь — каталог без ИИ и без интернета.

import { regionOf, type Region } from "@/lib/regions";

type Doc = { name: string; text: string };

export type PurchaseType = "goods" | "works" | "services" | "it" | "food" | "general";

export const TYPE_LABELS: Record<PurchaseType, string> = {
  goods: "поставка товара",
  works: "работы (строительство, ремонт, проектирование)",
  services: "услуги",
  it: "ИТ и программное обеспечение",
  food: "питание",
  general: "закупка",
};

const TYPE_RULES: [PurchaseType, RegExp][] = [
  ["food", /питани|продовольств|столов[а-яё]+|кормлен|общепит/i],
  ["it", /программн[а-яё]+\s+обеспечени|разработк[а-яё]*\s+(?:по|сайт|систем|приложен|информационн)|информационн[а-яё]+\s+систем|лицензи[а-яё]*\s+на\s+(?:по|программ)|облачн|(?<![а-яё])ИТ-|(?<![а-яё])SaaS/i],
  ["works", /строительств|ремонт|монтаж|реконструкц|капитальн|обследовани|проектно|(?<![а-яё])СМР(?![а-яё])|благоустройств|демонтаж|выполнени[а-яё]*\s+(?:подрядных\s+)?работ|(?<![а-яё])работ[аы]\s+по/i],
  ["goods", /поставк|приобретени|товар|оборудовани|мебел|(?<![а-яё])уголь|(?<![а-яё])топлив|продукци|материал|изготовлени/i],
  ["services", /услуг|охран|уборк|обслуживани|организаци[а-яё]*\s+(?:и\s+проведени|мероприят)/i],
];

/** Вид закупки по предмету и способу: от него зависит, какие гипотезы показывать. Не определился — «закупка» (только общие). */
export function typeOf(subject: string, kind = ""): PurchaseType {
  const text = `${subject} ${kind}`;
  for (const [type, re] of TYPE_RULES) if (re.test(subject) || re.test(text)) return type;
  return "general";
}

export type Hypothesis = { id: string; types: PurchaseType[] | "all"; title: string; check: string };

export const HYPOTHESES: Hypothesis[] = [
  // Для любой закупки
  { id: "cashgap", types: "all", title: "Кассовый разрыв", check: "Платёж приходит после приёмки и подписания актов. Посчитайте, на сколько дней вам нужны свои деньги, и сверьте со сроком оплаты и авансом в договоре." },
  { id: "guarantee", types: "all", title: "Стоимость обеспечения", check: "Банковская гарантия стоит денег (процент в год от суммы на весь срок), залог замораживает деньги. Заложите это в цену." },
  { id: "penalties", types: "all", title: "Пени за просрочку", check: "Срыв срока по вашей или чужой вине (поставщик, погода, согласования) обернётся пеней. Сверьте размер пени из договора с запасом по срокам." },
  { id: "reaccept", types: "all", title: "Повторная приёмка и замечания", check: "Заказчик вернёт работу или товар с замечаниями: время и деньги на исправление. Заложите резерв." },
  { id: "price-growth", types: "all", title: "Рост цен за срок исполнения", check: "Цена в контракте фиксированная, а материалы, топливо и зарплаты за срок могут вырасти. Чем длиннее срок, тем больше нужен запас." },
  { id: "papers", types: "all", title: "Документы и согласования", check: "Исполнительная документация, сертификаты и согласования отнимают время сотрудников или стоят денег как услуга." },
  // Поставка товара
  { id: "logistics", types: ["goods"], title: "Доставка до места", check: "Расстояние, габариты, разгрузка, подъём, ожидание на приёмке. Запросите расчёт у перевозчика: для дальних и труднодоступных мест тариф выше обычного." },
  { id: "fx", types: ["goods"], title: "Курс валюты и импорт", check: "Если товар или комплектующие куплены за валюту, курс за срок поставки меняет себестоимость." },
  { id: "warranty", types: ["goods"], title: "Гарантия и замена брака", check: "Гарантийные обязательства: замена, выезд, запас на складе. Узнайте срок и условия гарантии у производителя." },
  { id: "storage", types: ["goods"], title: "Хранение, упаковка и страхование груза", check: "До приёмки груз на вас: склад, упаковка, страховка." },
  { id: "origin", types: ["goods"], title: "Страна происхождения и реестры", check: "Там, где закупка требует российский товар или номер в реестре, замена товара на допустимый стоит дороже." },
  { id: "batch", types: ["goods"], title: "Партии и сроки поставки", check: "Поставка частями по графику: при сбое придётся доставлять срочно и дороже." },
  // Работы
  { id: "materials", types: ["works"], title: "Материалы и их цена", check: "Смета заказчика составлена в базовых ценах; фактическая цена материалов на момент закупки может быть выше." },
  { id: "subcontract", types: ["works"], title: "Субподряд и допуски", check: "Для части работ нужны лицензии, допуски или членство в СРО; у субподрядчика своя маржа." },
  { id: "expertise", types: ["works"], title: "Экспертиза и строительный контроль", check: "Проверьте в договоре, кто платит за экспертизу и контроль: расходы могут быть возложены на вас." },
  { id: "season", types: ["works"], title: "Сезонность и погода", check: "Работы на улице зимой или в дожди: простои, обогрев, срыв сроков." },
  { id: "site", types: ["works"], title: "Выезд на объект и проживание", check: "Бригада, техника, проживание и вахта — затраты, которых нет в смете." },
  { id: "scope", types: ["works"], title: "Неучтённые объёмы", check: "Фактический объём окажется больше сметного: дополнительные работы не всегда оплачиваются." },
  // Услуги
  { id: "payroll", types: ["services"], title: "Зарплаты и замена персонала", check: "Фонд оплаты труда растёт, сотрудники болеют и увольняются: замена и обучение за ваш счёт." },
  { id: "sla", types: ["services"], title: "Качество и штрафы за сбои", check: "Штрафы за каждое нарушение графика или качества складываются. Оцените, сколько сбоев вы допускаете в обычный месяц." },
  { id: "trips", types: ["services"], title: "Выезды и транспорт", check: "Командировки, топливо, амортизация транспорта." },
  { id: "permits", types: ["services"], title: "Лицензии и допуски персонала", check: "Удостоверения, лицензии, медосмотры и обучение нужны к началу услуг." },
  // ИТ
  { id: "estimate", types: ["it"], title: "Оценка трудозатрат", check: "Недооценка сроков разработки — главная причина убытка: заложите резерв на переделки и согласования." },
  { id: "licenses", types: ["it"], title: "Лицензии на ПО и облако", check: "Лицензии и хостинг в рублях (импортозамещение) могут стоить дороже расчётных." },
  { id: "support", types: ["it"], title: "Поддержка после сдачи", check: "Гарантийная поддержка и исправления после приёмки идут из вашего времени." },
  { id: "rights", types: ["it"], title: "Права на результат", check: "Передача исключительных прав, документации и исходных кодов: проверьте условия и стоимость." },
  // Питание
  { id: "products", types: ["food"], title: "Цены на продукты и сезонность", check: "Цены на овощи, мясо и молочные продукты сильно меняются за срок контракта." },
  { id: "sanitary", types: ["food"], title: "Санитарные требования и контроль", check: "Медкнижки, лабораторный контроль, утилизация — затраты, которых нет в цене порции." },
  { id: "headcount", types: ["food"], title: "Фактическое число порций", check: "Число детей или посетителей меняется, а постоянные расходы остаются." },
];

export type HypothesisView = Hypothesis & {
  /** Подпись о том, откуда гипотеза: «типовая для этого вида закупки» или «по вашему адресу и месту поставки». */
  basis: string;
};

// ——— Место поставки и регион компании ———

// Подпись места: «Место поставки: …», «Адрес оказания услуг | …»; или «поставка осуществляется по адресу: …», «объект … по адресу: …».
const PLACES = [
  /(?:место|адрес|пункт)[а-яё]*\s+(?:поставки|доставки|назначения|выполнения|оказания|проведения|нахождения\s+объекта|нахождения\s+имущества|исполнения\s+(?:договор|контракт))[^\n]{0,260}/i,
  /(?:поставк|доставк|выполнени|оказани|объект)[а-яё]*[^\n.]{0,120}по\s+адресу[^\n]{0,200}/i,
];

export type PlaceInfo = { text: string; region: Region } | null;

/** Место поставки или исполнения из документов закупки: первая строка с такой подписью, где назван регион или город. */
export function placeOf(documents: Doc[]): PlaceInfo {
  for (const re of PLACES) {
    for (const doc of documents) {
      for (const line of doc.text.split("\n")) {
        const m = re.exec(line);
        if (!m) continue;
        const region = regionOf(m[0]);
        if (region) return { text: m[0].replace(/\s+/g, " ").trim().slice(0, 200), region };
      }
    }
  }
  return null;
}

export type RegionNote = { kind: "other" | "same" | "company-unknown"; place: Region; company: Region | null };

export function regionNote(place: PlaceInfo, address: string): RegionNote | null {
  if (!place) return null;
  const company = regionOf(address);
  if (!company) return { kind: "company-unknown", place: place.region, company: null };
  return { kind: company.name === place.region.name ? "same" : "other", place: place.region, company };
}

export function hypothesesFor(type: PurchaseType, note: RegionNote | null): HypothesisView[] {
  const list: HypothesisView[] = [];
  if (note?.kind === "other") {
    list.push({
      id: "region",
      types: "all",
      title: `Место поставки — ${note.place.name}, ваш адрес — ${note.company!.name}`,
      check: `Доставка или выезд в другой регион: логистика и командировочные могут стоить дороже расчётных.${note.place.hard ? " Регион удалённый или с особыми условиями перевозки — запросите тарифы и сроки заранее." : ""}`,
      basis: "по месту поставки и вашему адресу",
    });
  } else if (note?.kind === "company-unknown") {
    list.push({
      id: "region-unknown",
      types: "all",
      title: `Место поставки — ${note.place.name}`,
      check: "Укажите юридический адрес в «Профиле компании» — сравню регион поставки с вашим и скажу, будет ли доставка или выезд дороже.",
      basis: "по месту поставки",
    });
  }
  const own = HYPOTHESES.filter((h) => h.types !== "all" && h.types.includes(type));
  const common = HYPOTHESES.filter((h) => h.types === "all");
  for (const h of [...own, ...common]) list.push({ ...h, basis: h.types === "all" ? "типовая для любой закупки" : `типовая для вида «${TYPE_LABELS[type]}»` });
  return list;
}

// ——— Реестр: что участник решил по каждой гипотезе ———

export type RegisterState = "open" | "priced" | "skip";
export type RegisterItem = { state: RegisterState; amount: string };
export type Driver = { id: string; name: string; amount: string; shock: string };
export type SensitivityData = { price: string; cost: string; drivers: Driver[] };
export type RegisterData = { items: Record<string, RegisterItem>; sens: SensitivityData };

export const EMPTY_REGISTER: RegisterData = { items: {}, sens: { price: "", cost: "", drivers: [] } };

const str = (x: unknown) => (typeof x === "string" ? x : "");

/** Данные из хранилища могут быть старше или повреждены: берём только то, что понимаем. */
export function normalizeRegister(raw: unknown): RegisterData {
  const input = (raw && typeof raw === "object" ? raw : {}) as { items?: Record<string, Record<string, unknown>>; sens?: { price?: unknown; cost?: unknown; drivers?: unknown } };
  const items: Record<string, RegisterItem> = {};
  for (const [id, v] of Object.entries(input.items && typeof input.items === "object" ? input.items : {})) {
    if (!v || typeof v !== "object") continue;
    items[id] = { state: v.state === "priced" || v.state === "skip" ? v.state : "open", amount: str(v.amount) };
  }
  const drivers = (Array.isArray(input.sens?.drivers) ? (input.sens!.drivers as Record<string, unknown>[]) : []).flatMap((d): Driver[] =>
    d && typeof d === "object" && typeof d.id === "string" ? [{ id: d.id, name: str(d.name), amount: str(d.amount), shock: str(d.shock) }] : [],
  );
  return { items, sens: { price: str(input.sens?.price), cost: str(input.sens?.cost), drivers } };
}

/** Сколько гипотез ещё не разобрано: по ним участник не решил «учтено» или «не актуально». */
export const openCount = (list: { id: string }[], data: RegisterData) => list.filter((h) => (data.items[h.id]?.state ?? "open") === "open").length;

/** Статьи затрат для таблицы чувствительности — по виду закупки; участник добавляет и меняет свои. */
export const DEFAULT_DRIVERS: Record<PurchaseType, string[]> = {
  goods: ["Закупка товара", "Доставка и топливо", "Курс валюты"],
  works: ["Материалы", "Зарплаты бригады", "Техника и топливо", "Субподряд"],
  services: ["Зарплаты", "Транспорт и топливо"],
  it: ["Зарплаты разработчиков", "Лицензии и облако"],
  food: ["Продукты", "Зарплаты", "Коммунальные расходы"],
  general: ["Материалы", "Зарплаты", "Топливо и доставка"],
};
