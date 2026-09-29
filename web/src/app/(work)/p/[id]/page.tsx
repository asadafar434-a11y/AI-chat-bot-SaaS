"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/badge";
import { CriteriaIsland } from "@/components/criteria-island";
import { Island } from "@/components/island";
import { Warnings } from "@/components/note";
import { PriceTeaser } from "@/components/price-teaser";
import { SourceQuote } from "@/components/purchase-bits";
import { usePurchase } from "@/components/purchase-provider";
import { NextStep, StepIntro, TabBody } from "@/components/purchase-view";
import { plural } from "@/lib/plural";
import { scanWarning } from "@/lib/read-documents";
import { REQ_GROUP_KEYS, type ReqGroupKey } from "@/lib/requirements";

const GROUPS: Record<ReqGroupKey, { title: string; empty: string }> = {
  who: {
    title: "Кто может участвовать",
    empty: "Ограничений и особых требований к участникам не нашёл. Обычно они в извещении — проверьте, что оно загружено.",
  },
  submit: {
    title: "Что подать в заявке",
    empty: "Не нашёл, что подать в заявке. Это обычно в извещении или в требованиях к содержанию заявки.",
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

// Шаг 2 «Анализ»: первым — вход в «Цену» («Перед торгами»), дальше каждая группа требований — свой остров,
// после «Кто может участвовать» — как оценят заявку, в конце — остров «Дальше».
export default function RequirementsPage() {
  const { purchase, documents } = usePurchase();
  const [open, setOpen] = useState<string | null>(null);
  const { requirements, criteria, unreadable } = purchase;
  const unverified =
    REQ_GROUP_KEYS.reduce((n, key) => n + requirements[key].filter((it) => !it.verified).length, 0) +
    (criteria?.rows.filter((row) => !row.verified).length ?? 0);
  const toggle = (id: string) => setOpen(open === id ? null : id);
  const ready = new Set(purchase.submitReady ?? []);

  const group = (key: ReqGroupKey) => {
    // «Что подать» — как «Анализ» в прототипе: сначала то, что ещё собрать, готовое — вниз. Отмечают на шаге «Пакет».
    const items =
      key === "submit" ? [...requirements.submit].sort((a, b) => Number(ready.has(a.text)) - Number(ready.has(b.text))) : requirements[key];
    const done = key === "submit" ? items.filter((it) => ready.has(it.text)).length : 0;
    return (
      <Island
        key={key}
        id={`req-${key}`}
        level={3}
        title={GROUPS[key].title}
        count={items.length || undefined}
        sub={key === "submit" && items.length ? `готово ${done} из ${items.length} · документы заявки пишу я, остальное собираете вы` : undefined}
        action={
          key === "submit" && items.length ? (
            <Link href={`/p/${purchase.id}/package`} className="btn btn-line btn-xs">
              Отметить готовое
            </Link>
          ) : undefined
        }
      >
        {items.length === 0 ? (
          <p className="px-[var(--pad)] pb-3 pt-1 text-[var(--ink-3)]">{GROUPS[key].empty}</p>
        ) : (
          <ul className="divide-y divide-[var(--line)] px-[var(--pad)] pb-1">
            {items.map((it, i) => {
              const id = `${key}-${i}`;
              return (
                <li key={id} className="grid gap-1 py-2.5">
                  <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <span className={`t-read ${key === "submit" && ready.has(it.text) ? "text-[var(--ink-3)]" : ""}`}>{it.text}</span>
                    {key === "submit" && ready.has(it.text) && <Badge tone="ok" text="готово" icon="check" />}
                  </span>
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
      <StepIntro>
        Шаг 2 — разобраться, подходит ли вам закупка и что подать. Всё выписано из документов закупки; нажмите на ссылку под пунктом, чтобы увидеть точную цитату.
      </StepIntro>

      <Warnings
        items={[
          unreadable.length > 0 &&
            `Не получилось прочитать: ${unreadable.map((f) => `${f.name} — ${f.reason}`).join("; ")}. Требования выписаны по остальным файлам.`,
          scanWarning(documents),
          unverified > 0 &&
            `В ${unverified} ${plural(unverified, "пункте", "пунктах", "пунктах")} цитата не найдена в документах дословно — сверьте их вручную.`,
        ]}
      />

      <PriceTeaser purchase={purchase} />

      {group("submit")}
      {group("who")}
      <CriteriaIsland criteria={criteria} open={open} onToggle={toggle} />
      {REQ_GROUP_KEYS.filter((key) => key !== "who" && key !== "submit").map(group)}

      <NextStep from="analysis" />
    </TabBody>
  );
}
