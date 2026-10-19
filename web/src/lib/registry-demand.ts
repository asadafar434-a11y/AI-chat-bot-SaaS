import { createLocator, describeSource, type LocatableDoc } from "@/lib/doc-locate";
import { nameTerms, stemWord, lowerWords } from "@/lib/registry-text";
import type { RegistryKind } from "@/lib/registry-types";

// Требует ли закупка реестровый номер, и какого реестра. Только код и дословные цитаты, без ИИ: вывод можно проверить глазами.
// Слово «реестр» не доказывает требование: в извещении оно стоит и в «реестре контрактов», и в «реестре недобросовестных
// поставщиков». Берутся только места, где названа промышленная продукция, национальный режим или номер реестровой записи.

export type MentionKind = "rpp_719" | "radio_878" | "other_registry" | "national_regime" | "registry_number" | "origin_country";

/** requirement — документ требует; exemption — документ говорит, что не применяется; mention — просто упомянуто. */
export type MentionRole = "requirement" | "exemption" | "mention";

export type DemandMention = { kind: MentionKind; role: MentionRole; quote: string; document: string; place?: string };

export type RegistryDemand = {
  /** found — требование есть; unclear — что-то про происхождение есть, но реестр не назван; none — требования нет. */
  status: "found" | "unclear" | "none";
  /** Реестр, который требуется и который есть в системе. */
  registry: RegistryKind | null;
  /** Требуется реестр, выгрузки которого в системе нет (реестр программ и другие). */
  unsupported: "other_registry" | null;
  mentions: DemandMention[];
  /** Номера позиций (с 0), которые названы в тех же предложениях, что и требование. Подсказка, а не фильтр: ищем по всем. */
  appliesTo: number[];
  notes: string[];
};

const PATTERNS: Record<Exclude<MentionKind, "origin_country">, RegExp[]> = {
  rpp_719: [
    /реестр[а-яё]*\s+российск[а-яё]*\s+промышленн[а-яё]*\s+продукци/i,
    /(?<![а-яёА-ЯЁ])РПП(?![а-яёА-ЯЁ])/,
    /(?:постановлени[а-яё]*|(?<![а-яёА-ЯЁ])ПП)[^\n]{0,80}?(?<![\d.,])719(?![\d.])/i,
    /ГИСП/,
  ],
  radio_878: [
    /реестр[а-яё]*\s+российск[а-яё]*\s+радиоэлектронн[а-яё]*\s+продукци/i,
    /(?<![а-яёА-ЯЁ])РЭП(?![а-яёА-ЯЁ])/,
    /(?:постановлени[а-яё]*|(?<![а-яёА-ЯЁ])ПП)[^\n]{0,80}?(?<![\d.,])878(?![\d.])/i,
  ],
  other_registry: [
    /реестр[а-яё]*\s+российск[а-яё]*\s+программ/i,
    /реестр[а-яё]*\s+евразийск[а-яё]*\s+программ/i,
    /реестр[а-яё]*\s+евразийск[а-яё]*\s+промышленн/i,
    /реестр[а-яё]*\s+отечественн[а-яё]*\s+(?:программн|ПО)/i,
  ],
  national_regime: [
    /национальн[а-яё]*\s+режим/i,
    /(?<![\d.,])1875(?![\d]|[.,]\d)/,
    /(?<![а-яёА-ЯЁ\d])126н(?![а-яёА-ЯЁ\d])/i,
    /ограничени[а-яё]*[^.\n]{0,70}допуск[а-яё]*[^.\n]{0,100}происходящ/i,
    /условия\s+допуска\s+товаров[^.\n]{0,60}происходящих/i,
    // Строки информационной карты «Запрет закупок товаров… | НЕ УСТАНОВЛЕНО», «Преимущество в отношении товаров российского происхождения… | УСТАНОВЛЕНО».
    /(?:запрет|ограничени[а-яё]*|преимуществ[а-яё]*)\s+(?:закупок\s+)?(?:в\s+отношении\s+)?товар[а-яё]*[^\n]{0,500}\|\s*(?:не\s+)?установлен[а-яё]*\s*$/i,
  ],
  registry_number: [/номер[а-яё]*\s+реестров[а-яё]*\s+запис/i, /реестров[а-яё]*\s+номер(?!а?\s+(?:закупк|извещени|контракт|договор|аукцион|конкурс|запрос|процедур|лот))/i, /реестров[а-яё]*\s+запис/i],
};

