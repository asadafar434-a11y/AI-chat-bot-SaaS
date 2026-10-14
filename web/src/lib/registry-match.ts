import { searchName, type CardField, type ProductCard } from "@/lib/product-card";
import {
  compact,
  differentOrg,
  isInn,
  measuresIn,
  modelTokens,
  nameTerms,
  okpd2Relation,
  sameOrg,
  standardRefs,
  termOverlap,
} from "@/lib/registry-text";
import type { StoredRegistryRecord } from "@/lib/registry-types";

// Сопоставление товара участника с записью реестра. Разбираются признаки, а не «похожесть названий»:
//   подтверждающие — совпал устойчивый идентификатор (ИНН, модель, ТУ…), который назвал сам участник;
//   нейтральные   — сведений нет у одной из сторон или их нельзя проверить; отсутствие данных совпадением не считается;
//   противоречащие — разные производитель, модель, ТУ, категория или размер: это признак другого товара.
// Число rank нужно только для порядка в списке кандидатов. Оно ничего не доказывает и порога не имеет.

export type SignalField = "inn" | "manufacturer" | "model" | "article" | "madeBy" | "okpd2" | "name" | "measure" | "registryNumber" | "brand";

export type Signal = {
  field: SignalField;
  verdict: "confirm" | "neutral" | "contradict";
  /** Подтверждает, что запись — именно товар участника (а не просто похожая категория). */
  identifying: boolean;
  /** Противоречие по существенному признаку: запись нельзя выбрать автоматически. */
  critical: boolean;
  text: string;
};

export type Matching = {
  signals: Signal[];
  confirmed: Signal[];
  neutral: Signal[];
  contradictions: Signal[];
  critical: Signal[];
  /** Поля, по которым запись подтверждена как товар участника. */
  identity: SignalField[];
  /** Достаточно проверенных идентификаторов: производитель + модель, артикул или ТУ. */
  provenIdentity: boolean;
  /** Что-то из назначенного участником совпало (хотя бы один идентификатор). */
  hasIdentity: boolean;
  nameExact: boolean;
  rank: number;
};

const own = (card: ProductCard, field: CardField) => {
  const f = card.fields[field];
  return f && f.origin !== "tz" && f.value ? f : null;
};

const sig = (field: SignalField, verdict: Signal["verdict"], text: string, opts: { identifying?: boolean; critical?: boolean } = {}): Signal => ({
  field,
  verdict,
  text,
  identifying: opts.identifying ?? false,
  critical: opts.critical ?? false,
});

