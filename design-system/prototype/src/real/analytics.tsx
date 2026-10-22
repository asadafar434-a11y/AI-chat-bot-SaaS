import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { assumptionLines, buildReport, reportFileName, reportHtml } from '@/lib/analytics-report';
import { buildSummary, type SectionId } from '@/lib/analytics-summary';
import { getRegister, getRic, saveRegister, saveRic } from '@/lib/analytics-store';
import { buildMatrix, summarize, type ManualResult } from '@/lib/check-matrix';
import { contractRisks, looksLikeContract } from '@/lib/contract-risks';
import { todayIso } from '@/lib/evidence-base';
import { checkPurchase } from '@/lib/evidence-match';
import { DEFAULT_DRIVERS, EMPTY_REGISTER, hypothesesFor, lawOf, placeOf, regionNote, typeOf, type RegisterData } from '@/lib/hidden-costs';
import { errorMessage, errorText } from '@/lib/http-error';
import { computeRic, EMPTY_RIC, parseAmount, positionsFromDocuments, type RicData } from '@/lib/indicative-price';
import { calcFor } from '@/lib/price-calc';
import { economics, econSettings } from '@/lib/economics';
import { estimateRisks } from '@/lib/risk-estimate';
import { deliveryCost, EMPTY_DELIVERY } from '@/lib/delivery-cost';
import { deliveryItems, fxItems } from '@/lib/fact-estimates';
import { EMPTY_FX, fxRisk, normalizeFx, type FxCode } from '@/lib/fx-risk';
import { findNmckCalculations } from '@/lib/nmck-check';
import { priceBadge } from '@/lib/price-badge';
import { detectRegistryDemand } from '@/lib/registry-demand';
import { titleOf } from '@/lib/purchase';
import { printHtml } from '@/lib/print-html';
import { scenarioRic } from '@/lib/ric-scenarios';
import { parseRubles } from '@/lib/rub-words';
import type { SearchContext } from '@/lib/search-queries';
import { saveFile } from '@/lib/save-file';
import { computeSensitivity } from '@/lib/sensitivity';
import { usePurchases } from '@/lib/use-purchases';
import { normalizeSearches } from '@/lib/web-search';
import { AnalyticsHome } from '../components/Analytics';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { AnalyticsSummary, type ReportBusy } from '../components/AnalyticsSummary';
import { CheckMatrix } from '../components/CheckMatrix';
import { Collapsible } from '../components/Collapsible';
import { ContractRisks } from '../components/ContractRisks';
import { Economics } from '../components/Economics';
import { RiskEstimates } from '../components/RiskEstimates';
import { NmckCheck } from '../components/NmckCheck';
import { RicPanel } from '../components/RicPanel';
import { RicScenarioPanel } from '../components/RicScenarioPanel';
import { ArrowLeft, BarChart2 } from '../lib/icons';
import { useProfile } from './analysis';
import { useFacts } from './hooks';
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

