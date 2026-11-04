import type { ReactNode } from 'react';
import { ChevronRight, UploadCloud } from '../lib/icons';
import { Button, Card, HelpTip } from './ui';
import { ScreenHeader } from './ScreenHeader';
import { SummaryCard } from './SummaryCard';
import { plural } from '@/lib/plural';

// Раздел «Аналитика» в левом меню: расчёты по закупке отдельно от шагов подготовки заявки. Сейчас готов РИЦ (расчёт индикативной цены); остальное — «скоро».
// План и статус каждого шага — АНАЛИТИКА-ПЛАН.md в корне проекта.

export type AnalyticsPurchase = { id: string; title: string; price: string; kind: string; sample?: boolean };

type Props = {
  /** null — закупки ещё читаются. */
  purchases: AnalyticsPurchase[] | null;
  onOpen: (id: string) => void;
  /** «Загрузить закупку»: файлы, название и цена — без ИИ (components/AnalyticsIntake.tsx). */
  onUpload: () => void;
  /** Блок между шапкой и списком закупок: «Проверка контрагента» (real/counterparty.tsx). */
  extra?: ReactNode;
};

const COMING = [
  { title: 'Ещё риски из договора (с ИИ)', hint: 'приёмка, субподряд, расторжение' },
  { title: 'Проверка гипотез поиском', hint: 'топливо, материалы, зарплаты' },
  { title: 'Проверки по заказчику', hint: 'конкуренция, суды, ФАС' },
  { title: 'Суды, приставы и РНП по ИНН сами', hint: 'сейчас — ссылки на ручную проверку' },
];

export function AnalyticsHome({ purchases, onOpen, onUpload, extra }: Props) {
  return (
    <div className="animate-fade-up space-y-4">
      <ScreenHeader
        icon="analytics"
        title="Аналитика"
        hint={
          <span className="flex items-center gap-1.5">
            Загрузите закупку или выберите из списка
            <HelpTip align="start" content="Расчёты по закупке на реальных данных: документы заказчика, ваши цены и затраты. Расчёты считает код, без ИИ; платным бывает только поиск закупочных цен в интернете при открытии закупки (до 30 ₽ за запуск, выключается переключателем «ИИ»). Нет данных — так и написано, цифр не выдумываем." />
          </span>
        }
        aside={
          <Button onClick={onUpload}>
            <UploadCloud className="size-4" />
            Загрузить закупку
          </Button>
        }
      />

      {extra}

      <Card className="p-0">
        <div className="border-b border-border px-4 py-3 text-sm font-medium">Закупки</div>
        {purchases === null ? (
          <p className="px-4 py-4 text-ui text-muted-foreground">Читаю закупки…</p>
        ) : purchases.length === 0 ? (
          <div className="space-y-3 px-4 py-4 text-ui">
            <p className="text-muted-foreground">Закупок нет — загрузите первую.</p>
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
                    <div className="flex items-start justify-between gap-x-4">
                      <p className="min-w-0 flex-1 break-words text-ui font-medium">{p.title}</p>
                      {p.price && <span className="shrink-0 text-right text-base font-bold tabular-nums">{p.price}</span>}
                    </div>
                    <p className="mt-0.5 text-caption text-muted-foreground">
                      {p.kind}
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

      <SummaryCard title="Скоро в разделе" subtitle={`${COMING.length} ${plural(COMING.length, 'функция', 'функции', 'функций')}`}>
        <ul className="divide-y divide-border text-ui">
          {COMING.map((c) => (
            <li key={c.title} className="py-2">
              <span className="font-medium">{c.title}</span>
              <span className="text-muted-foreground"> · {c.hint}</span>
            </li>
          ))}
        </ul>
      </SummaryCard>
    </div>
  );
}
