"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/badge";
import { Hint } from "@/components/hint";
import { CheckIcon, RefreshIcon, UserCheckIcon, WalletIcon, type IconComponent } from "@/components/icons";
import { Island } from "@/components/island";
import { Note } from "@/components/note";
import { PageBody, PageHeader } from "@/components/page-header";
import { Soon } from "@/components/soon";
import { AI_LIMITS } from "@/lib/ai-cost";
import { plural } from "@/lib/plural";
import { rubShort } from "@/lib/price-calc";
import { PLANS, PRICE_EXPERT, RECHECK_PACK, type Plan } from "@/lib/pricing";

const rechecksText = (n: number) => `${n} ${plural(n, "пересчёт", "пересчёта", "пересчётов")}`;
const RECHECKS = rechecksText(AI_LIMITS.rechecks);

// Что входит в каждую заявку — список из прототипа, без того, чего приложение ещё не умеет:
// риска отклонения пока нет.
const INCLUDED = [
  "Разбор документации и список того, что подать, — с цитатами из документов",
  "ТП и другие документы — по формам заказчика и вашим образцам",
  "Расчёт «до какой цены снижаться»",
  "Карта полей и проверка заявки",
  `${RECHECKS} ИИ; правки и обычные проверки — без ограничений`,
  "Скачивание Word, PDF и ODT — по одному или архивом",
];

const titleOf = (p: Plan) => (p.count === 1 ? "Одна заявка" : `Пакет ${p.count} заявок`);

function PlanCard({ plan, best }: { plan: Plan; best: boolean }) {
  const id = `plan-${plan.count}`;
  return (
    // Выгоднее всего — пакет на 10: рамка темнее и метка над карточкой, как в прототипе
    <section aria-labelledby={id} className={`island relative flex flex-col px-[var(--pad)] py-4 ${best ? "shadow-md ring-1 ring-foreground/40" : ""}`}>
      {best && (
        <span className="t-tag absolute -top-2.5 left-[var(--pad)] rounded-[var(--r-pill)] bg-primary px-2 py-0.5 text-primary-foreground">
          Выгоднее всего
        </span>
      )}
      {/* Высота строки — по бейджу скидки: без него цена в карточке «Одна заявка» стояла бы выше соседних */}
      <div className="flex min-h-[22px] items-center justify-between gap-2">
        <h2 id={id} className="t-label">
          {titleOf(plan)}
        </h2>
        {plan.discountPct > 0 && <Badge tone="ok" text={`−${plan.discountPct} %`} />}
      </div>
      <p className="mt-3 font-mono text-xl font-semibold tabular-nums">{rubShort(plan.price)}</p>
      <p className="t-caption mb-4 mt-1 text-[var(--ink-3)]">
        {plan.count === 1 ? "для одной закупки" : `${rubShort(plan.perApp)} за заявку · экономия ${rubShort(plan.saving)}`}
      </p>
      <button type="button" disabled className="btn btn-line mt-auto w-full">
        Купить
        <Soon />
      </button>
    </section>
  );
}

// Докупка к заявке. Обе пока «скоро»: для оплаты и переписки с юристом нужен сервер, лимита пересчётов в приложении нет.
function Extra({ id, icon: Icon, paid = false, title, hint, price, children }: {
  id: string;
  icon: IconComponent;
  // Индиго-градиент — только у главного платного действия, проверки специалистом (CLAUDE.md)
  paid?: boolean;
  title: string;
  hint?: ReactNode;
  price: number;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="island grid grid-cols-[36px_minmax(0,1fr)] items-start gap-3 px-[var(--pad)] py-3">
      <span
        aria-hidden
        className={`grid size-9 place-items-center rounded-full ${paid ? "bg-brand-gradient text-white" : "bg-[var(--paper-2)] text-foreground"}`}
      >
        <Icon className="size-4" />
      </span>
      <div className="grid min-w-0 gap-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h2 id={id} className="t-label">
              {title}
            </h2>
            {hint}
            <Soon />
          </div>
          <span className="font-mono text-sm font-semibold tabular-nums">{rubShort(price)}</span>
        </div>
        <p className="t-caption text-[var(--ink-2)]">{children}</p>
      </div>
    </section>
  );
}

// «Тарифы», как в прототипе: заявка по одной или пакетом со скидкой, что в неё входит, что докупается.
// Оплаты в приложении пока нет — для неё нужен сервер. Цены показаны, покупка помечена «скоро»; баланса нет.
export default function TariffsPage() {
  const best = PLANS[PLANS.length - 1];

  return (
    <>
      <PageHeader title="Тарифы" sub="Платите за заявку, а не за подписку" />
      <PageBody>
        <div className="grid max-w-[880px] gap-2">
          <Note tone="info" icon={WalletIcon}>
            Оплата пока не подключена — документы скачиваются бесплатно. Цены ниже начнут действовать, когда она заработает.
          </Note>

          {/* Сверху отступ под метку «Выгоднее всего»: она выступает над карточкой */}
          <div className="grid grid-cols-1 gap-3 pt-1.5 md:grid-cols-3">
            {PLANS.map((plan) => (
              <PlanCard key={plan.count} plan={plan} best={plan === best} />
            ))}
          </div>

          <Island id="tariffs-included" title="Что входит в каждую заявку">
            <ul className="grid grid-cols-1 gap-x-6 gap-y-2 px-[var(--pad)] pb-4 pt-1 sm:grid-cols-2">
              {INCLUDED.map((text) => (
                <li key={text} className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-2 text-[var(--ink-2)]">
                  <CheckIcon aria-hidden className="mt-0.5 size-4 text-[var(--ok)]" />
                  {text}
                </li>
              ))}
            </ul>
          </Island>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Extra id="extra-expert" icon={UserCheckIcon} paid title="Проверка специалистом" price={PRICE_EXPERT}>
              Тендерный юрист сверит комплект с извещением перед подачей — заказ на шаге «Пакет». Для переписки с юристом
              нужен сервер, его пока нет.
            </Extra>
            <Extra
              id="extra-rechecks"
              icon={RefreshIcon}
              title={`Ещё ${rechecksText(RECHECK_PACK.count)} ИИ`}
              hint={
                <Hint label="Пересчёт ИИ">
                  Повторная проверка всей заявки ИИ. В каждую заявку входят {RECHECKS}, правки полей проверяются без ИИ и
                  бесплатно.
                </Hint>
              }
              price={RECHECK_PACK.price}
            >
              Когда {RECHECKS} в заявке закончатся. Пока лимита нет — проверяйте сколько нужно.
            </Extra>
          </div>
        </div>
      </PageBody>
    </>
  );
}