const ORIGIN_COUNTRY = /(?:страна|страны|стран[уе])\s+происхождени/i;
const REQUIRE = /(долж[а-яё]*|обязан[а-яё]*|необходим[а-яё]*|требуется|требуются|предоставля[а-яё]*|указыва[а-яё]*|указать|подтвержда[а-яё]*|представля[а-яё]*|содерж[а-яё]*|приложить|наличи[а-яё]*|в\s+составе\s+заявки)/i;
const EXEMPT = /(не\s+применя[а-яё]*|не\s+устанавлива[а-яё]*|не\s+установлен[а-яё]*|не\s+предусмотрен[а-яё]*|отсутству[а-яё]*|не\s+требуется|не\s+требу[а-яё]*)/i;

// «В случае, если закупаемый товар включён в единый реестр радиоэлектронной продукции…» — условие про товар определённого рода, а не требование ко всем закупкам.
// Реестры, где искать номер товара, мы проверяем всегда по самому товару участника, поэтому такие абзацы требованием не считаем.
const CONDITIONAL_GOODS = /в\s+случае,?\s*(?:если|когда)[^.;]{0,80}(?:товар|продукци)[^.;]{0,60}включ[её]н/i;

// «При осуществлении закупки предоставляется национальный режим» — иностранный товар приравнен к российскому, запрета и ограничений нет.
// «Национальный режим не предоставляется» — наоборот: ограничения действуют.
const GRANTED = /(?<!не\s)предоставля[а-яё]*\s+национальн[а-яё]*\s+режим|национальн[а-яё]*\s+режим[а-яё]*\s+(?<!не\s)предоставля[а-яё]*/i;
// «Если в подразделе 1.2 установлен режим запрета…» — условие про другой раздел (карту закупки), а не требование: настоящее требование стоит в самой карте.
// То же про основания отказа: «Несоответствия участника правилам предоставления национального режима при условии, что Правительством установлены запрет, ограничение…».
const CONDITIONAL_CARD = /^\s*(?:\d+(?:\.\d+)*\.?\s+)?(?:если|в\s+случае,?\s+если)\s+(?:в|согласно|по)\s+(?:подраздел|пункт|п\.|раздел|информационн|извещени)[а-яё]*\s*[\d.]*[^,]{0,80}?(?:установлен|предусмотрен|указан)|при\s+условии,?\s+что[^.]{0,140}?(?:установлен|предусмотрен)[а-яё]*/i;

// «Номера реестровых записей» бывают и у договоров в реестре ЕИС (для оценки опыта): «…содержатся в открытых и общедоступных государственных реестрах…»,
// «информацию о номерах реестровых записей рекомендуется предоставлять в структурированном виде». К реестру промышленной продукции это не относится.
const NOT_PRODUCT_REGISTRY = /общедоступных\s+государственных\s+реестрах|реестр[а-яё]*\s+(?:договоров|контрактов)|реестров[а-яё]*\s+номер[а-яё]*\s+(?:контракт|договор)|рекомендуется\s+предоставлять\s+в\s+структурированном\s+виде/i;

const MAX_MENTIONS = 8;
const QUOTE_MAX = 400;

const sentencesOf = (text: string): string[] =>
  text
    .split(/(?<=[.!?;])\s+|\n+/u)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 12);

function kindsIn(sentence: string): MentionKind[] {
  const out: MentionKind[] = [];
  for (const [kind, patterns] of Object.entries(PATTERNS) as [Exclude<MentionKind, "origin_country">, RegExp[]][]) {
    if (patterns.some((re) => re.test(sentence))) out.push(kind);
  }
  if (ORIGIN_COUNTRY.test(sentence)) out.push("origin_country");
  return out;
}

