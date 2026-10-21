import { BarChart2, ChevronRight, Plus } from '../lib/icons';
import { Button, Card, Soon } from './ui';

// Раздел «Аналитика» в левом меню: расчёты по закупке отдельно от шагов подготовки заявки. Сейчас готов РИЦ (расчёт индикативной цены); остальное — «скоро».
// План и статус каждого шага — АНАЛИТИКА-ПЛАН.md в корне проекта.

export type AnalyticsPurchase = { id: string; title: string; price: string; kind: string; sample?: boolean };

type Props = {
  /** null — закупки ещё читаются. */
  purchases: AnalyticsPurchase[] | null;
  onOpen: (id: string) => void;
  onNew: () => void;
};

const COMING = [
  { title: 'Цена против рынка и ценовой бейдж', text: 'Начальная цена заказчика против РИЦ: «ниже рынка», «выше рынка», «в диапазоне»; пересчёт обоснования цены у заказчика.' },
  { title: 'Риски из документов', text: 'Штрафы, сроки оплаты, обеспечение, неясные объёмы, приёмка — каждый с цитатой и числом.' },
  { title: 'Скрытые затраты и реестр рисков', text: 'Риски, которых нет в документах: логистика, внешняя проверка, субподряд и другое; проверка российским поиском; что будет с прибылью, если подорожает топливо или материалы.' },
  { title: 'Экономика участия и цена заявки', text: 'Себестоимость, обеспечение, налог, резерв, минимальная и целевая цена, три сценария.' },
  { title: 'Матрица проверок и итоговая диаграмма', text: 'Какие из 27 проверок удалось сделать и что показывают; шансы — оценочным баллом с диапазоном, а не процентом победы.' },
];

export function AnalyticsHome({ purchases, onOpen, onNew }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <BarChart2 className="size-5" />
          <h1 className="text-xl font-semibold tracking-tight">Аналитика</h1>
        </div>
        <p className="mt-1 max-w-3xl text-[13px] text-muted-foreground">
          Расчёты по закупке на реальных данных: документы заказчика, ваши цены и затраты. Нет данных — так и написано, цифр не выдумываем. Выберите закупку.
        </p>
      </div>

      <Card className="p-0">
        <div className="border-b border-border px-4 py-3 text-sm font-medium">Закупки</div>
        {purchases === null ? (
          <p className="px-4 py-4 text-[13px] text-muted-foreground">Читаю закупки…</p>
        ) : purchases.length === 0 ? (
          <div className="space-y-3 px-4 py-4 text-[13px]">
            <p className="text-muted-foreground">Закупок пока нет. Загрузите документы закупки — расчёт откроется по ней.</p>
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
                  <span className="shrink-0 text-[12px] text-muted-foreground">Открыть расчёт</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-0">
        <div className="border-b border-border px-4 py-3 text-sm font-medium">Что готово и что скоро</div>
        <ul className="divide-y divide-border text-[13px]">
          <li className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">РИЦ — расчёт индикативной цены</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">Рыночный ориентир цены закупки из цен-аналогов с источниками и датами; отклонение начальной цены заказчика.</p>
            </div>
            <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">готово</span>
          </li>
          {COMING.map((c) => (
            <li key={c.title} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{c.title}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">{c.text}</p>
              </div>
              <Soon />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
