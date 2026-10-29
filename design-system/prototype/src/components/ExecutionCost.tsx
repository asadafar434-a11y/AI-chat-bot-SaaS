import type { ReactNode } from 'react';
import type { CustomerPriceTable } from '@/lib/customer-price-table';
import { rubText, signedRub, type ExecutionCost } from '@/lib/execution-cost';
import { termsLine, type ExecutionTerms } from '@/lib/execution-terms';
import type { PriceSheet, PriceSource } from '@/lib/price-sheet';
import { CertaintyBadge } from './Certainty';
import { Badge, Card, HelpTip } from './ui';

// «Сколько стоит исполнение» (29.10.2026, владелец: «вот так должно считать и показывать» — образец другой модели по мебели для Братского дома-интерната):
// 1. минимум, средняя и максимум; 2. самые дорогие позиции; 3. сколько реально стоит исполнение — что требует договор и резерв на доставку и сборку;
// 4. по какой цене участвовать — остаток при начальной цене и при снижении; 5. цены в интернете против цен заказчика; технические риски (если найдены); вывод и что подтвердить.
// Считает код (lib/execution-cost.ts, execution-terms.ts, price-compare.ts), без ИИ. Нет таблицы обоснования по позициям — нет блока.

export type SpecIssue = { position: string; text: string; host: string | null; url: string | null };

const TONE = { good: 'success', warn: 'warn', danger: 'danger' } as const;
const restClass = (n: number | null) => (n === null ? 'text-muted-foreground' : n >= 0 ? 'text-success' : 'text-danger');
const num = 'px-2 py-1.5 text-right font-mono';
const head = 'px-2 pb-1.5 text-right text-[11px] font-medium text-muted-foreground';
const headLeft = 'px-2 pb-1.5 text-left text-[11px] font-medium text-muted-foreground';
const note = 'text-[12px] text-muted-foreground';
const SHEET_ROWS = 10;
// Три цены вверху блока — всегда цветные плашки (владелец, 29.10.2026: «делай акцентно всегда этот блок в плашке цветно»): минимум зелёным, средняя — главным голубым цветом, максимум — жёлтым. Цвета — токены темы, читаются в обеих темах.
const PRICE_TONE = {
  min: { box: 'border-success/30 bg-success/10', label: 'text-success', value: 'text-success' },
  mean: { box: 'border-primary bg-primary', label: 'text-primary-foreground', value: 'text-primary-foreground' },
  max: { box: 'border-warn/40 bg-warn-surface', label: 'text-warn-foreground', value: 'text-warn-foreground' },
} as const;
const pctPlain = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %`;
const range = (from: number, to: number) => (Math.round(from) === Math.round(to) ? rubText(from) : `${rubText(from)} – ${rubText(to)}`);
const SOURCE_LABEL: Record<PriceSource, string> = { internet: 'интернет', document: 'документ заказчика', analog: 'аналог из интернета', none: 'нет цены' };
const SOURCE_CLASS: Record<PriceSource, string> = { internet: 'text-success', document: 'text-foreground', analog: 'text-warn-foreground', none: 'text-danger' };
const GENITIVE: Record<string, string> = { разгрузка: 'разгрузки', 'подъём на этаж': 'подъёма на этаж', сборка: 'сборки', установка: 'установки', монтаж: 'монтажа' };
const joinAnd = (list: string[]) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} и ${list[list.length - 1]}`);

function Section({ n, title, children }: { n?: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <p className="text-[13px] font-semibold">{n ? `${n}. ${title}` : title}</p>
      {children}
    </section>
  );
}