export function detectRegistryDemand(docs: LocatableDoc[], goods: { name: string }[] = []): RegistryDemand {
  const mentions: DemandMention[] = [];
  const seen = new Set<string>();
  const sentencesWithKinds: { sentence: string; kinds: MentionKind[] }[] = [];
  const grantedIn = new Set<string>();

  for (const doc of docs) {
    for (const sentence of sentencesOf(doc.text)) {
      const kinds = kindsIn(sentence);
      if (!kinds.length || CONDITIONAL_GOODS.test(sentence) || CONDITIONAL_CARD.test(sentence)) continue;
      const quote = sentence.slice(0, QUOTE_MAX);
      sentencesWithKinds.push({ sentence, kinds });
      const exempt = EXEMPT.test(sentence);
      const role: MentionRole = exempt ? "exemption" : REQUIRE.test(sentence) ? "requirement" : "mention";
      const granted = GRANTED.test(sentence);
      for (const kind of kinds) {
        if (kind === "registry_number" && NOT_PRODUCT_REGISTRY.test(sentence)) continue;
        const key = `${kind}|${quote}`;
        if (seen.has(key) || mentions.length >= MAX_MENTIONS * 3) continue;
        seen.add(key);
        if (kind === "national_regime" && granted) grantedIn.add(doc.name);
        mentions.push({ kind, role: kind === "national_regime" && granted ? "exemption" : role, quote, document: doc.name });
      }
    }
  }

  // Заказчик пишет, что меры национального режима (запрет, ограничение, преимущество) не применяются: общие слова о режиме в том же документе
  // («предоставляется национальный режим…», название постановления) требованием не считаем. Если рядом названа конкретная мера — оставляем как есть.
  const regimeOff = new Set(
    mentions.filter((m) => m.kind === "national_regime" && m.role === "exemption" && /запрет|ограничени|преимуществ|мер[аы]/i.test(m.quote)).map((m) => m.document),
  );
  for (const m of mentions) {
    if (m.kind === "national_regime" && m.role !== "exemption" && (regimeOff.has(m.document) || grantedIn.has(m.document)) && !/запрет|ограничени|преимуществ/i.test(m.quote)) m.role = "exemption";
  }

  const live = (kind: MentionKind) => mentions.filter((m) => m.kind === kind && m.role !== "exemption");
  const rpp = live("rpp_719");
  const radio = live("radio_878");
  const other = live("other_registry");
  const regime = live("national_regime");
  const regNumber = live("registry_number");
  const origin = live("origin_country");
  const exemptions = mentions.filter((m) => m.role === "exemption" && m.kind !== "origin_country");
  const notes: string[] = [];

  let status: RegistryDemand["status"] = "none";
  let registry: RegistryKind | null = null;
  let unsupported: RegistryDemand["unsupported"] = null;

  const named = Number(rpp.length > 0) + Number(radio.length > 0) + Number(other.length > 0);
  const rppStrong = rpp.some((m) => m.role === "requirement") || regime.length > 0 || regNumber.length > 0;

  if (named > 1) {
    status = "unclear";
    notes.push("В документах названо несколько реестров — номер ищется сразу во всех; проверьте по документам, из какого реестра закупка принимает номер.");
  } else if (rpp.length > 0 && rppStrong) {
    status = "found";
    registry = "gisp_rpp_719";
  } else if (radio.length > 0) {
    status = "found";
    registry = "gisp_rep_878";
  } else if (other.length > 0) {
    status = "found";
    unsupported = "other_registry";
    notes.push("Требуется реестр, выгрузки которого в системе нет (например, реестр программ). Поиск не выполняется.");
  } else if (rpp.length > 0 || regime.length > 0 || regNumber.length > 0) {
    status = "unclear";
    notes.push(
      regime.length > 0
        ? "В документах есть национальный режим или ограничение по происхождению, но реестр не назван — уточните, какой реестр применим."
        : "В документах упомянут реестровый номер, но не сказано, из какого реестра, — уточните.",
    );
  } else if (exemptions.length > 0) {
    notes.push("Документы говорят, что ограничения по происхождению или национальный режим не применяются.");
  }

  if (status === "found" && exemptions.length > 0) notes.push("В документах есть и оговорка «не применяется» — проверьте, к чему она относится.");
  if (status === "none" && origin.length > 0) notes.push("В документах просят указать страну происхождения товара; требования о реестровом номере не найдено.");

  // Названия позиций в тех же предложениях, где идёт речь о реестре: подсказка, к каким позициям, по-видимому, относится требование.
  const appliesTo: number[] = [];
  if (status === "found" || status === "unclear") {
    const relevant = sentencesWithKinds.filter((s) => s.kinds.some((k) => k !== "origin_country"));
    goods.forEach((good, index) => {
      const terms = nameTerms(good.name);
      if (terms.length === 0) return;
      const hit = relevant.some(({ sentence }) => {
        const stems = new Set(lowerWords(sentence).map(stemWord));
        return terms.slice(0, 2).every((t) => stems.has(t));
      });
      if (hit) appliesTo.push(index);
    });
  }

  // Места в документах: для первых цитат, чтобы можно было открыть и проверить.
  const locator = createLocator(docs);
  const shown = mentions
    .filter((m) => m.role !== "mention" || m.kind !== "origin_country")
    .sort((a, b) => Number(b.role === "requirement") - Number(a.role === "requirement"))
    .slice(0, MAX_MENTIONS)
    .map((m) => {
      const located = locator.locate(m.quote);
      return located ? { ...m, place: describeSource(located) } : m;
    });

  return { status, registry, unsupported, mentions: shown, appliesTo, notes };
}
