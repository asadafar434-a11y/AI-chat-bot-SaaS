import { useEffect, useMemo, useRef, useState } from 'react';
import { assumptionLines, buildReport, reportFileName, reportHtml } from '@/lib/analytics-report';
import { buildSummary, findingsOf, rubles, searchFinding, type SummaryInput } from '@/lib/analytics-summary';
import { purchaseCost } from '@/lib/position-prices';
import { findServiceVolume } from '@/lib/service-volume';
import { findCustomerQuotes, quotesFinding } from '@/lib/customer-quotes';
import { auctionStepNote } from '@/lib/price-terms';
import { rateTender } from '@/lib/tender-rating';
import { getRegister, getRic, saveRegister, saveRic } from '@/lib/analytics-store';
import { buildMatrix, summarize, type ManualResult } from '@/lib/check-matrix';
import { contractRisks, looksLikeContract } from '@/lib/contract-risks';
import { todayIso } from '@/lib/evidence-base';
import { checkPurchase } from '@/lib/evidence-match';
import { EMPTY_REGISTER, hypothesesFor, lawOf, placeOf, regionNote, typeOf, type RegisterData } from '@/lib/hidden-costs';
import { errorMessage, errorText } from '@/lib/http-error';
import { computeRic, EMPTY_RIC, parseAmount, type RicData } from '@/lib/indicative-price';
import { calcFor } from '@/lib/price-calc';
import { economics, econSettings } from '@/lib/economics';
import { estimateRisks } from '@/lib/risk-estimate';
import { deliveryCost, EMPTY_DELIVERY } from '@/lib/delivery-cost';
import { deliveryItems, fxItems } from '@/lib/fact-estimates';
import { riskFactItems } from '@/lib/risk-facts';
import { EMPTY_FX, fxRisk } from '@/lib/fx-risk';
import { findNmckCalculations } from '@/lib/nmck-check';
import { priceBadge } from '@/lib/price-badge';
import { detectRegistryDemand } from '@/lib/registry-demand';
import { titleOf } from '@/lib/purchase';
import { printHtml } from '@/lib/print-html';
import { scenarioRic } from '@/lib/ric-scenarios';
import { parseRubles } from '@/lib/rub-words';
import { searchTopics, type SearchContext } from '@/lib/search-queries';
import { saveFile } from '@/lib/save-file';
import { usePurchases } from '@/lib/use-purchases';
import { normalizeSearches } from '@/lib/web-search';
import { AnalyticsHome } from '../components/Analytics';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { AnalyticsFindings } from '../components/AnalyticsFindings';
import { AnalyticsSummary, type ReportBusy } from '../components/AnalyticsSummary';
import { Collapsible } from '../components/Collapsible';
import { CrewCostCard } from '../components/CrewCost';
import { CustomerQuotesCard } from '../components/CustomerQuotes';
import { PositionPricesCard } from '../components/PositionPrices';
import { ServiceVolumeCard } from '../components/ServiceVolume';
import { PriceBadgeChip } from '../components/PriceBadgeChip';
import { TenderRating } from '../components/TenderRating';
import { ArrowLeft, BarChart2 } from '../lib/icons';
import { useProfile } from './analysis';
import { useMarketBase } from './market';
import { AnalyticsIntake } from './analytics-intake';
import { CounterpartyBlock } from './counterparty';
import { useCrewCost } from './rates';
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
export function AnalyticsList({ onOpen }: { onOpen: (id: string) => void }) {
  const { purchases } = usePurchases();
  const [uploading, setUploading] = useState(false);
  const items = useMemo(
    () =>
      purchases === null
        ? null
        : purchases.map((p) => ({ id: p.id, title: titleOf(p), price: p.price ?? '', kind: p.kind, sample: p.sample })),
    [purchases],
  );
  return (
    <>
      <AnalyticsHome purchases={items} onOpen={onOpen} onUpload={() => setUploading(true)} extra={<CounterpartyBlock />} />
      <AnalyticsIntake
        open={uploading}
        onClose={() => setUploading(false)}
        onCreated={(id) => {
          setUploading(false);
          onOpen(id);
        }}
      />
    </>
  );
}

