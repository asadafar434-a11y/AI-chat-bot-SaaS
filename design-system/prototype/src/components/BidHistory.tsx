import { useMemo, useState } from 'react';
import { Search } from '../lib/icons';
import { Badge, Card, HelpTip, Soon } from './ui';
import { rub } from '../lib/data';
import { titleOf, type Purchase } from '@/lib/purchase';
import { parseRubles } from '@/lib/rub-words';

// История заявок: закупки, которые участник отметил поданными в «Мои закупки». Итогов с площадок пока нет,
// поэтому победителя, места и результата здесь не показываем и не выдумываем.

// «2026-11-01» → «01.11.2026»; что не похоже на дату — как есть.
const dateText = (date: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  return m ? `${m[3]}.${m[2]}.${m[1]}` : date.trim() || '—';
};

const priceText = (text: string) => {
  const n = parseRubles(text);
  return n === null ? text.trim() || '—' : rub(n);
};

export function BidHistory({ purchases }: { purchases: Purchase[] | null }) {
  const [query, setQuery] = useState('');

  const submitted = useMemo(() => (purchases ?? []).filter((p) => p.submitted && !p.sample), [purchases]);

  if (purchases === null) return <p className="text-sm text-muted-foreground">Загружаю заявки…</p>;

  const q = query.trim().toLowerCase();
  const rows = submitted.filter(
    (p) =>
      !q ||
      titleOf(p).toLowerCase().includes(q) ||
      p.customer.toLowerCase().includes(q) ||
      p.kind.toLowerCase().includes(q),
  );
  const priced = submitted.filter((p) => typeof p.tpPrice === 'number');
  const sum = priced.reduce((s, p) => s + (p.tpPrice ?? 0), 0);

  return (
    <div className="animate-fade-up space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">История заявок</h1>
          <HelpTip
            align="start"
            content="Закупки, которые вы отметили поданными. Итоги торгов с площадок — в разработке: статус «Подана» значит, что результат пока не известен, победителя и места здесь нет."
          />
        </div>
        {/* Главное — сколько подано и на какую сумму наших цен: жирно, без отдельных плиток. */}
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
          <span>
            Подано <span className="font-mono text-lg font-bold tabular-nums text-foreground">{submitted.length}</span>
          </span>
          {priced.length > 0 && (
            <span>
              Сумма наших цен <span className="font-mono text-lg font-bold tabular-nums text-foreground">{rub(sum)}</span>
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            Итоги торгов <Soon />
          </span>
        </p>
      </div>

      {submitted.length === 0 ? (
        <Card className="p-6 text-center text-[13px] text-muted-foreground">
          Пока ни одной поданной заявки. Отметьте закупку поданной в «Мои закупки» — она появится здесь.
        </Card>
      ) : (
        <>
          {submitted.length > 5 && (
          <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 hover:border-foreground/30 focus-within:border-foreground focus-within:ring-2 focus-within:ring-ring/20 focus-within:ring-inset">
            <Search className="size-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Название, заказчик или способ"
              aria-label="Поиск по истории заявок"
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          )}

          <Card>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-medium">Поданные заявки</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {rows.length === submitted.length ? `${submitted.length} записей` : `${rows.length} из ${submitted.length}`}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Закупка</th>
                    <th className="whitespace-nowrap px-4 py-2.5 font-medium">Срок подачи</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      <span className="inline-flex items-center gap-1">
                        Наша цена
                        <HelpTip content="Цена, которую вы вписали в заявку." side="bottom" />
                      </span>
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">НМЦК</th>
                    <th className="px-4 py-2.5 text-right font-medium">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="border-b border-border align-top transition-colors last:border-0 hover:bg-secondary/30">
                      <td className="px-4 py-3">
                        <p className="max-w-[280px] font-medium leading-snug">{titleOf(p)}</p>
                        <p className="mt-0.5 text-[12px] text-muted-foreground">{p.customer || '—'}</p>
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">{p.kind}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono tabular-nums">{dateText(p.deadline.date)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums">
                        {typeof p.tpPrice === 'number' ? rub(p.tpPrice) : '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                        {priceText(p.price)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Badge tone="neutral">Подана</Badge>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                        Ничего не найдено. Измените запрос.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
