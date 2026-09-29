import { useState } from 'react';
import { Check, UserCheck, RefreshCw, Wallet, Sparkles } from '../lib/icons';
import { Button, Card, Badge, HelpTip, cx } from './ui';
import { PLANS, PRICE_EXPERT, RECHECK_PACK, rub, type Plan } from '../lib/data';

// Что входит в каждую заявку — без доплат.
const INCLUDED = [
  'Разбор документации и список того, что подать',
  'Документы по формам заказчика и вашим образцам',
  'Расчёт «до какой цены снижаться»',
  'Карта полей, проверка и риск отклонения',
  '3 пересчёта ИИ; правки и обычные проверки — без ограничений',
  'Скачивание DOCX и PDF — по одному или архивом',
];

const titleOf = (p: Plan) => (p.count === 1 ? 'Одна заявка' : `Пакет ${p.count} заявок`);

export function Tariffs({ credits, onBuy }: { credits: number; onBuy: (count: number) => void }) {
  const [bought, setBought] = useState<number | null>(null);
  const best = PLANS[PLANS.length - 1];

  return (
    <div className="animate-fade-up space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Тарифы</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Платите за заявку, а не за подписку. Пакет выгоднее, если подаёте часто.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[13px]">
          <Wallet className="size-4 text-muted-foreground" />
          На балансе: <b className="font-mono tabular-nums">{credits}</b> {credits === 1 ? 'заявка' : credits > 1 && credits < 5 ? 'заявки' : 'заявок'}
        </span>
      </div>

      {bought && (
        <p className="animate-fade-up flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-[13px] text-success">
          <Check className="size-4" /> Добавлено заявок: {bought}. Спишется по одной на шаге «Пакет». В прототипе — без
          реальных денег.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {PLANS.map((p) => {
          const top = p === best;
          return (
            <Card key={p.count} className={cx('relative flex flex-col p-5', top && 'border-foreground/40 shadow-md')}>
              {top && (
                <span className="bg-brand-gradient absolute -top-2.5 left-5 rounded-full px-2 py-0.5 text-[11px] font-medium text-white">
                  Выгоднее всего
                </span>
              )}
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{titleOf(p)}</p>
                {p.discountPct > 0 && <Badge tone="success">−{p.discountPct}%</Badge>}
              </div>
              <p className="mt-3 font-mono text-2xl font-semibold tabular-nums">{rub(p.price)}</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {p.count === 1 ? 'для одной закупки' : `${rub(p.perApp)} за заявку · экономия ${rub(p.saving)}`}
              </p>
              <Button
                variant={top ? 'accent' : p.count === 1 ? 'secondary' : 'primary'}
                className="mt-4 w-full"
                onClick={() => {
                  onBuy(p.count);
                  setBought(p.count);
                }}
              >
                {p.count === 1 ? 'Купить заявку' : `Купить ${p.count} заявок`}
              </Button>
            </Card>
          );
        })}
      </div>

      <Card className="p-5">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-muted-foreground" /> Что входит в каждую заявку
        </p>
        <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {INCLUDED.map((t) => (
            <li key={t} className="flex items-start gap-2 text-[13px] text-muted-foreground">
              <Check className="mt-0.5 size-3.5 shrink-0 text-success" /> {t}
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card className="flex items-start gap-3 p-4">
          <span className="bg-brand-gradient flex size-9 shrink-0 items-center justify-center rounded-full text-white">
            <UserCheck className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium">Проверка специалистом</p>
              <span className="font-mono text-sm font-semibold">{rub(PRICE_EXPERT)}</span>
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Тендерный юрист сверит пакет с извещением и даст заключение за 2 часа. Заказывается на шаге «Пакет».
            </p>
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary">
            <RefreshCw className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="flex items-center gap-1 text-sm font-medium">
                Ещё {RECHECK_PACK.count} пересчёта ИИ
                <HelpTip content="Полный повторный разбор заявки ИИ. В каждой заявке 3 пересчёта уже есть; правки полей проверяются бесплатно." />
              </p>
              <span className="font-mono text-sm font-semibold">{rub(RECHECK_PACK.price)}</span>
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Если 3 пересчёта в заявке кончились. Докупается на шаге «Проверка».
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
