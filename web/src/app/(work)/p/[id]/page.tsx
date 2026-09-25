"use client";

import { useState } from "react";
import { Island } from "@/components/island";
import { Warnings } from "@/components/note";
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

// Шаг 1 «Требования»: каждая группа требований — свой остров, в конце — остров «Дальше».
export default function RequirementsPage() {
  const { purchase, documents } = usePurchase();
  const [open, setOpen] = useState<string | null>(null);
  const { requirements, unreadable } = purchase;
  const unverified = REQ_GROUP_KEYS.reduce((n, key) => n + requirements[key].filter((it) => !it.verified).length, 0);

  return (
    <TabBody>
      <StepIntro>
        Шаг 1 — разобраться, подходит ли вам закупка и что подать. Всё выписано из документов закупки; нажмите на ссылку под пунктом, чтобы увидеть точную цитату.
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

      {REQ_GROUP_KEYS.map((key) => {
        const items = requirements[key];
        return (
          <Island key={key} id={`req-${key}`} level={3} title={GROUPS[key].title} count={items.length || undefined}>
            {items.length === 0 ? (
              <p className="px-[var(--pad)] pb-3 pt-1 text-[var(--ink-3)]">{GROUPS[key].empty}</p>
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
                        onToggle={() => setOpen(open === id ? null : id)}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </Island>
        );
      })}

      <NextStep from="req" />
    </TabBody>
  );
}
