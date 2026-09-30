"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/badge";
import { ArrowLeftIcon, ArrowRightIcon, CaretRightIcon, CheckIcon, CrossIcon, WarningIcon } from "@/components/icons";
import { CriteriaIsland } from "@/components/criteria-island";
import { Island } from "@/components/island";
import { Warnings } from "@/components/note";
import { PriceTeaser } from "@/components/price-teaser";
import { SourceQuote } from "@/components/purchase-bits";
import { usePurchase } from "@/components/purchase-provider";
import { TabBody } from "@/components/purchase-view";
import { onDataChanged } from "@/lib/db";
import { fieldsOf } from "@/lib/fields";
import { fulfillmentOf, planSummary, type FulfillMode, type FulfillmentPlan, type PlanStatus } from "@/lib/fulfillment";
import { getProfile } from "@/lib/me-store";
import { plural } from "@/lib/plural";
import { EMPTY_PROFILE, type Profile } from "@/lib/profile";
import { scanWarning } from "@/lib/read-documents";
import { REQ_GROUP_KEYS, type ReqGroupKey } from "@/lib/requirements";

const OTHER: Record<Exclude<ReqGroupKey, "submit">, { title: string; empty: string }> = {
  who: {
    title: "Кто может участвовать",
    empty: "Ограничений и особых требований к участникам не нашёл. Обычно они в извещении — проверьте, что оно загружено.",
  },
  scope: {
    title: "Что требует ТЗ",
    empty: "Не нашёл требований к товару, работе или услуге — добавьте ТЗ.",
  },
  terms: {
    title: "Сроки и деньги",
    empty: "Не нашёл сроков и сумм. Они обычно в извещении и проекте контракта.",
  },
};

// Статус пункта «Что подать»: цвет кружка и подпись, как в прототипе — «Не хватает», «Внимание», «Готово».
const STATUS: Record<PlanStatus, { label: string; bubble: string; tone: "bad" | "warn" | "ok" | "calm"; card: string; hint: string }> = {
  todo: {
    label: "Не хватает",
    bubble: "bg-[var(--danger-tint)] text-[var(--danger)]",
    tone: "bad",
    card: "bg-[var(--danger)]",
    hint: "Этого нет в заявке — без него её могут отклонить.",
  },
  confirm: {
    label: "Внимание",
    bubble: "bg-[var(--warn-tint)] text-[var(--warn)]",
    tone: "warn",
    card: "bg-[var(--warn)]",
    hint: "Есть, но нужно что-то дописать или подтвердить.",
  },
  done: {
    label: "Готово",
    bubble: "bg-[var(--ok-tint)] text-[var(--ok)]",
    tone: "ok",
    card: "bg-[var(--ok)]",
    hint: "Составлено или отмечено готовым — войдёт в пакет как есть.",
  },
  none: {
    label: "Не требуется",
    bubble: "bg-[var(--paper-2)] text-[var(--ink-3)]",
    tone: "calm",
    card: "bg-[var(--edge-2)]",
    hint: "Для вашей заявки это не нужно.",
  },
};

const ORDER: Record<PlanStatus, number> = { todo: 0, confirm: 1, done: 2, none: 3 };

const MODE: Record<FulfillMode, string> = {
  compose: "составлю я",
  upload: "приложить файл",
  confirm: "подтвердить",
  platform: "передаст площадка",
  not_required: "не нужно",
};

function Bubble({ status }: { status: PlanStatus }) {
  const Icon = status === "done" ? CheckIcon : status === "todo" ? CrossIcon : status === "confirm" ? WarningIcon : CheckIcon;
  return (
    <span aria-hidden className={`mt-0.5 grid size-5 flex-none place-items-center rounded-full ${STATUS[status].bubble}`}>
      <Icon className="size-3" strokeWidth={status === "done" ? 3 : 2.5} />
    </span>
  );
}

