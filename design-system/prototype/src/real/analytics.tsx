import { useEffect, useMemo, useRef, useState } from 'react';
import { getRegister, getRic, saveRegister, saveRic } from '@/lib/analytics-store';
import { contractRisks, looksLikeContract } from '@/lib/contract-risks';
import { DEFAULT_DRIVERS, EMPTY_REGISTER, hypothesesFor, lawOf, placeOf, regionNote, typeOf, type RegisterData } from '@/lib/hidden-costs';
import { errorMessage } from '@/lib/http-error';
import { computeRic, EMPTY_RIC, positionsFromDocuments, type RicData } from '@/lib/indicative-price';
import { estimateRisks } from '@/lib/risk-estimate';
import { findNmckCalculations } from '@/lib/nmck-check';
import { priceBadge } from '@/lib/price-badge';
import { titleOf } from '@/lib/purchase';
import { parseRubles } from '@/lib/rub-words';
import { computeSensitivity } from '@/lib/sensitivity';
import { usePurchases } from '@/lib/use-purchases';
import { AnalyticsHome } from '../components/Analytics';
import { ContractRisks } from '../components/ContractRisks';
import { RiskEstimates } from '../components/RiskEstimates';
import { NmckCheck } from '../components/NmckCheck';
import { RicPanel } from '../components/RicPanel';
import { ArrowLeft, BarChart2 } from '../lib/icons';
import { useProfile } from './analysis';
import { usePurchase } from './purchase-provider';

const SAVE_DELAY = 400;

// Данные раздела по закупке, которые лежат в браузере: читаются при открытии, сохраняются через паузу после ввода, а уходя с экрана — сразу.
function usePersisted<T>(id: string, load: (id: string) => Promise<T | undefined>, save: (id: string, value: T) => Promise<void>, empty: T, what: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<T | null>(null);

  useEffect(() => {
    let alive = true;
    void load(id).then(
      (saved) => alive && setData(saved ?? empty),
      (e) => {
        if (!alive) return;
        setData(empty);
        setError(`Не удалось открыть сохранённое: ${what}. ${errorMessage(e)}`);
      },
    );
    return () => {
      alive = false;
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = latest.current;
    latest.current = null;
    if (next) void save(id, next).catch((e) => setError(`Не удалось сохранить в браузере: ${what}. ${errorMessage(e)}`));
  };
  useEffect(() => () => flush(), [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (next: T) => {
    setData(next);
    setError(null);
    latest.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY);
  };
  return { data, change, error };
}

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

// Разбор одной закупки. Сверху — найденное в документах (договор, расчёт цены заказчика), ниже — гипотезы о скрытых затратах и РИЦ по вашим ценам. Введённое лежит в браузере (lib/analytics-store.ts).
export function PurchaseAnalytics({ onBack }: { onBack: () => void }) {
  const { purchase, documents } = usePurchase();
  const profile = useProfile();
  const ric = usePersisted<RicData>(purchase.id, getRic, saveRic, EMPTY_RIC, 'расчёт РИЦ');
  const register = usePersisted<RegisterData>(purchase.id, getRegister, saveRegister, EMPTY_REGISTER, 'скрытые затраты');
  const [source, setSource] = useState<{ doc: string; title: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const data = ric.data;

  const nmck = parseRubles(purchase.price);
  const result = useMemo(() => (data ? computeRic(data, nmck, new Date()) : null), [data, nmck]);
  const badge = useMemo(() => (data && result ? priceBadge(result, data) : null), [data, result]);
  // Тексты документов читаются один раз на закупку, а не на каждую набранную цифру.
  const plain = useMemo(() => documents.map((d) => ({ name: d.name, text: d.text })), [documents]);
  const calcs = useMemo(() => findNmckCalculations(plain), [plain]);
  const risks = useMemo(() => contractRisks(plain), [plain]);
  const hasContract = useMemo(() => plain.some(looksLikeContract), [plain]);
  const type = useMemo(() => typeOf(purchase.subject ?? '', purchase.kind), [purchase.subject, purchase.kind]);
  const place = useMemo(() => placeOf(plain), [plain]);
  const law = lawOf(purchase.kind);
  const regionInfo = useMemo(() => regionNote(place, `${profile.legalAddress} ${profile.postalAddress}`), [place, profile.legalAddress, profile.postalAddress]);
  const hypotheses = useMemo(() => hypothesesFor(type, regionInfo, law), [type, regionInfo, law]);
  // Цена, от которой считаются риски: цена вашей заявки, а пока её нет — начальная цена.
  const price = purchase.tpPrice ? purchase.tpPrice : nmck;
  const estimate = useMemo(() => estimateRisks({ price, risks, type, region: regionInfo, assumptions: (register.data ?? EMPTY_REGISTER).assumptions }), [price, risks, type, regionInfo, register.data]);
  const sens = useMemo(() => computeSensitivity((register.data ?? EMPTY_REGISTER).sens), [register.data]);
  const priceHint = purchase.tpPrice ? String(purchase.tpPrice) : nmck !== null ? String(nmck) : '0,00';

  // Позиции и начальные цены за единицу — из бланка заказчика; уже введённые позиции и их цены-аналоги остаются.
  const importFromDocuments = () => {
    if (!data) return;
    const found = positionsFromDocuments(plain);
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
    ric.change({ ...data, positions, settings: found.vatRate !== null && data.positions.length === 0 ? { ...data.settings, vatRate: found.vatRate } : data.settings });
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
      <ContractRisks risks={risks} hasContract={hasContract} />
      {register.data && (
        <RiskEstimates
          result={estimate}
          price={price}
          priceNote={purchase.tpPrice ? 'цена вашей заявки' : 'начальная цена'}
          hypotheses={hypotheses}
          data={register.data}
          sens={sens}
          defaultDrivers={DEFAULT_DRIVERS[type]}
          priceHint={priceHint}
          onChange={register.change}
        />
      )}
      <NmckCheck calcs={calcs} />
      {data && result && badge ? (
        <RicPanel data={data} result={result} badge={badge} importSource={source} importNote={note} onImport={importFromDocuments} onChange={ric.change} saveError={ric.error ?? register.error} />
      ) : (
        <p className="text-[13px] text-muted-foreground">Открываю расчёт…</p>
      )}
    </div>
  );
}
