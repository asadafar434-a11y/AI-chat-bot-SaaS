import { useEffect, useMemo, useRef, useState } from 'react';
import { getRic, saveRic } from '@/lib/analytics-store';
import { computeRic, EMPTY_RIC, positionsFromDocuments, type RicData } from '@/lib/indicative-price';
import { errorMessage } from '@/lib/http-error';
import { titleOf } from '@/lib/purchase';
import { parseRubles } from '@/lib/rub-words';
import { usePurchases } from '@/lib/use-purchases';
import { AnalyticsHome } from '../components/Analytics';
import { RicPanel } from '../components/RicPanel';
import { ArrowLeft, BarChart2 } from '../lib/icons';
import { usePurchase } from './purchase-provider';

const SAVE_DELAY = 400;

// Список закупок раздела «Аналитика».
export function AnalyticsList({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const { purchases } = usePurchases();
  const items = useMemo(
    () =>
      purchases === null
        ? null
        : purchases.map((p) => ({ id: p.id, title: titleOf(p), price: p.price ?? '', kind: p.kind, sample: p.sample })),
    [purchases],
  );
  return <AnalyticsHome purchases={items} onOpen={onOpen} onNew={onNew} />;
}

// Расчёты по одной закупке. Сейчас — РИЦ: данные лежат в браузере (lib/analytics-store.ts), пересчитываются на каждый ввод.
export function PurchaseAnalytics({ onBack }: { onBack: () => void }) {
  const { purchase, documents } = usePurchase();
  const [data, setData] = useState<RicData | null>(null);
  const [source, setSource] = useState<{ doc: string; title: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<RicData | null>(null);
  const id = purchase.id;

  useEffect(() => {
    let alive = true;
    void getRic(id).then(
      (saved) => alive && setData(saved ?? EMPTY_RIC),
      (e) => {
        if (!alive) return;
        setData(EMPTY_RIC);
        setError(`Не удалось открыть сохранённый расчёт. ${errorMessage(e)}`);
      },
    );
    return () => {
      alive = false;
    };
  }, [id]);

  // Сохранение — через паузу после ввода; уходя с экрана, дописываем то, что не успело сохраниться.
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = latest.current;
    latest.current = null;
    if (next) void saveRic(id, next).catch((e) => setError(`Расчёт не удалось сохранить в браузере. ${errorMessage(e)}`));
  };
  useEffect(() => () => flush(), [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (next: RicData) => {
    setData(next);
    setError(null);
    latest.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY);
  };

  const nmck = parseRubles(purchase.price);
  const result = useMemo(() => (data ? computeRic(data, nmck, new Date()) : null), [data, nmck]);

  // Позиции и начальные цены за единицу — из бланка заказчика; уже введённые позиции и их цены-аналоги остаются.
  const importFromDocuments = () => {
    if (!data) return;
    const found = positionsFromDocuments(documents.map((d) => ({ name: d.name, text: d.text })));
    if (!found) {
      setNote('В документах закупки не нашёл бланк «Спецификация» или «Расчёт цены» с позициями. Добавьте позиции вручную.');
      return;
    }
    const have = new Map(data.positions.map((p) => [`${p.name.trim().toLowerCase()}|${p.unit.trim().toLowerCase()}`, p]));
    let added = 0;
    const positions = [...data.positions];
    for (const p of found.positions) {
      const key = `${p.name.trim().toLowerCase()}|${p.unit.trim().toLowerCase()}`;
      const existing = have.get(key);
      if (existing) {
        if (p.customerUnit !== undefined && existing.customerUnit === undefined) positions[positions.indexOf(existing)] = { ...existing, customerUnit: p.customerUnit };
      } else {
        positions.push(p);
        added++;
      }
    }
    setSource({ doc: found.doc, title: found.title });
    setNote(added > 0 ? `Добавлено позиций: ${added}.` : 'Все позиции из бланка уже в расчёте.');
    change({ ...data, positions, settings: found.vatRate !== null && data.positions.length === 0 ? { ...data.settings, vatRate: found.vatRate } : data.settings });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> Аналитика
        </button>
        <div className="flex items-start gap-2">
          <BarChart2 className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="break-words text-sm font-medium">{titleOf(purchase)}</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {nmck !== null ? `Начальная цена: ${purchase.price}` : 'Начальная цена в документах не найдена — сравнивать будет не с чем.'}
            </p>
          </div>
        </div>
      </div>
      {data && result ? (
        <RicPanel data={data} result={result} importSource={source} importNote={note} onImport={importFromDocuments} onChange={change} saveError={error} />
      ) : (
        <p className="text-[13px] text-muted-foreground">Открываю расчёт…</p>
      )}
    </div>
  );
}
