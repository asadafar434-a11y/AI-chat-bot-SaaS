import { AI_LIMITS } from '@/lib/ai-cost';
import { plural } from '@/lib/plural';
import { rubShort } from '@/lib/price-calc';
import { PLANS, PRICE_EXPERT, RECHECK_PACK, type Plan } from '@/lib/pricing';
import { Check, UserCheck, RefreshCw, Wallet, Sparkles } from '../lib/icons';
import { Button, Card, Badge, HelpTip, Soon, cx } from './ui';

// «Тарифы». Вид — прототипа; цены и состав — из приложения (web/src/lib/pricing.ts). Оплаты пока нет — для неё нужен
// сервер: цены показаны, покупка помечена «скоро», баланса заявок нет. Документы скачиваются бесплатно.

const rechecksText = (n: number) => `${n} ${plural(n, 'пересчёт', 'пересчёта', 'пересчётов')}`;
const RECHECKS = rechecksText(AI_LIMITS.rechecks);

// Что входит в каждую заявку — без того, чего приложение ещё не умеет: риска отклонения по ИИ пока нет.
const INCLUDED = [
  'Разбор документации и список того, что подать, — с цитатами из документов',
  'ТП и другие документы — по формам заказчика и вашим образцам',
  'Расчёт «до какой цены снижаться»',
  'Карта полей и проверка заявки',
  `${RECHECKS} ИИ; правки и обычные проверки — без ограничений`,
  'Скачивание Word и PDF — по одному или архивом',
];

const titleOf = (p: Plan) => (p.count === 1 ? 'Одна заявка' : `Пакет ${p.count} заявок`);

export function Tariffs() {
  const best = PLANS[PLANS.length - 1];

  return (
    <div className="animate-fade-up space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Тарифы</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">Платите за заявку, а не за подписку. Пакет выгоднее, если подаёте часто.</p>
      </div>

      <p className="flex items-start gap-2 rounded-md bg-info/10 px-3 py-2 text-[13px] text-info">
        <Wallet className="mt-0.5 size-4 shrink-0" />
        Оплата пока не подключена — документы скачиваются бесплатно. Цены ниже начнут действовать, когда она заработает.
      </p>

      <div className="grid grid-cols-1 gap-3 pt-1.5 sm:grid-cols-3">
        {PLANS.map((p) => {
          const top = p === best;
          return (
            <Card key={p.count} className={cx('relative flex flex-col p-5', top && 'border-foreground/40 shadow-md')}>
              {top && (
                <span className="bg-brand-gradient absolute -top-2.5 left-5 rounded-full px-2 py-0.5 text-[11px] font-medium text-white">Выгоднее всего</span>
              )}
              <div className="flex min-h-[22px] items-center justify-between gap-2">
                <p className="text-sm font-medium">{titleOf(p)}</p>
                {p.discountPct > 0 && <Badge tone="success">−{p.discountPct}%</Badge>}
              </div>
              <p className="mt-3 font-mono text-2xl font-semibold tabular-nums">{rubShort(p.price)}</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {p.count === 1 ? 'для одной закупки' : `${rubShort(p.perApp)} за заявку · экономия ${rubShort(p.saving)}`}
              </p>
              <Button variant={top ? 'accent' : p.count === 1 ? 'secondary' : 'primary'} className="mt-4 w-full" disabled>
                {p.count === 1 ? 'Купить заявку' : `Купить ${p.count} заявок`} <Soon className="border-current/40 text-current" />
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
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                Проверка специалистом <Soon />
              </p>
              <span className="font-mono text-sm font-semibold">{rubShort(PRICE_EXPERT)}</span>
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Тендерный юрист сверит комплект с извещением перед подачей — заказ на шаге «Пакет». Для переписки с юристом нужен сервер, его пока нет.
            </p>
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary">
            <RefreshCw className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                Ещё {rechecksText(RECHECK_PACK.count)} ИИ
                <HelpTip content={`Повторная проверка всей заявки ИИ. В каждую заявку входят ${RECHECKS}, правки полей проверяются без ИИ и бесплатно.`} />
                <Soon />
              </p>
              <span className="font-mono text-sm font-semibold">{rubShort(RECHECK_PACK.price)}</span>
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">Когда {RECHECKS} в заявке закончатся. Пока лимита нет — проверяйте сколько нужно.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
