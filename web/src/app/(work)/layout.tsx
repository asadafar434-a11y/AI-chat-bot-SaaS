"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PlusIcon } from "@/components/icons";
import { PageBody, PageHeader } from "@/components/page-header";
import { daysText } from "@/components/purchase-bits";
import { PurchaseListPane } from "@/components/purchase-list";
import { dueLine } from "@/lib/deadline";
import { plural } from "@/lib/plural";
import { usePurchases } from "@/lib/use-purchases";

// «Закупки» — как мессенджер: остров-список слева остаётся на месте, справа открыта закупка.
// От 1180 px видны оба, уже — что-то одно: список или закупка с кнопкой «назад».
export default function WorkLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const openId = /^\/p\/([^/]+)/.exec(pathname)?.[1];
  const { purchases, error } = usePurchases();

  const n = purchases?.length ?? 0;
  const next = purchases?.map((p) => dueLine(p.deadline, false)).find((d) => d && d.days >= 0);
  const sub =
    purchases === null
      ? ""
      : n === 0
        ? "Закупок пока нет"
        : `${n} ${plural(n, "закупка", "закупки", "закупок")}${
            next ? ` · ближайший срок подачи ${next.days === 0 ? "сегодня" : `через ${daysText(next.days)}`}` : ""
          }`;

  return (
    <>
      <PageHeader
        title="Закупки"
        sub={sub}
        actions={
          // Уже 1024 px «Новая закупка» — плюсом в шапке каркаса, второй раз её не ставим
          <Link href="/new" className="btn max-lg:hidden">
            <PlusIcon />
            Новая закупка
          </Link>
        }
      />
      <PageBody fill>
        <div className="grid min-h-0 flex-1 grid-cols-[var(--list-w)_minmax(0,1fr)] gap-2 max-split:grid-cols-1">
          <section
            aria-label="Мои закупки"
            className={`island flex min-h-0 min-w-0 flex-col overflow-hidden ${openId ? "max-split:hidden" : ""}`}
          >
            <PurchaseListPane purchases={purchases} error={error} openId={openId} />
          </section>
          <div className={`flex min-h-0 min-w-0 flex-col ${openId ? "" : "max-split:hidden"}`}>{children}</div>
        </div>
      </PageBody>
    </>
  );
}
