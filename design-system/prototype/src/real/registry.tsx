import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorText } from '@/lib/http-error';
import { cardHash, cardsFromGoods, type CardEdits, type ProductCard } from '@/lib/product-card';
import { STATUS_TEXT, statusOf, type Decision } from '@/lib/registry-decision';
import { asOfDate, registryCardsOf, registryDemandOf, requiredRegistryOf } from '@/lib/registry-fill';
import { EMPTY_REGISTRY_STATE, appendLog, autoPick, autofillCheck, cancelChoice, selectRecord, type RegistryState } from '@/lib/registry-log';
import { REGISTRY_SHORT, type RegistryKind } from '@/lib/registry-types';
import { RegistryNumbers, type DatasetBrief, type PositionView } from '../components/RegistryNumbers';
import { usePurchase } from './purchase-provider';

// Блок «Реестровые номера товаров» на настоящей закупке: карточки позиций — из ТП и документов, поиск — на сервере
// (бесплатный, ИИ не вызывается), выбор и журнал решений хранятся в закупке рядом с ТП.

type Found = { decision: Decision; hash: string };

export function RegistryBlock() {
  const { purchase, documents, update } = usePurchase();
  const docs = useMemo(() => documents.map((d) => ({ name: d.name, text: d.text })), [documents]);
  const state = purchase.registry ?? EMPTY_REGISTRY_STATE;

  // Последнее состояние держим и вне отрисовки: два действия подряд (правка и поиск) не должны затереть друг друга.
  const stateRef = useRef<RegistryState>(state);
  stateRef.current = state;
  const save = useCallback(
    (next: RegistryState) => {
      stateRef.current = next;
      update({ registry: next });
    },
    [update],
  );

  const demand = useMemo(() => registryDemandOf(purchase, docs), [purchase.tp?.goods, docs]); // eslint-disable-line react-hooks/exhaustive-deps
  const required = requiredRegistryOf(demand, state);
  const cards = useMemo(() => registryCardsOf(purchase, docs), [purchase.tp?.goods, state.cards, docs]); // eslint-disable-line react-hooks/exhaustive-deps
  const asOf = useMemo(() => asOfDate(purchase.deadline), [purchase.deadline]);

  const [found, setFound] = useState<Record<string, Found>>({});
  const [loading, setLoading] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [datasets, setDatasets] = useState<DatasetBrief[] | undefined>(undefined);
  const [datasetError, setDatasetError] = useState<string | null>(null);

  const request = useCallback(
    // Ищем сразу во всех загруженных реестрах; `registry` — только реестр, который назвала закупка (записи из него предпочтительны).
    async (registry: RegistryKind | null, items: ProductCard[]) => {
      const res = await fetch('/api/registry/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(registry && { registry }), asOf, items }),
      });
      if (!res.ok) throw new Error(await errorText(res, 'Не удалось выполнить поиск по реестру.'));
      return (await res.json()) as { datasets: DatasetBrief[]; results: { key: string; decision: Decision }[] };
    },
    [asOf],
  );

  // Сведения о выгрузках реестров — один лёгкий запрос без позиций.
  useEffect(() => {
    if (cards.length === 0) return;
    let alive = true;
    request(required, []).then(
      (r) => alive && (setDatasets(r.datasets), setDatasetError(null)),
      (e: Error) => alive && setDatasetError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [required, cards.length, request]);

  // Поиск и подбор идут сами во всех закупках с товарами (решение владельца 14.10.2026: «почему не ищет сразу?»): лучший номер подставляется
  // и помечается «проверьте»; если номер не нужен, участник нажимает «Номер не нужен» — отказ запоминается.
  const search = useCallback(
    async (targets: ProductCard[], options: { quiet?: boolean } = {}) => {
      if (targets.length === 0) return;
      const keys = targets.map((c) => c.key);
      setLoading((prev) => new Set([...prev, ...keys]));
      setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !keys.includes(k))));
      try {
        const r = await request(required, targets);
        setDatasets(r.datasets);
        setDatasetError(null);
        const byKey = new Map(targets.map((c) => [c.key, c]));
        setFound((prev) => ({ ...prev, ...Object.fromEntries(r.results.map((x) => [x.key, { decision: x.decision, hash: cardHash(byKey.get(x.key)!) }])) }));
        let next = stateRef.current;
        const now = new Date();
        for (const x of r.results) {
          // Автоматический поиск при открытии блока в журнал не пишется: иначе при каждом заходе на шаг в нём росли бы одинаковые строки.
          if (!options.quiet) {
            next = appendLog(next, {
              at: now.toISOString(),
              positionKey: x.key,
              event: 'search',
              text: `Поиск в реестрах ${x.decision.search.searched.map((k) => REGISTRY_SHORT[k]).join(', ') || 'нет загруженных'}: ${STATUS_TEXT[x.decision.status]}${x.decision.candidates.length ? ` (записей: ${x.decision.candidates.length})` : ''}.`,
              status: x.decision.status,
            });
          }
          const card = byKey.get(x.key);
          if (card) next = autoPick(next, { card, decision: x.decision, now });
        }
        if (next !== stateRef.current) save(next);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Не удалось выполнить поиск по реестру.';
        setErrors((prev) => ({ ...prev, ...Object.fromEntries(keys.map((k) => [k, message])) }));
      } finally {
        setLoading((prev) => new Set([...prev].filter((k) => !keys.includes(k))));
      }
    },
    [required, request, save],
  );

  // Поиск бесплатный и быстрый, поэтому идёт сам: при открытии блока и после правки товара. Каждую карточку — один раз за открытие.
  const attempted = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (demand.unsupported || cards.length === 0) return;
    const targets = cards.filter((c) => {
      const id = `${c.key}:${cardHash(c)}`;
      return !attempted.current.has(id) && !loading.has(c.key) && found[c.key]?.hash !== cardHash(c);
    });
    if (targets.length === 0) return;
    for (const c of targets) attempted.current.add(`${c.key}:${cardHash(c)}`);
    // Порциями: первые позиции показываются сразу, не дожидаясь всего списка.
    // Одинаковые названия — рядом, чтобы сервер искал каждое один раз внутри порции.
    const ordered = [...targets].sort((a, b) => a.name.localeCompare(b.name));
    const chunks: ProductCard[][] = [];
    for (let i = 0; i < ordered.length; i += 5) chunks.push(ordered.slice(i, i + 5));
    const next = { value: 0 };
    const worker = async () => {
      while (next.value < chunks.length) await search(chunks[next.value++], { quiet: true });
    };
    void Promise.all([worker(), worker(), worker()]);
  }, [demand.unsupported, cards, found, loading, search]);

  const positions: PositionView[] = cards.map((card) => {
    const entry = found[card.key];
    const decision = entry && entry.hash === cardHash(card) ? entry.decision : null;
    const choice = state.choices[card.key];
    return {
      card,
      decision,
      error: errors[card.key] ?? null,
      choice,
      status: loading.has(card.key) ? 'searching' : statusOf(demand, decision),
      autofill: autofillCheck({ choice, card, requiredRegistry: required, asOf }),
      cardChanged: Boolean(choice && choice.cardHash !== cardHash(card)),
      skipped: state.skipped?.[card.key] === cardHash(card),
    };
  });

  return (
    <RegistryNumbers
      demand={demand}
      required={required}
      datasets={datasets}
      datasetError={datasetError}
      positions={positions}
      searching={loading.size > 0}
      onSearch={(keys) => void search(cards.filter((c) => keys.includes(c.key)))}
      onSaveAndSearch={(key, edits: CardEdits) => {
        const base = stateRef.current;
        const next: RegistryState = appendLog(
          { ...base, cards: { ...base.cards, [key]: edits } },
          { at: new Date().toISOString(), positionKey: key, event: 'card_changed', text: 'Сведения о товаре обновлены участником.' },
        );
        save(next);
        const goods = purchase.tp?.goods ?? [];
        const fresh = cardsFromGoods(goods, docs, next.cards).find((c) => c.key === key);
        if (fresh) void search([fresh]);
      }}
      onSelect={(key, registryNumber, note) => {
        const entry = found[key];
        const card = cards.find((c) => c.key === key);
        if (!card) return;
        if (!entry) {
          setErrors((prev) => ({ ...prev, [key]: 'Варианты ещё ищутся — подождите секунду и повторите.' }));
          return;
        }
        const result = selectRecord(stateRef.current, { card, decision: entry.decision, registryNumber, note });
        if (!result.ok) {
          setErrors((prev) => ({ ...prev, [key]: result.reason }));
          return;
        }
        setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)));
        save(result.state);
      }}
      onCancel={(key) => save(cancelChoice(stateRef.current, key))}
      log={state.log}
    />
  );
}