export function ExecutionCostCard({
  cost,
  table,
  sheet = null,
  webNote,
  terms = null,
  specIssues = [],
  dropped = 0,
}: {
  cost: ExecutionCost;
  table: CustomerPriceTable;
  /** Цены по позициям: что нашлось в интернете, что в документах и что пошло в расчёт (lib/price-sheet.ts). */
  sheet?: PriceSheet | null;
  webNote?: string;
  terms?: ExecutionTerms | null;
  specIssues?: SpecIssue[];
  /** Сколько цен из интернета отброшено: в 3 раза ниже или выше цен поставщиков заказчика — не тот товар. */
  dropped?: number;
}) {
  // Источники цен в расчёте (lib/price-sheet.ts): интернет, документы заказчика, аналоги, без цены. Нет разбивки — таблица целиком из документов заказчика.
  const src = table.internet ?? null;
  const web = src && src.found + src.analogs > 0 ? src : null;
  // Цены в интернете найдены не по всем позициям: сумма неполная, и «остаток при НМЦ» по ней был бы выдуман (на скриншоте владельца: +1,6 млн ₽ по двум позициям из двадцати).
  const incomplete = Boolean(src && src.missing > 0);
  const rowsPriced = src ? src.found + src.analogs + src.filled : cost.rows;
  const rowsTotal = src ? src.found + src.analogs + src.filled + src.missing : cost.rows;
  const pct = cost.logisticsPct;
  const [low, base] = cost.scenarios;
  const contract = terms ? termsLine(terms) : null;
  const services = ['доставки', ...(terms?.duties ?? ['сборка']).map((d) => GENITIVE[d] ?? d)];
  const confirm = cost.top.slice(0, 3).map((g) => `${g.label.toLowerCase().startsWith('все ') ? g.label.toLowerCase() : g.label} (${g.qty.toLocaleString('ru-RU')} шт.)`);
  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[15px] font-bold">Сколько стоит исполнение</p>
        <CertaintyBadge kind={web ? 'unchecked' : 'confirmed'} />
        <HelpTip
          align="start"
          content="Для каждой позиции берётся цена из интернета, если она нашлась и похожа на правду; нет — цена из документов заказчика (таблица его поставщиков); нет и её — ближайшие аналоги; иначе позиция «без цены». Источник виден у каждой позиции в разделе 5. Считает программа, без ИИ; цены из интернета проверены по цитате со страницы."
        />
      </div>

      {/* Откуда цены в разделах 1–4: без этой строки не понять, что это цены поставщиков из документов заказчика, а не из интернета (владелец 29.10.2026: «откуда ты их взял?!»). */}
      <p className="break-words text-[12px] text-muted-foreground">
        {src
          ? `Цены разделов 1–4: из интернета — ${src.found} поз., из документов заказчика — ${src.filled}, по аналогам — ${src.analogs}, без цены — ${src.missing}. Источник каждой позиции — в разделе 5.`
          : `Цены разделов 1–4 — из документов заказчика: таблица его поставщиков в файле «${table.doc}».`}
      </p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge tone={TONE[cost.verdict.tone]} wrap>
          {cost.verdict.title}
        </Badge>
        {incomplete && (
          <span className="text-[13px] text-muted-foreground">
            цены найдены по {rowsPriced} из {rowsTotal} позиций — итоги ниже неполные, остаток при НМЦ не считается
          </span>
        )}
        {!incomplete && low.atNmck !== null && base.atNmck !== null && (
          <span className="text-[13px]">
            при НМЦ: экономный <span className={`font-mono font-semibold ${restClass(low.atNmck)}`}>{signedRub(low.atNmck)}</span> · базовый{' '}
            <span className={`font-mono font-semibold ${restClass(base.atNmck)}`}>{signedRub(base.atNmck)}</span>
          </span>
        )}
      </div>

      <Section n={1} title="Минимальная, средняя и максимальная цена">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {[
            { label: 'Минимум по позициям', value: cost.min, hint: 'самая низкая цена каждой позиции', tone: 'min' as const },
            { label: cost.matchesNmck ? 'Средняя = НМЦ' : 'Средняя', value: cost.mean, hint: src ? 'по выбранным ценам' : 'по расчёту заказчика', tone: 'mean' as const },
            { label: 'Максимум по позициям', value: cost.max, hint: 'самая высокая цена каждой позиции', tone: 'max' as const },
          ].map((k) => (
            <div key={k.label} className={`rounded-lg border p-3 ${PRICE_TONE[k.tone].box}`}>
              <p className={`text-[12px] font-medium ${PRICE_TONE[k.tone].label}`}>{k.label}</p>
              <p className={`font-mono text-2xl font-bold tracking-tight ${PRICE_TONE[k.tone].value}`}>{rubText(k.value)}</p>
              <p className={`text-[12px] ${PRICE_TONE[k.tone].label}`}>{k.hint}</p>
            </div>
          ))}
        </div>
        <p className={note}>Минимум и максимум — сценарии: по каждой позиции самая низкая или самая высокая цена из предложений, а не один поставщик на весь комплект.</p>
      </Section>

      <Section n={2} title="Самые дорогие позиции">
        <table className="w-full table-fixed text-[12px]">
          <thead>
            <tr>
              <th className={headLeft}>Позиция</th>
              <th className={`${head} w-12`}>Кол-во</th>
              <th className={`${head} hidden w-28 sm:table-cell`}>Минимум</th>
              <th className={`${head} w-24`}>Средняя</th>
              <th className={`${head} hidden w-28 sm:table-cell`}>Максимум</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {cost.top.map((g) => (
              <tr key={g.label}>
                <td className="break-words px-2 py-1.5">{g.label}</td>
                <td className={num}>{g.qty.toLocaleString('ru-RU')}</td>
                <td className={`${num} hidden sm:table-cell`}>{rubText(g.min)}</td>
                <td className={`${num} font-semibold`}>{rubText(g.mean)}</td>
                <td className={`${num} hidden sm:table-cell`}>{rubText(g.max)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={note}>
          На них приходится {pctPlain(Math.round(cost.topShare * 100))} стоимости заказа. Заранее получите подтверждённые цены на: {joinAnd(confirm)}.
        </p>
      </Section>

      <Section n={3} title="Сколько реально может стоить исполнение">
        {contract && <p className="text-[13px]">{contract}</p>}
        <p className={note}>
          В таблице цен доставка и сборка не выделены — добавлен резерв {pct.low.toLocaleString('ru-RU')} / {pct.base.toLocaleString('ru-RU')} / {pct.high.toLocaleString('ru-RU')} % от товаров. Это оценка, а не
          предложения перевозчиков.
        </p>
        <table className="w-full table-fixed text-[12px]">
          <thead>
            <tr>
              <th className={`${headLeft} w-24`}>Сценарий</th>
              <th className={head}>Товары</th>
              <th className={head}>Резерв на доставку и сборку</th>
              <th className={head}>Всего расходов</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {cost.scenarios.map((s) => (
              <tr key={s.key}>
                <td className="px-2 py-1.5">{s.label}</td>
                <td className={num}>{rubText(s.goods)}</td>
                <td className={num}>{rubText(s.logistics)}</td>
                <td className={`${num} font-semibold`}>{rubText(s.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={note}>Если цены поставщиков уже включают доставку и сборку, резерв второй раз прибавлять не нужно.</p>
      </Section>

      {incomplete ? (
        <Section n={4} title="По какой цене участвовать">
          <p className={note}>
            Остаток при НМЦ и при снижении не считается, пока цены не найдены по всем позициям ({rowsPriced} из {rowsTotal}). Запросите у поставщиков цены на остальные позиции или загрузите документы с таблицей цен заказчика.
          </p>
        </Section>
      ) : (
      <Section n={4} title="По какой цене участвовать">
        <table className="w-full table-fixed text-[12px]">
          <thead>
            <tr>
              <th className={`${headLeft} w-24`}>Сценарий</th>
              <th className={head}>Остаток при НМЦ</th>
              <th className={head}>При −{cost.bidDropPct} %{cost.bid !== null ? ` (${rubText(cost.bid)})` : ''}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {cost.scenarios.map((s) => (
              <tr key={s.key}>
                <td className="px-2 py-1.5">{s.label}</td>
                <td className={`${num} font-semibold ${restClass(s.atNmck)}`}>{s.atNmck === null ? '—' : signedRub(s.atNmck)}</td>
                <td className={`${num} ${restClass(s.atBid)}`}>{s.atBid === null ? '—' : signedRub(s.atBid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={note}>Остаток — до налогов, административных и прочих расходов бизнеса.</p>
      </Section>
      )}

      <Section n={5} title="Цены по позициям">
        {sheet && sheet.rows.length > 0 ? (
          <>
            <table className="w-full table-fixed text-[12px]">
              <thead>
                <tr>
                  <th className={headLeft}>Позиция</th>
                  <th className={`${head} hidden w-32 sm:table-cell`}>У заказчика, за ед.</th>
                  <th className={`${head} w-32`}>В интернете, за ед.</th>
                  <th className={`${head} w-28`}>В расчёте</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sheet.rows.slice(0, SHEET_ROWS).map((r) => (
                  <tr key={r.id}>
                    <td className="break-words px-2 py-1.5">
                      {r.name}
                      {r.qty !== null && <span className="font-normal text-muted-foreground"> · {r.qty.toLocaleString('ru-RU')} шт.</span>}
                      {r.web && (
                        <span className="block text-[11px] text-muted-foreground">
                          {r.web.kind === 'analog' ? `аналог: другие размеры · ${r.web.n}` : `цен: ${r.web.n}`}
                          {r.web.host && ` · ${r.web.host}`}
                          {r.webDiffers && <span className="font-medium text-warn-foreground"> · цена в интернете сильно отличается — проверьте, тот ли товар; взята цена из документа</span>}
                        </span>
                      )}
                    </td>
                    <td className={`${num} hidden sm:table-cell`}>{r.doc ? range(r.doc.min, r.doc.mean) : '—'}</td>
                    <td className={num}>{r.web ? range(r.web.from, r.web.to) : '—'}</td>
                    <td className={`px-2 py-1.5 text-right text-[11px] font-medium ${SOURCE_CLASS[r.used]}`}>{SOURCE_LABEL[r.used]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={note}>
              Позиций: {sheet.rows.length}
              {sheet.rows.length > SHEET_ROWS && ` · показаны ${SHEET_ROWS} самых дорогих`}
              {dropped > 0 && ` · отброшено цен: ${dropped} — в 3 раза ниже или выше, чем у заказчика, похоже, не тот товар`}
            </p>
          </>
        ) : (
          <p className={note}>{webNote ? `Цены в интернете: ${webNote}` : 'Цены в интернете ещё не найдены.'}</p>
        )}
      </Section>

      {specIssues.length > 0 && (
        <Section title="Технические риски">
          <ul className="space-y-1 text-[13px]">
            {specIssues.map((s) => (
              <li key={`${s.position}-${s.text}`} className="break-words">
                <span className="font-semibold">{s.position}:</span> {s.text}
                {s.host && (
                  <>
                    {' '}
                    ·{' '}
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:no-underline">
                        {s.host}
                      </a>
                    ) : (
                      s.host
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Вывод">
        <p className="text-[13px]">{cost.verdict.text}</p>
        <p className="text-[13px]">
          Перед участием подтвердите цены и сроки на {joinAnd(confirm)}, а также стоимость {joinAnd(services)}.
        </p>
      </Section>

      <p className="break-words text-[12px] text-muted-foreground">
        {table.doc} · позиций {cost.rows}
        {table.fromPicture && ' · таблица распознана со снимка, каждая строка сверена арифметикой'}
        {cost.unchecked > 0 && ` · у ${cost.unchecked} поз. цены поставщиков не прочитались — взята средняя`}
      </p>
    </Card>
  );
}
