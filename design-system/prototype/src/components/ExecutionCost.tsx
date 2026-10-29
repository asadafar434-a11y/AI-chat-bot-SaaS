import type { ReactNode } from 'react';
import type { CustomerPriceTable } from '@/lib/customer-price-table';
import { rubText, signedRub, type ExecutionCost } from '@/lib/execution-cost';
import { termsLine, type ExecutionTerms } from '@/lib/execution-terms';
import { IMPLAUSIBLE_FACTOR, type PriceCompare } from '@/lib/price-compare';
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
const COMPARE_ROWS = 8;
const pctText = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %`;
const pctPlain = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %`;
const range = (from: number, to: number) => (Math.round(from) === Math.round(to) ? rubText(from) : `${rubText(from)} – ${rubText(to)}`);
const WHERE = { below: 'дешевле всех у заказчика', inside: 'в диапазоне заказчика', above: 'дороже всех у заказчика' } as const;
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
  compare = null,
  webNote,
  terms = null,
  specIssues = [],
  dropped = 0,
}: {
  cost: ExecutionCost;
  table: CustomerPriceTable;
  compare?: PriceCompare | null;
  webNote?: string;
  terms?: ExecutionTerms | null;
  specIssues?: SpecIssue[];
  /** Сколько цен из интернета отброшено: в 3 раза ниже или выше цен поставщиков заказчика — не тот товар. */
  dropped?: number;
}) {
  const web = table.internet;
  const pct = cost.logisticsPct;
  const [low, base] = cost.scenarios;
  const contract = terms ? termsLine(terms) : null;
  const services = ['доставки', ...(terms?.duties ?? ['сборка']).map((d) => GENITIVE[d] ?? d)];
  const confirm = cost.top.slice(0, 3).map((g) => `${g.label.toLowerCase().startsWith('все ') ? g.label.toLowerCase() : g.label} (${g.qty.toLocaleString('ru-RU')} шт.)`);
  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[15px] font-bold">Сколько стоит исполнение</p>
        <CertaintyBadge kind="confirmed" />
        <HelpTip
          align="start"
          content={web ? "По закупочным ценам, найденным в интернете по позициям закупки: минимум, средняя (медиана) и максимум; количество — из документов. Считает программа, без ИИ; каждая цена проверена по цитате со страницы поставщика. Если у заказчика в документах есть таблица цен поставщиков, расчёт идёт по ней." : "По таблице обоснования начальной цены заказчика: цены поставщиков по каждой позиции. Считает программа, без ИИ; каждая строка таблицы сверена арифметикой (средняя и итог)."}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge tone={TONE[cost.verdict.tone]} wrap>
          {cost.verdict.title}
        </Badge>
        {low.atNmck !== null && base.atNmck !== null && (
          <span className="text-[13px]">
            при НМЦ: экономный <span className={`font-mono font-semibold ${restClass(low.atNmck)}`}>{signedRub(low.atNmck)}</span> · базовый{' '}
            <span className={`font-mono font-semibold ${restClass(base.atNmck)}`}>{signedRub(base.atNmck)}</span>
          </span>
        )}
      </div>

      <Section n={1} title="Минимальная, средняя и максимальная цена">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {[
            { label: 'Минимум по позициям', value: cost.min, hint: 'самая низкая цена каждой позиции' },
            { label: cost.matchesNmck ? 'Средняя = НМЦ' : 'Средняя', value: cost.mean, hint: web ? 'медиана найденных цен' : 'по расчёту заказчика' },
            { label: 'Максимум по позициям', value: cost.max, hint: 'самая высокая цена каждой позиции' },
          ].map((k) => (
            <div key={k.label} className="rounded-lg border border-border p-3">
              <p className="text-[12px] text-muted-foreground">{k.label}</p>
              <p className="font-mono text-xl font-bold tracking-tight">{rubText(k.value)}</p>
              <p className="text-[12px] text-muted-foreground">{k.hint}</p>
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
              <th className={`${head} w-14`}>Кол-во</th>
              <th className={`${head} hidden w-28 sm:table-cell`}>Минимум</th>
              <th className={`${head} w-28`}>Средняя</th>
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

      {!web && (
      <Section n={5} title="Цены в интернете">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <CertaintyBadge kind="unchecked" />
          {compare && compare.exactDiffPct !== null && (
            <span className="text-[12px] text-muted-foreground">
              точные цены в среднем <span className={compare.exactDiffPct < 0 ? 'font-semibold text-success' : 'font-semibold text-danger'}>{pctText(compare.exactDiffPct)}</span> к средней у заказчика
            </span>
          )}
        </div>
        {compare && compare.rows.length > 0 ? (
          <>
            <table className="w-full table-fixed text-[12px]">
              <thead>
                <tr>
                  <th className={headLeft}>Позиция</th>
                  <th className={`${head} hidden w-36 sm:table-cell`}>У заказчика, за ед.</th>
                  <th className={`${head} w-32`}>В интернете, за ед.</th>
                  <th className={`${head} w-20`}>Разница</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {compare.rows.slice(0, COMPARE_ROWS).map((r) => (
                  <tr key={r.id}>
                    <td className="break-words px-2 py-1.5">
                      {r.name}
                      <span className="block text-[11px] text-muted-foreground">
                        {r.web.kind === 'analog' ? `аналог: другие размеры · ${r.web.n}` : `цен: ${r.web.n}`}
                        {r.web.host && ` · ${r.web.host}`} · {WHERE[r.where]}
                        {r.suspicious && <span className="font-medium text-warn-foreground"> · проверьте, тот ли товар</span>}
                      </span>
                    </td>
                    <td className={`${num} hidden sm:table-cell`}>{range(r.customer.min, r.customer.mean)}</td>
                    <td className={num}>{range(r.web.from, r.web.to)}</td>
                    <td className={`${num} font-semibold ${r.diffPct < 0 ? 'text-success' : 'text-danger'}`}>{pctText(r.diffPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={note}>
              Сравнено позиций: {compare.rows.length} из {cost.rows}
              {compare.analog > 0 && ` · по ${compare.analog} — аналоги, не та же позиция`}
              {compare.rows.length > COMPARE_ROWS && ` · показаны ${COMPARE_ROWS} самых дорогих`}
              {dropped > 0 && ` · отброшено цен: ${dropped} — в ${IMPLAUSIBLE_FACTOR} раза ниже или выше, чем у заказчика, похоже, не тот товар`}
            </p>
          </>
        ) : (
          <p className={note}>{webNote ? `Цены в интернете: ${webNote}` : 'Цены в интернете ещё не найдены.'}</p>
        )}
      </Section>
      )}

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
        {web && ` · точные цены по ${web.found} поз.${web.analogs > 0 ? `, по аналогам — ${web.analogs} (другие размеры, ориентир)` : ''}${web.filled > 0 ? `, цена заказчика — ${web.filled} (прибыли по ним нет)` : ''}${web.missing > 0 ? `, без цены — ${web.missing}` : ''}`}
        {cost.unchecked > 0 && ` · у ${cost.unchecked} поз. цены поставщиков не прочитались — взята средняя`}
      </p>
    </Card>
  );
}
