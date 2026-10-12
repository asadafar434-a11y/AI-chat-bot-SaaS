import type { ProductCard } from "@/lib/product-card";
import { decide, type Decision } from "@/lib/registry-decision";
import { findCandidates } from "@/lib/registry-search";
import type { RegistryStore } from "@/lib/registry-store";
import type { RegistryDatasetInfo, RegistryKind } from "@/lib/registry-types";

export type ResolveOptions = {
  registry: RegistryKind;
  asOf: string;
  now?: Date;
  /** Уже найденная последняя выгрузка: чтобы при поиске по многим товарам не спрашивать её каждый раз. null — выгрузки нет. */
  dataset?: RegistryDatasetInfo | null;
  /** Сколько кандидатов вернуть на одну позицию. */
  limit?: number;
};

// Карточка товара → решение: последняя загруженная выгрузка, поиск кандидатов, правила принятия решения.
export async function resolveCard(store: RegistryStore, card: ProductCard, options: ResolveOptions): Promise<Decision> {
  const dataset = options.dataset !== undefined ? options.dataset : await store.latestDataset(options.registry);
  if (!dataset) return decide({ card, registry: options.registry, dataset: null, search: null, asOf: options.asOf, now: options.now });
  const search = await findCandidates(store, card, { registryKind: options.registry, limit: options.limit });
  return decide({ card, registry: options.registry, dataset, search, asOf: options.asOf, now: options.now });
}