/** Все сочетания из 1–4 подряд идущих слов в сжатом виде: «КТО 05/Х» → КТО, 05Х, КТО05Х. Сравнение по целым словам, а не по подстроке. */
function wordGrams(text: string): Set<string> {
  const words = text
    .split(/[\s,;()«»"“”]+/u)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    let acc = "";
    for (let n = 0; n < 4 && i + n < words.length; n++) {
      acc += compact(words[i + n]);
      out.add(acc);
    }
  }
  return out;
}

function designation(field: "model" | "article", given: string, record: StoredRegistryRecord): Signal {
  const label = field === "model" ? "Модель" : "Артикул";
  const want = compact(given);
  const grams = wordGrams(`${record.productName} ${record.madeBy ?? ""}`);
  if (want.length >= 2 && grams.has(want)) return sig(field, "confirm", `${label} «${given}» есть в названии записи`, { identifying: true });
  const recordModels = modelTokens(record.productName);
  if (field === "article") return sig(field, "neutral", `${label} «${given}» в записи не найден: в реестре артикулы обычно не указывают`);
  const longer = recordModels.find((t) => t.length > want.length && t.includes(want));
  if (longer) return sig(field, "neutral", `${label}: в записи более точное обозначение, чем у вас («${given}» входит в него), — это может быть другая модификация, проверьте`);
  if (recordModels.some((t) => t.length >= 3 && want.includes(t))) {
    return sig(field, "neutral", `${label}: у вас более точное обозначение «${given}», чем в записи, — это может быть другая модификация, проверьте`);
  }
  if (recordModels.length > 0) {
    return sig(field, "contradict", `${label} в записи отличается: в реестре «${recordModels.join("», «")}», у вас «${given}»`, { critical: true });
  }
  return sig(field, "neutral", `${label} «${given}» подтвердить нельзя: в названии записи модели нет`);
}

function standards(given: string, record: StoredRegistryRecord): Signal {
  const want = standardRefs(given);
  if (want.length === 0) return sig("madeBy", "neutral", `ТУ или ГОСТ «${given}» не удалось распознать`);
  const have = [...new Set([...standardRefs(record.madeBy ?? ""), ...standardRefs(record.productName)])];
  const shared = want.filter((w) => have.includes(w));
  if (shared.length > 0) {
    const specific = shared.some((s) => s.startsWith("ТУ"));
    return sig("madeBy", "confirm", `Совпадает документ, по которому изготовлен товар (${specific ? "ТУ" : "ГОСТ"} как в записи)`, { identifying: specific });
  }
  if (have.length === 0) return sig("madeBy", "neutral", "В записи ТУ или ГОСТ не указаны");
  const tuWant = want.filter((w) => w.startsWith("ТУ"));
  const tuHave = have.filter((h) => h.startsWith("ТУ"));
  if (tuWant.length && tuHave.length) return sig("madeBy", "contradict", "ТУ в записи другие, чем у вас", { critical: true });
  return sig("madeBy", "neutral", "Стандарты в записи и у вас разные — это не противоречие, ГОСТ у разных товаров бывает общим");
}

export function matchCandidate(card: ProductCard, record: StoredRegistryRecord): Matching {
  const signals: Signal[] = [];

  // ИНН производителя.
  const inn = own(card, "inn");
  let innConfirmed = false;
  if (inn) {
    if (!isInn(inn.value)) signals.push(sig("inn", "neutral", `ИНН «${inn.value}» записан неверно (нужно 10 или 12 цифр) — для сопоставления не использован`));
    else if (inn.value === record.inn) {
      innConfirmed = true;
      signals.push(sig("inn", "confirm", `ИНН производителя совпадает (${record.inn})`, { identifying: true }));
    } else {
      signals.push(sig("inn", "contradict", `ИНН производителя другой: в записи ${record.inn}, у вас ${inn.value}`, { critical: true }));
    }
  } else {
    signals.push(sig("inn", "neutral", "ИНН производителя не указан"));
  }

  // Название производителя.
  const manufacturer = own(card, "manufacturer");
  if (manufacturer) {
    if (sameOrg(manufacturer.value, record.enterpriseName)) {
      signals.push(sig("manufacturer", "confirm", `Производитель совпадает: ${record.enterpriseName}`, { identifying: true }));
    } else if (innConfirmed) {
      signals.push(sig("manufacturer", "neutral", `Название производителя записано иначе (в записи «${record.enterpriseName}»), ИНН совпал`));
    } else if (differentOrg(manufacturer.value, record.enterpriseName)) {
      signals.push(sig("manufacturer", "contradict", `Производитель другой: в записи «${record.enterpriseName}», у вас «${manufacturer.value}»`, { critical: true }));
    } else {
      signals.push(sig("manufacturer", "neutral", `Название производителя похоже, но не совпадает: в записи «${record.enterpriseName}» — проверьте`));
    }
  } else if (!inn) {
    signals.push(sig("manufacturer", "neutral", "Производитель не указан"));
  }

  const model = own(card, "model");
  if (model) signals.push(designation("model", model.value, record));
  const article = own(card, "article");
  if (article) signals.push(designation("article", article.value, record));
  if (!model && !article) signals.push(sig("model", "neutral", "Модель и артикул не указаны"));

  const made = own(card, "madeBy");
  if (made) signals.push(standards(made.value, record));

  const brand = own(card, "brand");
  if (brand) {
    const found = compact(`${record.productName} ${record.enterpriseName} ${record.madeBy ?? ""}`).includes(compact(brand.value));
    signals.push(found ? sig("brand", "confirm", `Торговая марка «${brand.value}» есть в записи`) : sig("brand", "neutral", `Торговая марка «${brand.value}» в записи не найдена`));
  }

  // Номер, который участник уже знает.
  const known = own(card, "registryNumber");
  if (known) {
    if (compact(known.value) === compact(record.registryNumber)) signals.push(sig("registryNumber", "confirm", "Номер совпадает с тем, что вы указали", { identifying: true }));
    else signals.push(sig("registryNumber", "contradict", `Вы указали номер ${known.value}, а это запись ${record.registryNumber}`, { critical: true }));
  }

  // Категория по ОКПД2 — из любого источника, но сама по себе товар не доказывает.
  const okpd = card.fields.okpd2;
  if (okpd) {
    const where = okpd.origin === "tz" ? "в закупке" : "у вас";
    const rel = okpd2Relation(okpd.value, record.okpd2);
    if (rel === "equal") signals.push(sig("okpd2", "confirm", `ОКПД2 совпадает (${record.okpd2})`));
    else if (rel === "inside" || rel === "contains") signals.push(sig("okpd2", "neutral", `ОКПД2 родственный: ${where} ${okpd.value}, в записи ${record.okpd2}`));
    else if (rel === "same_class") signals.push(sig("okpd2", "contradict", `ОКПД2 из той же группы, но другой: ${where} ${okpd.value}, в записи ${record.okpd2}`));
    else signals.push(sig("okpd2", "contradict", `ОКПД2 другой: ${where} ${okpd.value}, в записи ${record.okpd2} — категория товара не та`, { critical: true }));
  } else {
    signals.push(sig("okpd2", "neutral", "ОКПД2 товара не указан"));
  }

  // Размеры и параметры, которые назвал сам участник (не заказчик в ТЗ): единица та же, а число другое — это другой товар.
  const offered = [card.offeredName?.value, own(card, "model")?.value, own(card, "characteristics")?.value].filter(Boolean).join(" ");
  const mine = measuresIn(offered);
  const theirs = measuresIn(record.productName);
  for (const unit of new Set(mine.map((m) => m.unit))) {
    const a = mine.filter((m) => m.unit === unit);
    const b = theirs.filter((m) => m.unit === unit);
    if (a.length === 1 && b.length === 1) {
      if (a[0].value === b[0].value) signals.push(sig("measure", "confirm", `Параметр совпадает: ${b[0].value} ${unit}`));
      else signals.push(sig("measure", "contradict", `Параметр отличается: в записи ${b[0].value} ${unit}, у вас ${a[0].value} ${unit}`, { critical: true }));
    }
  }

  // Название — только для порядка и подсказки: совпадение слов товар не доказывает.
  const want = searchName(card);
  const ratio = termOverlap(nameTerms(want), nameTerms(record.productName));
  const nameExact = compact(want) === compact(record.productName);
  signals.push(
    sig(
      "name",
      "neutral",
      nameExact
        ? "Название совпадает полностью — но это не доказывает, что запись про ваш товар"
        : `Слова названия совпадают на ${Math.round(ratio * 100)}% — это не доказательство`,
    ),
  );

  const confirmed = signals.filter((s) => s.verdict === "confirm");
  const contradictions = signals.filter((s) => s.verdict === "contradict");
  const critical = contradictions.filter((s) => s.critical);
  const identity = [...new Set(confirmed.filter((s) => s.identifying).map((s) => s.field))];
  const producer = identity.includes("inn") || identity.includes("manufacturer");
  const specific = identity.includes("model") || identity.includes("article") || identity.includes("madeBy");
  const provenIdentity = (producer && specific) || (identity.includes("registryNumber") && producer);
  const startsWithHead = Boolean(nameTerms(want)[0]) && nameTerms(want)[0] === nameTerms(record.productName)[0];
  const rank = identity.length * 10 + (confirmed.length - identity.length) * 2 + ratio * 5 + (nameExact ? 3 : 0) + (startsWithHead ? 1 : 0) - critical.length * 30 - (contradictions.length - critical.length) * 5;

  return {
    signals,
    confirmed,
    neutral: signals.filter((s) => s.verdict === "neutral"),
    contradictions,
    critical,
    identity,
    provenIdentity: provenIdentity && contradictions.length === 0,
    hasIdentity: identity.length > 0,
    nameExact,
    rank,
  };
}
