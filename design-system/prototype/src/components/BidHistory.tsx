import { useMemo, useState } from 'react';
import { History, Search } from '../lib/icons';
import { DataTable, EmptyState, TBody, THead, Td, Th, Tr } from './data';
import { Badge, Card, HelpTip, Soon } from './ui';
import { ScreenHeader } from './ScreenHeader';
import { SummaryCard } from './SummaryCard';
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
    <div className="animate-fade-up space-y-4">
      <ScreenHeader
        icon="history"
        title="История заявок"
        hint={
          <span className="flex items-center gap-1.5">
            Закупки, которые вы отметили поданными
            <HelpTip align="start" content="Закупки, которые вы отметили поданными. Итоги торгов с площадок — в разработке: статус «Подана» значит, что результат пока не известен, победителя и места здесь нет." />
          </span>
        }
      />

      {submitted.length === 0 ? (
        <EmptyState icon={<History className="size-5" />} title="Пока ни одной поданной заявки.">
          Отметьте закупку поданной в «Мои закупки» — она появится здесь.
        </EmptyState>
      ) : (
        <>
          {/* Главное — сколько подано и на какую сумму наших цен: жирно, в сводной карточке под шапкой, как «Сила профиля». */}
          <SummaryCard
            lead={<span className="text-2xl font-bold tabular-nums">{submitted.length}</span>}
            title="Подано заявок"
            subtitle={
              <span className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
                {priced.length > 0 && (
                  <span>
                    Сумма наших цен <span className="font-semibold tabular-nums text-foreground">{rub(sum)}</span>
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  Итоги торгов <Soon />
                </span>
              </span>
            }
          />
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
              <span className="text-micro tabular-nums text-muted-foreground">
                {rows.length === submitted.length ? `${submitted.length} записей` : `${rows.length} из ${submitted.length}`}
              </span>
            </div>
            <DataTable bare minWidth={640} caption="Поданные заявки">
              <THead>
                <tr>
                  <Th>Закупка</Th>
                  <Th>Срок подачи</Th>
                  <Th align="right">
                    <span className="inline-flex items-center gap-1">
                      Наша цена
                      <HelpTip content="Цена, которую вы вписали в заявку." side="bottom" />
                    </span>
                  </Th>
                  <Th align="right">НМЦК</Th>
                  <Th align="right">Статус</Th>
                </tr>
              </THead>
              <TBody>
                {rows.map((p) => (
                  <Tr key={p.id}>
                    <Td className="px-4 py-3">
                      <p className="max-w-[280px] font-medium leading-snug">{titleOf(p)}</p>
                      <p className="mt-0.5 text-caption text-muted-foreground">{p.customer || '—'}</p>
                      <p className="mt-1 text-micro text-muted-foreground">{p.kind}</p>
                    </Td>
                    <Td className="whitespace-nowrap px-4 py-3 tabular-nums">{dateText(p.deadline.date)}</Td>
                    <Td num className="px-4 py-3">
                      {typeof p.tpPrice === 'number' ? rub(p.tpPrice) : '—'}
                    </Td>
                    <Td num tone="muted" className="px-4 py-3">
                      {priceText(p.price)}
                    </Td>
                    <Td className="px-4 py-3 text-right">
                      <Badge tone="success" dot>
                        Подана
                      </Badge>
                    </Td>
                  </Tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-ui text-muted-foreground">
                      Ничего не найдено. Измените запрос.
                    </td>
                  </tr>
                )}
              </TBody>
            </DataTable>
          </Card>
        </>
      )}
    </div>
  );
}
