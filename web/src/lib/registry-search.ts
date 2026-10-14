import { searchName, type ProductCard } from "@/lib/product-card";
import { matchCandidate, type Matching } from "@/lib/registry-match";
import type { RegistryStore, RegistrySearchQuery } from "@/lib/registry-store";
import { compact, isInn, nameBroadenings, nameWords, orgWords, standardRefs } from "@/lib/registry-text";
import { REGISTRY_KINDS, REGISTRY_SHORT, type RegistryKind, type StoredRegistryRecord } from "@/lib/registry-types";

// Поиск кандидатов в реестре. Идёт по уровням, от самого надёжного идентификатора к названию:
//   1. известный реестровый номер;  2. производитель (ИНН или название) + модель, артикул или ТУ;
//   3. производитель + ОКПД2 или название;  4. модель, артикул или ТУ без производителя;
//   5. название + ОКПД2;  6. только название.
// Поиск по названию и ОКПД2 только находит кандидатов — выбирать по нему нельзя (registry-decision.ts).
// Если участник назвал производителя, а у производителя ничего не нашлось, широкий поиск по названию НЕ запускается:
// чужие записи с похожим названием — не его товар, и «не найдено» не должно превращаться в «противоречие».

export type SearchTier = "number" | "producer_designation" | "producer_category" | "designation" | "name_okpd2" | "name";

export const TIER_TEXT: Record<SearchTier, string> = {
  number: "по известному номеру",
  producer_designation: "по производителю и модели, артикулу или ТУ",
  producer_category: "по производителю и категории или названию",
  designation: "по модели, артикулу или ТУ",
  name_okpd2: "по названию и ОКПД2",
  name: "по названию",
};

export type Candidate = {
  record: StoredRegistryRecord;
  tiers: SearchTier[];
  matching: Matching;
  /** Реестры, в которых есть эта запись (номер): запись с одним номером в двух реестрах — одна строка. */
  registries: RegistryKind[];
  /** Чем реестры расходятся в сведениях об этом номере; пусто — ни чем. */
  disagreements?: string[];
};

export type CandidateSearch = {
  candidates: Candidate[];
  /** Что искали: для объяснения «запись не найдена». */
  filters: string[];
  tierTotals: Partial<Record<SearchTier, number>>;
  /** Сколько записей подошло в самом широком использованном запросе (может быть больше, чем показано). */
  matchedTotal: number;
  shown: number;
  truncated: boolean;
  /** Записей с похожим названием и ОКПД2 у ДРУГИХ производителей — только справка, кандидатами они не считаются. */
  similarElsewhere: number | null;
  /** Точного названия в реестре нет: искали по общему («куртки для самбо» → «куртки»). wanted — что искали сначала, used — по чему нашли. */
  broadened: { wanted: string; used: string } | null;
};

export type SearchOptions = { registryKind: RegistryKind; limit?: number; fetchLimit?: number };

const MAX_WORDS = 4;

