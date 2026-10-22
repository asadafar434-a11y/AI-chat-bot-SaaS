import { BarChart2, ChevronRight, Plus } from '../lib/icons';
import { Button, Card, HelpTip, Soon } from './ui';

// Раздел «Аналитика» в левом меню: расчёты по закупке отдельно от шагов подготовки заявки. Сейчас готов РИЦ (расчёт индикативной цены); остальное — «скоро».
// План и статус каждого шага — АНАЛИТИКА-ПЛАН.md в корне проекта.

export type AnalyticsPurchase = { id: string; title: string; price: string; kind: string; sample?: boolean };

type Props = {
  /** null — закупки ещё читаются. */
  purchases: AnalyticsPurchase[] | null;
  onOpen: (id: string) => void;
  onNew: () => void;
};

const READY = [
  { title: 'Какую цену ставить', hint: 'не ниже, безопасная, целевая' },
  { title: 'Сколько это может стоить', hint: 'риски, доставка и курс в рублях' },
  { title: 'Риски и расходы из договора', hint: 'неустойка, оплата, обеспечение' },
  { title: 'Расчёт цены у заказчика', hint: 'пересчёт его обоснования' },
  { title: 'РИЦ — расчёт индикативной цены', hint: 'рыночный ориентир по аналогам' },
  { title: 'Ценовой бейдж', hint: 'ниже, выше или в рынке' },
  { title: 'Итоговая диаграмма', hint: 'из чего складывается цена' },
  { title: 'Сценарии РИЦ по сферам', hint: 'девять сфер: метод и поправки' },
  { title: 'Матрица из 27 проверок', hint: '15 считает программа' },
];

const COMING = [
  { title: 'Ещё риски из договора (с ИИ)', hint: 'приёмка, субподряд, расторжение' },
  { title: 'Проверка гипотез поиском', hint: 'топливо, материалы, зарплаты' },
  { title: 'Проверки по заказчику', hint: 'конкуренция, суды, ФАС' },
];

export function AnalyticsHome({ purchases, onOpen, onNew }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <BarChart2 className="size-5" />
          <h1 className="text-xl font-semibold tracking-tight">Аналитика</h1>
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
          Выберите закупку
          <HelpTip align="start" content="Расчёты по закупке на реальных данных: документы заказчика, ваши цены и затраты. Нет данных — так и написано, цифр не выдумываем." />
        </p>
      </div>

      <Card className="p-0">
        <div className="border-b border-border px-4 py-3 text-sm font-medium">Закупки</div>
        {purchases === null ? (
          <p className="px-4 py-4 text-[13px] text-muted-foreground">Читаю закупки…</p>
        ) : purchases.length === 0 ? (
          <div className="space-y-3 px-4 py-4 text-[13px]">
            <p className="text-muted-foreground">Закупок нет.</p>
            <Button size="sm" onClick={onNew}>
              <Plus className="size-3.5" />
              Новая закупка
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {purchases.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => onOpen(p.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-[13px] font-medium">{p.title}</p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {p.kind}
                      {p.price && ` · начальная цена ${p.price}`}
                      {p.sample && ' · пример'}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-0">
        <div className="border-b border-border px-4 py-3 text-sm font-medium">Что умеет раздел</div>
        <ul className="divide-y divide-border text-[13px]">
          {READY.map((r) => (
            <li key={r.title} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2.5">
              <p className="min-w-0 flex-1">
                <span className="font-medium">{r.title}</span>
                <span className="text-muted-foreground"> · {r.hint}</span>
              </p>
              <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">готово</span>
            </li>
          ))}
          {COMING.map((c) => (
            <li key={c.title} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2.5">
              <p className="min-w-0 flex-1">
                <span className="font-medium">{c.title}</span>
                <span className="text-muted-foreground"> · {c.hint}</span>
              </p>
              <Soon />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