// Разбор одной закупки (решение владельца 22.10.2026: «аналитика — чтобы лишних инпутов не было, всё под капотом»). На экране: итог светофором, главные риски в рублях, отчёт и рекомендации, итоговая диаграмма и внизу
// подпись из 4–5 строк «что нашла аналитика» (lib/analytics-summary.ts). Полей ввода нет: расчёты по договору, рискам, цене, РИЦ и 27 проверкам идут внутри и лежат в отчёте Word и PDF (lib/analytics-report.ts);
// затраты участник вводит один раз — на шаге «Цена». Панели для ручного ввода (договор, расходы, расчёт заказчика, РИЦ, матрица) остались в коде, на экране их нет.
export function PurchaseAnalytics({ onBack, onAnalyze, onCosts }: { onBack: () => void; onAnalyze?: () => void; onCosts?: () => void }) {
  const { purchase, documents } = usePurchase();
  const profile = useProfile();
  const ric = usePersisted<RicData>(purchase.id, getRic, saveRic, EMPTY_RIC, 'расчёт РИЦ');
  const register = usePersisted<RegisterData>(purchase.id, getRegister, saveRegister, EMPTY_REGISTER, 'скрытые затраты');
  const data = ric.data;

  const nmck = parseRubles(purchase.price);
  // Тексты документов читаются один раз на закупку, а не на каждую набранную цифру.
  const plain = useMemo(() => documents.map((d) => ({ name: d.name, text: d.text })), [documents]);
  const place = useMemo(() => placeOf(plain), [plain]);
  // Позиции — из бланка заказчика, цены-аналоги — из общей базы цен: под капотом, в закупку не пишется (real/market.ts).
  const market = useMarketBase(data, plain, place?.region.name ?? null, purchase.id);
  const base = market.data;
  const result = useMemo(() => (base ? computeRic(base, nmck, new Date()) : null), [base, nmck]);
  const badge = useMemo(() => (base && result ? priceBadge(result, base) : null), [base, result]);
  const calcs = useMemo(() => findNmckCalculations(plain), [plain]);
  const risks = useMemo(() => contractRisks(plain), [plain]);
  const hasContract = useMemo(() => plain.some(looksLikeContract), [plain]);
  const type = useMemo(() => typeOf(purchase.subject ?? '', purchase.kind), [purchase.subject, purchase.kind]);
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
  const riskFacts = (register.data ?? EMPTY_REGISTER).riskFacts;
  const facts = useMemo(
    () => [...deliveryItems(delivery), ...fxItems(fx), ...riskFactItems(riskFacts ?? {}, Object.fromEntries(hypotheses.map((h) => [h.id, h.title])))],
    [delivery, fx, riskFacts, hypotheses],
  );
  const estimate = useMemo(() => estimateRisks({ price, risks, type, region: regionInfo, assumptions: (register.data ?? EMPTY_REGISTER).assumptions, facts }), [price, risks, type, regionInfo, register.data, facts]);
  // Расчёт цены: найденное в закупке и введённое на шаге «Цена» (читаем, не меняем); свои затраты из этого раздела — поверх, если шаг «Цена» пуст.
  const assumptions = (register.data ?? EMPTY_REGISTER).assumptions;
  const stepCalc = useMemo(() => calcFor(purchase), [purchase]);
  // Объём закупки из таблицы документов (детодни, человеко-часы, м², рейсы…): показывается, когда найден; себестоимость единицы вписывают на шаге «Цена».
  const volume = useMemo(() => findServiceVolume(plain), [plain]);
  // Состав исполнения из документов (должности, техника, срок) и найденные в интернете зарплаты и аренда → себестоимость за месяц, за срок и за единицу объёма (real/rates.ts, lib/crew-cost.ts); нет состава — блока нет.
  const crew = useCrewCost(purchase.id, plain, place?.region.name ?? null, volume?.total ?? null);
  // Предложения поставщиков из обоснования начальной цены у заказчика (ТКП №1…№3) и шаг аукциона: читает код из документов, без ИИ; показываются, когда найдены.
  const quotes = useMemo(() => findCustomerQuotes(plain), [plain]);
  const auctionStep = useMemo(() => auctionStepNote(plain, nmck), [plain, nmck]);
  // Закупка товара по найденным закупочным ценам: цена × количество по каждой позиции (lib/position-prices.ts). Начальная цена «без НДС» — без НДС и считаем.
  const autoCost = useMemo(
    () => (market.prices ? purchaseCost(market.prices, { withVat: !/без\s+НДС/i.test(purchase.price ?? ''), vatRate: data?.settings.vatRate ?? 22 }) : null),
    [market.prices, purchase.price, data],
  );
  const crewTotal = crew.cost?.complete ? crew.cost.termTotal : null;
  const calc = useMemo(() => {
    const e = (register.data ?? EMPTY_REGISTER).econ;
    // Себестоимость: вписанная участником важнее всего; нет её — из шага «Цена»; нет и там — по найденным закупочным ценам и количествам (владелец, 23.10.2026: «чтобы ты сразу считал, когда есть цена и количество»).
    // Себестоимость по составу работ считается для расчёта, только когда ставки найдены по всем должностям и технике: неполная сумма цену не определяет.
    return { ...stepCalc, costs: parseAmount(e.costs) ?? stepCalc.costs ?? autoCost?.total ?? crewTotal ?? null, extra: parseAmount(e.extra) ?? stepCalc.extra, taxPct: parseAmount(e.taxPct) ?? stepCalc.taxPct };
  }, [stepCalc, register.data, autoCost, crewTotal]);
  const costsAuto = Boolean(autoCost?.total ?? crewTotal) && !parseAmount((register.data ?? EMPTY_REGISTER).econ.costs) && !stepCalc.costs;
  const econ = useMemo(() => economics({ calc, estimate, settings: econSettings(assumptions), price }), [calc, estimate, assumptions, price]);

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

  // «Проверить поиском» сразу по всем темам закупки, которые ещё не искали: по одной, с паузой (поиск не любит частые запросы); на первой ошибке останавливаемся и показываем её.
  const topics = useMemo(() => searchTopics(hypotheses.map((h) => h.id), searchContext), [hypotheses, searchContext]);
  const searches = (register.data ?? EMPTY_REGISTER).searches;
  const pendingTopics = topics.filter(([id]) => !searches[id]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchDone, setSearchDone] = useState(0);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchAll = async () => {
    const list = [...pendingTopics];
    setSearchBusy(true);
    setSearchError(null);
    setSearchDone(0);
    let done = 0;
    for (const [id, query] of list) {
      const problem = await searchHypothesis(id, query);
      if (problem) {
        setSearchError(problem);
        break;
      }
      setSearchDone(++done);
      if (done < list.length) await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    setSearchBusy(false);
  };
  const searchStat = {
    topics: topics.length,
    checked: topics.length - pendingTopics.length,
    links: topics.reduce((sum, [id]) => sum + (searches[id]?.hits.length ?? 0), 0),
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
  const summaryInput = useMemo<SummaryInput>(
    () => ({
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
  const summary = useMemo(() => buildSummary(summaryInput), [summaryInput]);
  const findings = useMemo(() => findingsOf(summaryInput), [summaryInput]);
  // Подпись внизу: строка о предложениях поставщиков — сразу после «Цена и рынок», закупочные цены — в конце.
  const lines = useMemo(() => {
    const out = [...findings];
    if (quotes) {
      const at = out.findIndex((l) => l.label === 'Цена и рынок');
      out.splice(at < 0 ? out.length : at + 1, 0, quotesFinding(quotes, nmck));
    }
    return [...out, market.finding];
  }, [findings, quotes, nmck, market.finding]);
  const chartSection = summary.sections.find((s) => s.id === 'chart');
  // Рейтинг привлекательности: балл по шести факторам из уже посчитанного (lib/tender-rating.ts), без ИИ.
  const rating = useMemo(
    () => rateTender({ econ, estimate, hasContract, badge, matrix: matrixRows, targetMarginPct: assumptions.targetMarginPct, priceNote: market.specNote }),
    [econ, estimate, hasContract, badge, matrixRows, assumptions.targetMarginPct, market.specNote],
  );
  const needCosts = !econ.ready && econ.reason === 'costs';
  // Загрузка уже пройдена: с плашки итога — дальше, на шаг «Анализ». Если ИИ закупку ещё не разбирал, на шаге будет кнопка разбора.
  const analyzed = Object.values(purchase.requirements).some((list) => list.length > 0);
  // Итоговая диаграмма открыта, когда есть что рисовать (затраты введены на шаге «Цена»).
  const [chartOpen, setChartOpen] = useState(econ.ready);

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
      ricScenario: base && result ? scenarioRic(base, result, purchase.subject ?? '', type) : null,
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

  const saveError = ric.error ?? register.error;

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
              {nmck !== null ? `Начальная цена: ${purchase.price}` : 'Начальной цены в документах нет'}
            </p>
            {badge && (
              <div className="mt-2">
                <PriceBadgeChip badge={badge} market={market.lines} />
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Товары и найденные закупочные цены — сразу под названием закупки: это то, что участник ищет первым (владелец, 23.10.2026: «где товар, цена его?»). Цен нет — блока нет. */}
      {volume && <ServiceVolumeCard volume={volume} nmck={nmck} costs={stepCalc.costs ?? null} />}
      {crew.need && crew.cost && crew.state !== 'none' && <CrewCostCard need={crew.need} cost={crew.cost} state={crew.state} saved={crew.saved} error={crew.error} perUnitLabel={volume ? volume.unitOf : undefined} />}
      {market.prices && <PositionPricesCard prices={market.prices} total={market.positionsTotal} />}
      {quotes && <CustomerQuotesCard quotes={quotes} nmck={nmck} step={auctionStep} />}
      <TenderRating rating={rating} />
      <AnalyticsSummary
        summary={summary}
        busy={busy}
        error={reportError}
        onWord={() => void downloadWord()}
        onPdf={downloadPdf}
        action={(needCosts || costsAuto) && onCosts ? { label: costsAuto ? 'Уточнить себестоимость на шаге «Цена» →' : 'Ввести себестоимость на шаге «Цена» →', onClick: onCosts } : undefined}
        costNote={
          costsAuto && autoCost?.total
            ? `Себестоимость посчитана сама по найденным закупочным ценам: ${rubles(autoCost.total)} (${autoCost.lines.length} ${autoCost.lines.length === 1 ? 'позиция' : 'позиций'}, ${/без\s+НДС/i.test(purchase.price ?? '') ? 'без НДС' : 'с НДС'}; при нескольких ценах — медиана, при двух — большая). Доставка, работа и ваши расходы сюда не входят: впишите свои на шаге «Цена».`
            : costsAuto && crewTotal
              ? `Себестоимость посчитана сама по составу работ: зарплаты и аренда техники из интернета с взносами за ${crew.cost?.months} мес. — ${rubles(crewTotal)}. Накладные расходы, прибыль и расходные материалы сюда не входят: впишите свои на шаге «Цена».`
              : undefined
        }
        analyze={onAnalyze ? { label: analyzed ? 'Перейти к анализу →' : 'Анализировать документы →', onClick: onAnalyze } : undefined}
      />
      {saveError && (
        <p role="alert" className="text-[12px] text-danger">
          {saveError}
        </p>
      )}

      {chartSection && (
        <Collapsible title={chartSection.title} brief={chartSection.brief} tone={chartSection.tone} open={chartOpen} onToggle={() => setChartOpen((v) => !v)}>
          <AnalyticsChart econ={econ} estimate={estimate} ric={result} matrix={matrixSummary} />
        </Collapsible>
      )}

      <AnalyticsFindings
        lines={lines}
        search={{
          line: searchFinding(searchStat),
          pending: pendingTopics.length,
          busy: searchBusy,
          done: searchDone,
          error: searchError,
          onRun: () => void searchAll(),
        }}
      />
    </div>
  );
}