export async function findCandidates(store: RegistryStore, card: ProductCard, options: SearchOptions): Promise<CandidateSearch> {
  const kind = options.registryKind;
  const limit = options.limit ?? 30;
  const fetchLimit = options.fetchLimit ?? 200;
  const found = new Map<string, { record: StoredRegistryRecord; tiers: Set<SearchTier> }>();
  const tierTotals: Partial<Record<SearchTier, number>> = {};
  const filters: string[] = [`Реестр: ${REGISTRY_SHORT[kind]}`];
  let matchedTotal = 0;
  let broadened: CandidateSearch["broadened"] = null;

  const run = async (tier: SearchTier, query: Omit<RegistrySearchQuery, "registryKind" | "limit">) => {
    const result = await store.search({ registryKind: kind, limit: fetchLimit, ...query });
    tierTotals[tier] = Math.max(tierTotals[tier] ?? 0, result.total);
    matchedTotal = Math.max(matchedTotal, result.total);
    for (const record of result.records) {
      const have = found.get(record.registryNumber);
      if (have) have.tiers.add(tier);
      else found.set(record.registryNumber, { record, tiers: new Set([tier]) });
    }
    return result.total;
  };

  const own = (field: keyof ProductCard["fields"]) => {
    const f = card.fields[field];
    return f && f.origin !== "tz" && f.value ? f.value : null;
  };
  const innValue = own("inn");
  const inn = innValue && isInn(innValue) ? innValue : null;
  const manufacturer = own("manufacturer");
  const enterpriseWords = manufacturer ? orgWords(manufacturer).filter((w) => w.length >= 3) : [];
  const producerGiven = Boolean(inn || enterpriseWords.length);
  const modelValue = own("model");
  const articleValue = own("article");
  const madeBy = own("madeBy");
  const refs = madeBy ? standardRefs(madeBy) : [];
  const designations = [modelValue, articleValue].filter((v): v is string => !!v).map(compact).filter((v) => v.length >= 3);
  const okpd = card.fields.okpd2?.value ?? null;
  const words = nameWords(searchName(card)).slice(0, MAX_WORDS);
  const knownNumber = own("registryNumber");

  const okpdLevels = (): string[] => {
    if (!okpd) return [];
    const digits = okpd.replace(/\D/g, "");
    return [...new Set([digits, digits.slice(0, 6), digits.slice(0, 4)].filter((d) => d.length >= 4))];
  };

  // 1. Известный номер.
  if (knownNumber) {
    filters.push(`номер ${knownNumber}`);
    const record = await store.getByNumber(kind, knownNumber.replace(/\s+/g, ""));
    tierTotals.number = record ? 1 : 0;
    if (record) found.set(record.registryNumber, { record, tiers: new Set<SearchTier>(["number"]) });
  }

  const producer: Omit<RegistrySearchQuery, "registryKind" | "limit"> = inn ? { inn } : { enterpriseWords };
  if (producerGiven) filters.push(inn ? `ИНН производителя ${inn}` : `производитель «${manufacturer}»`);

  // 2–3. Производитель назван: ищем только у него.
  if (producerGiven) {
    for (const designation of designations) {
      await run("producer_designation", { ...producer, modelRef: designation });
    }
    for (const ref of refs) {
      await run("producer_designation", { ...producer, standardRef: ref });
    }
    if (designations.length) filters.push(`модель или артикул ${[modelValue, articleValue].filter(Boolean).join(" / ")}`);
    if (refs.length) filters.push(`ТУ или ГОСТ ${madeBy}`);
    if (found.size === 0 || (!designations.length && !refs.length)) {
      // У назвавшего производителя записей немного: берём код и его ветку (6 знаков) вместе; более широкая группа — только если пусто.
      let hit = false;
      const levels = okpdLevels();
      const narrow = levels.filter((d) => d.length >= 6);
      for (const digits of narrow.length ? narrow : levels) {
        if (await run("producer_category", { ...producer, okpd2Prefix: digits })) hit = true;
      }
      if (!hit) {
        for (const digits of levels.filter((d) => !narrow.includes(d))) {
          if (await run("producer_category", { ...producer, okpd2Prefix: digits })) {
            hit = true;
            break;
          }
        }
      }
      if (hit) filters.push(`ОКПД2 ${okpd} (и ветка ${narrow[narrow.length - 1] ?? levels[levels.length - 1]})`);
      if (!hit && words.length) {
        for (let n = words.length; n >= 1; n--) {
          if (await run("producer_category", { ...producer, nameWords: words.slice(0, n) })) {
            filters.push(`слова названия: ${words.slice(0, n).join(", ")}`);
            hit = true;
            break;
          }
        }
      }
      if (!hit && !found.size) {
        filters.push(`ОКПД2 ${okpd ?? "не указан"}; слова названия: ${words.join(", ") || "нет"}`);
      }
    }
  } else {
    // 4. Производитель не назван, но есть модель, артикул или ТУ.
    const level = okpdLevels();
    for (const designation of designations) {
      const q: Omit<RegistrySearchQuery, "registryKind" | "limit"> = { modelRef: designation, ...(level.length ? { okpd2Prefix: level[level.length - 1] } : words.length ? { nameWords: words.slice(0, 2) } : {}) };
      await run("designation", q);
    }
    for (const ref of refs) {
      await run("designation", { standardRef: ref, ...(level.length ? { okpd2Prefix: level[level.length - 1] } : {}) });
    }
    if (designations.length || refs.length) filters.push(`модель, артикул или ТУ: ${[modelValue, articleValue, madeBy].filter(Boolean).join(" / ")}`);

    // 5–6. Только то, что известно из закупки: название и ОКПД2. Кандидаты, но не основание для выбора.
    if (found.size === 0 || designations.length === 0) {
      let hit = false;
      if (words.length) {
        // От точного названия к общему: нет «куртки для самбо» — берём просто «куртки» (nameBroadenings).
        const steps = nameBroadenings(words);
        const noteBroader = (used: string[]) => {
          if (used.length < words.length) broadened = { wanted: words.join(" "), used: used.join(" ") };
        };
        for (const digits of okpdLevels()) {
          for (const used of steps) {
            if (await run("name_okpd2", { okpd2Prefix: digits, nameWords: used })) {
              filters.push(`ОКПД2 ${okpd}${digits.length < (okpd ?? "").replace(/\D/g, "").length ? ` (ветка ${digits})` : ""}; слова названия: ${used.join(", ")}`);
              noteBroader(used);
              hit = true;
              break;
            }
          }
          if (hit) break;
        }
        if (!hit) {
          for (const used of steps) {
            if (await run("name", { nameWords: used })) {
              filters.push(`слова названия: ${used.join(", ")} (без ОКПД2)${used.length < words.length ? " — точного названия в реестре нет, взято общее" : ""}`);
              noteBroader(used);
              hit = true;
              break;
            }
          }
        }
      }
      if (!hit && found.size === 0) filters.push(`ОКПД2 ${okpd ?? "не указан"}; слова названия: ${words.join(", ") || "нет"}`);
    }
  }

  // Справка для «не найдено» у назвавшего производителя: есть ли такое же название у других.
  let similarElsewhere: number | null = null;
  if (producerGiven && found.size === 0 && words.length) {
    const digits = okpdLevels()[1] ?? okpdLevels()[0];
    const probe = await store.search({ registryKind: kind, limit: 1, nameWords: words.slice(0, 2), ...(digits ? { okpd2Prefix: digits } : {}) });
    similarElsewhere = probe.total;
  }

  const candidates = [...found.values()]
    .map(({ record, tiers }): Candidate => ({ record, tiers: [...tiers], matching: matchCandidate(card, record), registries: [record.registryKind] }))
    .sort((a, b) => b.matching.rank - a.matching.rank || a.record.productName.length - b.record.productName.length || a.record.registryNumber.localeCompare(b.record.registryNumber));
  const shown = candidates.slice(0, limit);
  return { candidates: shown, filters, tierTotals, matchedTotal: Math.max(matchedTotal, found.size), shown: shown.length, truncated: candidates.length > limit || matchedTotal > fetchLimit, similarElsewhere, broadened };
}