// Разбор одной закупки. Сверху — итог светофором, резюме и рекомендации (lib/analytics-summary.ts); ниже — закрытые разделы с подробностями: договор, оценка рисков, цена, расчёт заказчика, РИЦ.
// Полный отчёт — в Word или PDF (lib/analytics-report.ts). Введённое лежит в браузере (lib/analytics-store.ts).
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
  // Суммы по фактам: расстояние между регионами (место поставки из документов, адрес из профиля) и курсы ЦБ; тариф и сумму в валюте вводит участник (lib/delivery-cost.ts, lib/fx-risk.ts).
  const deliveryIn = (register.data ?? EMPTY_REGISTER).delivery ?? EMPTY_DELIVERY;
  const fxIn = (register.data ?? EMPTY_REGISTER).fx ?? EMPTY_FX;
  const delivery = useMemo(() => deliveryCost(regionInfo?.kind === 'other' ? regionInfo.company!.name : null, regionInfo?.kind === 'other' ? regionInfo.place.name : null, deliveryIn), [regionInfo, deliveryIn]);
  const fx = useMemo(() => fxRisk(fxIn), [fxIn]);
  const facts = useMemo(() => [...deliveryItems(delivery), ...fxItems(fx)], [delivery, fx]);
  const estimate = useMemo(() => estimateRisks({ price, risks, type, region: regionInfo, assumptions: (register.data ?? EMPTY_REGISTER).assumptions, facts }), [price, risks, type, regionInfo, register.data, facts]);
  // Расчёт цены: найденное в закупке и введённое на шаге «Цена» (читаем, не меняем); свои затраты из этого раздела — поверх, если шаг «Цена» пуст.
  const assumptions = (register.data ?? EMPTY_REGISTER).assumptions;
  const stepCalc = useMemo(() => calcFor(purchase), [purchase]);
  const calc = useMemo(() => {
    const e = (register.data ?? EMPTY_REGISTER).econ;
    return { ...stepCalc, costs: parseAmount(e.costs) ?? stepCalc.costs, extra: parseAmount(e.extra) ?? stepCalc.extra, taxPct: parseAmount(e.taxPct) ?? stepCalc.taxPct };
  }, [stepCalc, register.data]);
  const econ = useMemo(() => economics({ calc, estimate, settings: econSettings(assumptions), price }), [calc, estimate, assumptions, price]);
  const sens = useMemo(() => computeSensitivity((register.data ?? EMPTY_REGISTER).sens), [register.data]);
  const priceHint = purchase.tpPrice ? String(purchase.tpPrice) : nmck !== null ? String(nmck) : '0,00';

  // Проверка гипотез обычным поиском: в запрос идут только ключевые слова темы, год и регион места поставки из документов (lib/search-queries.ts). Результат сохраняется у закупки.
  const searchContext = useMemo<SearchContext>(() => ({ year: new Date().getFullYear(), place: place?.region.name ?? null }), [place]);
  const registerNow = useRef(register.data);
  registerNow.current = register.data;
  const searchHypothesis = async (id: string, query: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
      if (!res.ok) return await errorText(res, 'Поиск сейчас недоступен. Повторите позже.');
      const found = (await res.json()) as { query?: string; providerName?: string; at?: string; hits?: unknown };
      const record = normalizeSearches({ [id]: { query: found.query ?? query, at: found.at ?? new Date().toISOString(), provider: found.providerName ?? 'поиск', hits: found.hits } })[id];
      const latest = registerNow.current;
      if (!record || !latest) return 'Поиск вернул непонятный ответ. Повторите позже.';
      register.change({ ...latest, searches: { ...latest.searches, [id]: record } });
      return null;
    } catch (e) {
      return errorMessage(e);
    }
  };

  // Курсы ЦБ за год: сервер берёт общедоступный ряд на cbr.ru, в браузер приходят пары «дата — курс»; ряд сохраняется у закупки, сумма в валюте остаётся как её вписал участник.
  const loadFx = async (code: FxCode): Promise<string | null> => {
    try {
      const res = await fetch('/api/cbr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      if (!res.ok) return await errorText(res, 'Курсы сейчас недоступны. Повторите позже.');
      const found = (await res.json()) as { series?: unknown; at?: string };
      const latest = registerNow.current;
      if (!latest) return 'Расчёт ещё открывается. Повторите через секунду.';
      const current = latest.fx ?? EMPTY_FX;
      const next = normalizeFx({ ...current, code, series: found.series, fetchedAt: found.at ?? new Date().toISOString() });
      if (next.series.length < 2) return 'Банк России вернул слишком короткий ряд курсов. Повторите позже.';
      register.change({ ...latest, fx: next });
      return null;
    } catch (e) {
      return errorMessage(e);
    }
  };

  // Матрица из 27 проверок: требования заказчика сверяются с базой доказательств компании, остальное берётся из договора, расчёта цены и РИЦ (lib/check-matrix.ts).
  const factsState = useFacts();
  const evidence = useMemo(() => {
    if (!factsState.ready) return null;
    try {
      return checkPurchase(purchase, { facts: factsState.facts, profile }, todayIso());
    } catch {
      return null;
    }
  }, [purchase, factsState.ready, factsState.facts, profile]);
  const registryDemand = useMemo(() => detectRegistryDemand(documents), [documents]);
  const matrixData = (register.data ?? EMPTY_REGISTER).matrix;
  const matrixRows = useMemo(
    () =>
      buildMatrix({
        kind: purchase.kind,
        docs: plain,
        hasContract,
        risks,
        estimate,
        econ,
        badge,
        ric: result,
        nmck,
        smeOnly: calc.smeOnly,
        companySme: Boolean(profile.smeCategory?.trim()),
        registry: registryDemand,
        evidence,
        manual: Object.fromEntries(Object.entries(matrixData?.manual ?? {}).map(([k, v]) => [Number(k), v as ManualResult])),
        weights: Object.fromEntries(Object.entries(matrixData?.weights ?? {}).map(([k, v]) => [Number(k), v])),
      }),
    [purchase.kind, plain, hasContract, risks, estimate, econ, badge, result, nmck, calc.smeOnly, profile.smeCategory, registryDemand, evidence, matrixData],
  );
  const matrixSummary = useMemo(() => summarize(matrixRows), [matrixRows]);

  const title = titleOf(purchase);
  const summary = useMemo(
    () =>
      buildSummary({
        title,
        kind: purchase.kind,
        nmck,
        priceNote: purchase.tpPrice ? 'цена вашей заявки' : 'начальная цена',
        hasContract,
        risks,
        estimate,
        econ,
        badge,
        calcs,
        region: regionInfo,
        matrix: matrixSummary,
      }),
    [title, purchase.kind, purchase.tpPrice, nmck, hasContract, risks, estimate, econ, badge, calcs, regionInfo, matrixSummary],
  );
  const needCosts = !econ.ready && econ.reason === 'costs';
  // Разделы закрыты: сверху резюме. Исключения: без ваших затрат цену не назвать — раздел с затратами открыт сразу; итоговая диаграмма открыта, когда есть что рисовать.
  const [open, setOpen] = useState<Record<SectionId, boolean>>(() => ({ risks: false, estimate: false, economics: needCosts, nmck: false, ric: false, matrix: false, chart: econ.ready }));
  const toggle = (id: SectionId) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const goTo = (id: SectionId) => {
    setOpen((o) => ({ ...o, [id]: true }));
    setTimeout(() => document.getElementById(`analytics-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  // Полный отчёт собирается в браузере из того же, что на экране; на сервер ничего не уходит.
  const [busy, setBusy] = useState<ReportBusy>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const fullReport = () =>
    buildReport({
      title,
      subtitle: [purchase.customer, purchase.kind].filter(Boolean).join(' · '),
      date: new Date(),
      summary,
      hasContract,
      risks,
      estimate,
      econ,
      calcs,
      ric: result,
      badge,
      assumptions: assumptionLines(assumptions),
      ricScenario: data && result ? scenarioRic(data, result, purchase.subject ?? '', type) : null,
      matrix: { rows: matrixRows, summary: matrixSummary },
      searches: Object.entries((register.data ?? EMPTY_REGISTER).searches).flatMap(([id, record]) => {
        const h = hypotheses.find((x) => x.id === id);
        return h ? [{ title: h.title, record }] : [];
      }),
    });
  const downloadWord = async () => {
    setBusy('word');
    setReportError(null);
    try {
      const report = fullReport();
      const { reportDocx } = await import('@/lib/analytics-report-docx');
      saveFile(await reportDocx(report), reportFileName(report, 'docx'));
    } catch (e) {
      setReportError(`Не удалось собрать файл Word. ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };
  const downloadPdf = () => {
    setBusy('pdf');
    setReportError(null);
    try {
      printHtml(reportHtml(fullReport()));
    } catch (e) {
      setReportError(`Не удалось подготовить печать. ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const loading = <p className="text-[13px] text-muted-foreground">Открываю расчёт…</p>;
  const body = (id: SectionId): ReactNode => {
    switch (id) {
      case 'risks':
        return <ContractRisks embedded risks={risks} hasContract={hasContract} />;
      case 'estimate':
        return register.data ? (
          <RiskEstimates
            embedded
            result={estimate}
            price={price}
            priceNote={purchase.tpPrice ? 'цена вашей заявки' : 'начальная цена'}
            hypotheses={hypotheses}
            data={register.data}
            sens={sens}
            defaultDrivers={DEFAULT_DRIVERS[type]}
            priceHint={priceHint}
            onChange={register.change}
            searchContext={searchContext}
            onSearch={searchHypothesis}
            facts={{ delivery, fx, onLoadFx: loadFx }}
          />
        ) : (
          loading
        );
      case 'economics':
        return register.data ? (
          <Economics
            embedded
            result={econ}
            nmck={nmck}
            priceNote={purchase.tpPrice ? 'цене вашей заявки' : 'начальной цене'}
            fromStep={{ costs: stepCalc.costs, extra: stepCalc.extra, taxPct: stepCalc.taxPct }}
            targetMarginPct={assumptions.targetMarginPct}
            data={register.data}
            onChange={register.change}
          />
        ) : (
          loading
        );
      case 'nmck':
        return <NmckCheck embedded calcs={calcs} />;
      case 'matrix':
        return register.data ? (
          <CheckMatrix
            rows={matrixRows}
            summary={matrixSummary}
            data={register.data.matrix ?? {}}
            onChange={(next) => register.change({ ...register.data!, matrix: next.weights || next.manual ? next : undefined })}
          />
        ) : (
          loading
        );
      case 'chart':
        return <AnalyticsChart econ={econ} estimate={estimate} ric={result} matrix={matrixSummary} />;
      case 'ric':
        return data && result && badge ? (
          <div className="space-y-4">
            <RicScenarioPanel data={data} result={result} subject={purchase.subject ?? ''} type={type} onChange={ric.change} />
            <RicPanel embedded data={data} result={result} badge={badge} importSource={source} importNote={note} onImport={importFromDocuments} onChange={ric.change} saveError={null} />
          </div>
        ) : (
          loading
        );
    }
  };
  const saveError = ric.error ?? register.error;

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
      <AnalyticsSummary
        summary={summary}
        busy={busy}
        error={reportError}
        onWord={() => void downloadWord()}
        onPdf={downloadPdf}
        action={needCosts ? { label: 'Ввести затраты', onClick: () => goTo('economics') } : undefined}
      />
      {saveError && (
        <p role="alert" className="text-[12px] text-danger">
          {saveError}
        </p>
      )}
      <div className="space-y-2">
        <p className="px-1 text-[12px] font-medium text-muted-foreground">Подробный разбор</p>
        {summary.sections.map((s) => (
          <div key={s.id} id={`analytics-${s.id}`} className="scroll-mt-4">
            <Collapsible title={s.title} brief={s.brief} open={open[s.id]} onToggle={() => toggle(s.id)}>
              {body(s.id)}
            </Collapsible>
          </div>
        ))}
      </div>
    </div>
  );
}
