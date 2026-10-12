import type { ProductCard } from "@/lib/product-card";
import { decide, type Decision } from "@/lib/registry-decision";
import { findCandidates, mergeSearches } from "@/lib/registry-search";
import type { RegistryStore } from "@/lib/registry-store";
import { REGISTRY_KINDS, type RegistryDatasetInfo, type RegistryKind } from "@/lib/registry-types";

export type ResolveOptions = {
  /** Реестр, который назвала закупка: записи из него предпочтительны, но поиск идёт сразу во всех загруженных реестрах. */
  registry?: RegistryKind | null;
  asOf: string;
  now?: Date;
  /** Уже найденные последние выгрузки (по одной на реестр): чтобы при поиске по многим товарам не спрашивать их каждый раз. [] — выгрузок нет. */
  datasets?: RegistryDatasetInfo[];
  /** Сколько кандидатов вернуть на одну позицию. */
  limit?: number;
};

/** Последние выгрузки всех реестров, которые есть в системе; реестры без выгрузки пропускаются. */
export async function latestDatasets(store: RegistryStore): Promise<RegistryDatasetInfo[]> {
  const found: RegistryDatasetInfo[] = [];
  for (const kind of REGISTRY_KINDS) {
    const dataset = await store.latestDataset(kind);
    if (dataset) found.push(dataset);
  }
  return found;
}

// Карточка товара → решение: последние выгрузки всех реестров, поиск кандидатов в каждом, один общий список, правила принятия решения.
// Участник реестр не выбирает: запись с одним номером в двух реестрах — одна строка с пометкой, в каких реестрах она есть.
export async function resolveCard(store: RegistryStore, card: ProductCard, options: ResolveOptions): Promise<Decision> {
  const datasets = options.datasets ?? (await latestDatasets(store));
  const demanded = options.registry ?? null;
  if (datasets.length === 0) return decide({ card, demanded, datasets: [], search: null, asOf: options.asOf, now: options.now });
  const searches = [];
  for (const dataset of datasets) searches.push(await findCandidates(store, card, { registryKind: dataset.registryKind, limit: options.limit }));
  const search = mergeSearches(searches, { demanded, limit: options.limit });
  return decide({ card, demanded, datasets, search, asOf: options.asOf, now: options.now });
}