/**
 * Результаты поиска по нескольким реестрам → один список. Запись с одним номером в разных реестрах — одна строка с пометкой, в каких
 * реестрах она есть; описание берётся из реестра, который требует закупка (если он назван и запись в нём есть), иначе из первого по списку
 * REGISTRY_KINDS. Если реестры расходятся в сведениях об одном номере (производитель, название, срок), строка остаётся одна, но с предупреждением.
 */
export function mergeSearches(searches: CandidateSearch[], options: { demanded?: RegistryKind | null; limit?: number } = {}): CandidateSearch {
  if (searches.length === 1 && !options.demanded) return searches[0];
  const rankOf = (kind: RegistryKind) => (kind === options.demanded ? -1 : REGISTRY_KINDS.indexOf(kind));
  const byNumber = new Map<string, Candidate>();
  for (const search of searches) {
    for (const candidate of search.candidates) {
      const number = candidate.record.registryNumber;
      const have = byNumber.get(number);
      if (!have) {
        byNumber.set(number, { ...candidate, registries: [...candidate.registries] });
        continue;
      }
      const registries = [...new Set([...have.registries, ...candidate.registries])].sort((a, b) => rankOf(a) - rankOf(b));
      const tiers = [...new Set([...have.tiers, ...candidate.tiers])];
      const better = rankOf(candidate.record.registryKind) < rankOf(have.record.registryKind);
      const [primary, other] = better ? [candidate, have] : [have, candidate];
      const a = primary.record;
      const b = other.record;
      const disagree: string[] = [];
      if (a.inn !== b.inn) disagree.push("производитель");
      if (a.productName.trim().toLowerCase() !== b.productName.trim().toLowerCase()) disagree.push("название");
      if (a.validUntil !== b.validUntil) disagree.push("срок действия");
      // Уровень и выписка есть только в части выгрузок: у записи, описанной по другому реестру, они берутся оттуда, где есть.
      const flags = { ...a.flags };
      for (const key of ["radioLevel", "extractUrl", "catalogUrl"] as const) if (!flags[key] && b.flags[key]) flags[key] = b.flags[key];
      byNumber.set(number, {
        ...primary,
        record: { ...a, flags },
        tiers,
        registries,
        disagreements: [...new Set([...(have.disagreements ?? []), ...(candidate.disagreements ?? []), ...disagree.map((what) => `${what}: в ${REGISTRY_SHORT[b.registryKind]} иначе, чем в ${REGISTRY_SHORT[a.registryKind]}`)])],
      });
    }
  }
  const sum = (pick: (s: CandidateSearch) => number | null | undefined): number | null => {
    const values = searches.map(pick).filter((v): v is number => typeof v === "number");
    return values.length ? values.reduce((x, y) => x + y, 0) : null;
  };
  const tierTotals: Partial<Record<SearchTier, number>> = {};
  for (const search of searches) {
    for (const [tier, total] of Object.entries(search.tierTotals) as [SearchTier, number][]) {
      // Номер найден, если нашёл хоть один реестр: сумма, а не максимум.
      tierTotals[tier] = tier === "number" ? (tierTotals[tier] ?? 0) + total : Math.max(tierTotals[tier] ?? 0, total);
    }
  }
  const searched = [...new Set(searches.flatMap((s) => s.filters.filter((f) => f.startsWith("Реестр: ")).map((f) => f.slice("Реестр: ".length))))];
  const rest = [...new Set(searches.flatMap((s) => s.filters.filter((f) => !f.startsWith("Реестр: "))))];
  const all = [...byNumber.values()].sort((a, b) => b.matching.rank - a.matching.rank || a.record.registryNumber.localeCompare(b.record.registryNumber));
  const limit = options.limit ?? 30;
  const shown = all.slice(0, limit);
  return {
    candidates: shown,
    filters: [`${searched.length > 1 ? "Реестры" : "Реестр"}: ${searched.join(", ")}`, ...rest],
    tierTotals,
    matchedTotal: Math.max(...searches.map((s) => s.matchedTotal), all.length),
    shown: shown.length,
    truncated: all.length > limit || searches.some((s) => s.truncated),
    similarElsewhere: sum((s) => s.similarElsewhere),
    broadened: searches.find((s) => s.broadened)?.broadened ?? null,
  };
}
