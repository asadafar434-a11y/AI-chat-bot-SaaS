import { BASIS_TEXT, quoteBasis, quoteMoney, quotePercent, quotesCount, type CustomerQuotes } from '@/lib/customer-quotes';
import { CertaintyBadge } from './Certainty';
import { Card, HelpTip } from './ui';

// «Предложения поставщиков у заказчика» (23.10.2026, владелец: соседний чат нашёл в «Обосновании НМЦ» три ТКП, а у нас на экране было «сравнить нечем»):
// цены из документа заказчика (lib/customer-quotes.ts), без ИИ. Это ориентир «на каком уровне цены у других»: цены продажи заказчику с наценкой поставщика,
// не закупочная цена и не себестоимость участника — в рейтинг и расчёт цены они не входят. Нет таблицы предложений — нет блока.

export function CustomerQuotesCard({ quotes, nmck, step }: { quotes: CustomerQuotes; nmck: number | null; step: string | null }) {
  const basis = quoteBasis(quotes, nmck);
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[14px] font-bold">Предложения поставщиков у заказчика</p>
        <CertaintyBadge kind="confirmed" />
        <HelpTip
          align="start"
          content="Предложения, которые заказчик собрал для обоснования начальной цены. Их дал заказчику его поставщик, и в цене уже есть наценка поставщика: это не ваша себестоимость и не независимый рынок. Показано как ориентир, на каком уровне цены у других; в рейтинг и расчёт вашей цены не входят."
        />
      </div>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-2xl font-bold tracking-tight">
          {quoteMoney(quotes.min)} – {quoteMoney(quotes.max)}
        </span>
        <span className="text-[12px] text-muted-foreground">
          {quotesCount(quotes.quotes.length)} · разброс {quotePercent(quotes.spreadPct)}
          {quotes.vat === 'without' && ' · без НДС'}
          {quotes.vat === 'with' && ' · с НДС'}
        </span>
      </p>
      <ul className="divide-y divide-border text-[13px]">
        {quotes.quotes.map((q) => (
          <li key={q.label} className="flex items-baseline justify-between gap-3 py-1.5 first:pt-0 last:pb-0">
            <span className="text-muted-foreground">{q.label}</span>
            <span className={q.price === quotes.min ? 'font-mono font-bold' : 'font-mono'}>{quoteMoney(q.price)}</span>
          </li>
        ))}
      </ul>
      {basis && (
        <p className="text-[13px]">
          Начальная цена заказчика {BASIS_TEXT[basis]}
        </p>
      )}
      {step && <p className="text-[12px] text-muted-foreground">{step}</p>}
      <p className="text-[12px] text-muted-foreground">{quotes.doc}</p>
    </Card>
  );
}