// Шаг 2 «Анализ», как в прототипе: сводка «Не хватает · Внимание · Готово» и строка на каждый пункт «Что подать» с тем,
// как его выполнить. Остальные требования закупки — ниже, каждое с точной цитатой.
export default function AnalysisPage() {
  const { purchase, documents } = usePurchase();
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [open, setOpen] = useState<string | null>(null);
  const { requirements, criteria, unreadable } = purchase;

  useEffect(() => {
    let alive = true;
    const load = () => getProfile().then((p) => alive && setProfile(p), () => {});
    void load();
    const off = onDataChanged(() => void load());
    return () => {
      alive = false;
      off();
    };
  }, []);

  const plans = useMemo(
    () => fulfillmentOf(purchase, { profile, fields: fieldsOf({ purchase, profile }) }).sort((a, b) => ORDER[a.status] - ORDER[b.status]),
    [purchase, profile]
  );
  const sum = planSummary(plans);
  const unverified =
    REQ_GROUP_KEYS.reduce((n, key) => n + requirements[key].filter((it) => !it.verified).length, 0) +
    (criteria?.rows.filter((row) => !row.verified).length ?? 0);
  const toggle = (id: string) => setOpen(open === id ? null : id);

  const cards: [PlanStatus, number][] = [
    ["todo", sum.todo],
    ["confirm", sum.confirm],
    ["done", sum.done],
  ];

  const row = (plan: FulfillmentPlan, i: number) => {
    const id = `plan-${i}`;
    const st = STATUS[plan.status];
    const expanded = open === id;
    return (
      <li key={id} className={`island p-0 ${expanded ? "shadow-[inset_0_0_0_1px_var(--edge-2)]" : ""}`}>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => toggle(id)}
          className="flex w-full items-start gap-3 rounded-[inherit] px-[var(--pad)] py-3.5 text-left hover:bg-[var(--hover)]"
        >
          <Bubble status={plan.status} />
          <span className="grid min-w-0 flex-1 gap-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="t-strong">{plan.title}</span>
              <Badge tone="calm" text={MODE[plan.mode]} />
              {plan.extra && <Badge tone="warn" text="лишнее по закону" icon="alert" />}
            </span>
            <span className="font-mono text-[11px] text-[var(--ink-3)]">{plan.basis}</span>
            <span className="t-caption text-[var(--ink-2)]">{plan.todo}</span>
          </span>
          <span className="flex flex-none items-center gap-2 self-start pt-0.5">
            <span className="max-sm:hidden">
              <Badge tone={st.tone} text={st.label} />
            </span>
            <CaretRightIcon className={`size-4 text-[var(--ink-3)] transition-transform ${expanded ? "rotate-90" : ""}`} />
          </span>
        </button>
        {expanded && (
          <div className="grid gap-2 border-t border-[var(--line)] px-[var(--pad)] py-3 pl-[calc(var(--pad)+32px)]">
            <p className="t-caption text-[var(--ink-2)]">
              <span className="font-medium text-foreground">{plan.status === "done" ? "Источник: " : "Что сделать: "}</span>
              {plan.status === "done" ? st.hint : plan.todo}
            </p>
            <SourceQuote
              source={plan.item.source || "цитата"}
              quote={plan.item.quote}
              verified={plan.item.verified}
              what="пункт"
              open
              onToggle={() => {}}
            />
          </div>
        )}
      </li>
    );
  };

  const other = (key: Exclude<ReqGroupKey, "submit">) => {
    const items = requirements[key];
    return (
      <Island key={key} id={`req-${key}`} level={3} title={OTHER[key].title} count={items.length || undefined}>
        {items.length === 0 ? (
          <p className="px-[var(--pad)] pb-3 pt-1 text-[var(--ink-3)]">{OTHER[key].empty}</p>
        ) : (
          <ul className="divide-y divide-[var(--line)] px-[var(--pad)] pb-1">
            {items.map((it, i) => {
              const id = `${key}-${i}`;
              return (
                <li key={id} className="grid gap-1 py-2.5">
                  <span className="t-read">{it.text}</span>
                  <SourceQuote
                    source={it.source || "цитата"}
                    quote={it.quote}
                    verified={it.verified}
                    what="пункт"
                    open={open === id}
                    onToggle={() => toggle(id)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Island>
    );
  };

  return (
    <TabBody>
      <div className="px-[var(--pad)] py-1">
        <h1 className="t-page">Анализ комплекта</h1>
        <p className="mt-1 max-w-[80ch] text-[var(--ink-2)]">
          Сверил извещение и ТЗ с составом заявки. Сверху — то, без чего заявку могут отклонить, ниже — что требует внимания,
          готовое — в конце. Нажмите на строку, чтобы увидеть, что сделать и где это написано.
        </p>
      </div>

      <Warnings
        items={[
          unreadable.length > 0 &&
            `Не получилось прочитать: ${unreadable.map((f) => `${f.name} — ${f.reason}`).join("; ")}. Требования выписаны по остальным файлам.`,
          scanWarning(documents),
          unverified > 0 &&
            `В ${unverified} ${plural(unverified, "пункте", "пунктах", "пунктах")} цитата не найдена в документах дословно — сверьте их вручную.`,
        ]}
      />

      <div role="group" aria-label="Сводка по заявке" className="grid grid-cols-3 gap-2">
        {cards.map(([status, n]) => (
          <div key={status} title={STATUS[status].hint} className="island grid gap-2 p-4">
            <span className="flex items-center gap-2">
              <span aria-hidden className={`size-2 rounded-full ${STATUS[status].card}`} />
              <span className="t-over text-[var(--ink-3)]">{STATUS[status].label}</span>
            </span>
            <span className="[font:600_24px/28px_var(--mono)] tabular-nums">{n}</span>
          </div>
        ))}
      </div>

      {plans.length > 0 ? (
        <ul className="grid gap-2" aria-label="Что подать в заявке">
          {plans.map(row)}
        </ul>
      ) : (
        <p className="island px-[var(--pad)] py-4 text-[var(--ink-3)]">
          Не нашёл, что подать в заявке. Это обычно в извещении или в требованиях к содержанию заявки.
        </p>
      )}

      <PriceTeaser purchase={purchase} />

      {other("who")}
      <CriteriaIsland criteria={criteria} open={open} onToggle={toggle} />
      {other("scope")}
      {other("terms")}

      <div className="flex flex-wrap items-center justify-between gap-3 px-[var(--pad)] pb-2">
        <Link href={`/p/${purchase.id}/files`} className="btn btn-line">
          <ArrowLeftIcon />
          Загрузка
        </Link>
        <Link href={`/p/${purchase.id}/price`} className="btn">
          Составить документы и цену
          <ArrowRightIcon />
        </Link>
      </div>
    </TabBody>
  );
}
