"use client";

import { useState } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { BackLink } from "@/components/back-link";
import { Note } from "@/components/note";
import { PageTitle } from "@/components/page-title";
import { usePurchase } from "@/components/purchase-provider";
import { plural } from "@/lib/plural";
import { titleOf } from "@/lib/purchase";
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

export default function RequirementsPage() {
  const { purchase } = usePurchase();
  const [open, setOpen] = useState<string | null>(null);
  const { requirements, unreadable } = purchase;
  const unverified = REQ_GROUP_KEYS.reduce((n, key) => n + requirements[key].filter((it) => !it.verified).length, 0);

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-[680px] px-4 pb-10">
        <BackLink href={`/p/${purchase.id}`}>{titleOf(purchase)}</BackLink>
        <PageTitle className="mt-4">Требования</PageTitle>
        <p className="mt-3 max-w-[48ch] text-[17px] leading-[26px] text-[var(--ink-2)]">
          Всё, что нужно для заявки, — из документов закупки. Нажмите на ссылку под пунктом, чтобы увидеть точную цитату.
        </p>

        {unreadable.length > 0 && (
          <Note tone="warn" icon={AlertTriangleIcon} className="mt-5">
            {`Не получилось прочитать: ${unreadable.map((f) => `${f.name} — ${f.reason}`).join("; ")}. Требования выписаны по остальным файлам.`}
          </Note>
        )}
        {unverified > 0 && (
          <Note tone="warn" icon={AlertTriangleIcon} className="mt-2">
            {`В ${unverified} ${plural(unverified, "пункте", "пунктах", "пунктах")} цитата не найдена в документах дословно — сверьте их вручную.`}
          </Note>
        )}

        {REQ_GROUP_KEYS.map((key) => {
          const items = requirements[key];
          return (
            <section key={key} className="mt-7">
              <h2 className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                {GROUPS[key].title}
              </h2>
              {items.length === 0 ? (
                <p className="rounded-[var(--r-card)] bg-card px-[18px] py-3.5 text-[15px] leading-[22px] text-muted-foreground">
                  {GROUPS[key].empty}
                </p>
              ) : (
                <ul className="overflow-hidden rounded-[var(--r-card)] bg-card">
                  {items.map((it, i) => {
                    const id = `${key}-${i}`;
                    return (
                      <li key={id} className="grid gap-1 border-t border-border px-[18px] py-3.5 first:border-t-0">
                        <span className="text-base leading-6">{it.text}</span>
                        <button
                          type="button"
                          aria-expanded={open === id}
                          onClick={() => setOpen(open === id ? null : id)}
                          className="justify-self-start text-left text-sm font-medium text-primary underline underline-offset-4"
                        >
                          {it.source || "цитата"}
                        </button>
                        {open === id && (
                          <blockquote className="mt-1 rounded-[14px] bg-muted px-4 py-3 text-[14.5px] leading-[22px]">
                            {it.quote}
                          </blockquote>
                        )}
                        {!it.verified && (
                          <p className="flex items-center gap-2 text-[13.5px] font-medium text-[var(--warn)]">
                            <AlertTriangleIcon className="size-4 shrink-0" />
                            Не нашёл эту цитату в документах дословно — сверьте пункт вручную.
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </main>
    </div>
  );
}
