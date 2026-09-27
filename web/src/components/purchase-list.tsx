"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlusIcon, SearchIcon } from "@/components/icons";
import { Note } from "@/components/note";
import { daysText, LawBadge } from "@/components/purchase-bits";
import { dueLine } from "@/lib/deadline";
import { titleOf, type Purchase } from "@/lib/purchase";
import { openSamplePurchase } from "@/lib/sample-purchase";
import { stageOf, TONE_TEXT } from "@/lib/steps";
import { STORAGE_ERROR } from "@/lib/use-purchases";

function Days({ purchase }: { purchase: Purchase }) {
  const due = dueLine(purchase.deadline, false);
  if (!due || due.days < 0) return null;
  return (
    <span className={`t-num whitespace-nowrap ${due.tone === "soon" ? "font-semibold text-[var(--warn)]" : "text-[var(--ink-3)]"}`}>
      {due.days === 0 ? "сегодня" : daysText(due.days)}
    </span>
  );
}

// Список закупок как список переписок: значок закона, название, заказчик и шаг, на котором закупка;
// справа — сколько дней до подачи. Строки — пункты острова, как в меню: без разделителей, открытая — тинтом.
export function PurchaseListPane({ purchases, error, openId }: { purchases: Purchase[] | null; error: string | null; openId?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sampleError, setSampleError] = useState(false);

  async function sample() {
    setSampleError(false);
    try {
      router.push(`/p/${await openSamplePurchase()}`);
    } catch {
      setSampleError(true);
    }
  }

  const q = query.trim().toLowerCase();
  const shown = (purchases ?? []).filter(
    (p) => !q || [titleOf(p), p.subject, p.customer, p.kind].join(" ").toLowerCase().includes(q)
  );

  return (
    <>
      <div className="flex flex-none items-center px-2 pb-1 pt-2">
        <label className="field flex items-center gap-2 text-[var(--ink-3)]">
          <SearchIcon className="size-3.5 shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Найти закупку…"
            aria-label="Найти закупку"
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-foreground outline-none"
          />
        </label>
      </div>

      {/* Сверху 4 px — чтобы рамка фокуса первой строки не обрезалась краем прокрутки */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2 pt-1">
        {(error || sampleError) && (
          <div className="pb-2">
            <Note tone="warn">{error ?? STORAGE_ERROR}</Note>
          </div>
        )}
        {purchases?.length === 0 && (
          <div className="grid justify-items-start gap-3 px-2 py-2">
            <p className="text-[var(--ink-2)]">Закупок пока нет. Загрузите документы — выпишу требования и сроки.</p>
            {/* На широком экране кнопки стоят в основной панели, в списке их не повторяем */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 split:hidden">
              <Link href="/new" className="btn">
                <PlusIcon />
                Новая закупка
              </Link>
              <span className="t-body text-[var(--ink-3)]">
                или{" "}
                <button type="button" onClick={() => void sample()} className="link">
                  пример
                </button>
              </span>
            </div>
          </div>
        )}
        {purchases && purchases.length > 0 && shown.length === 0 && (
          <p className="px-2 py-2 text-[var(--ink-3)]">Ничего не нашлось. Поиск идёт по названию, заказчику и закону.</p>
        )}
        {shown.length > 0 && (
          <ul className="grid gap-0.5">
            {shown.map((p) => {
              const current = p.id === openId;
              const stage = stageOf(p);
              return (
                <li key={p.id}>
                  <Link
                    href={`/p/${p.id}`}
                    aria-current={current ? "true" : undefined}
                    className="item grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-0.5 py-2"
                  >
                    <span className="row-span-2 grid">
                      <LawBadge purchase={p} selected={current} />
                    </span>
                    <span className="grid min-w-0">
                      <span className="t-strong line-clamp-2">{titleOf(p)}</span>
                      <span className="t-caption truncate text-[var(--ink-3)]">
                        {[p.sample ? "пример" : "", p.customer].filter(Boolean).join(" · ") || p.kind}
                      </span>
                    </span>
                    <Days purchase={p} />
                    <span className={`t-tag col-span-2 truncate ${TONE_TEXT[stage.tone]}`}>{stage.text}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
