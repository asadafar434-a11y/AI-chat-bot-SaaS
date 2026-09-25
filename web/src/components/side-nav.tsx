"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckIcon, FolderIcon, HouseIcon, MessageSquareIcon, PlusIcon, UserRoundIcon } from "lucide-react";
import { onDataChanged } from "@/lib/db";
import { byUrgency, dueLine } from "@/lib/deadline";
import { countMyDocuments, getProfile } from "@/lib/me-store";
import { plural } from "@/lib/plural";
import { filledCount, PROFILE_KEYS } from "@/lib/profile";
import { titleOf, upgradePurchase, type Purchase } from "@/lib/purchase";
import { listPurchases } from "@/lib/purchase-store";
import { REQ_GROUP_KEYS } from "@/lib/requirements";
import { fillCount } from "@/lib/tp";

type SideData = { purchases: Purchase[]; filled: number; docs: number };

const ACTIVE = "bg-[var(--side-active)] shadow-[0_1px_2px_rgb(20_20_43/.07)]";
const COUNT = "ml-auto font-mono text-[12.5px] leading-4 font-medium text-muted-foreground tabular-nums";

function NavItem({ href, icon: Icon, current, count, children }: {
  href: string;
  icon: typeof HouseIcon;
  current: boolean;
  count?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`group flex min-h-10 items-center gap-2.5 rounded-[var(--r-ctl)] px-2.5 py-2 text-[15px] leading-5 ${
        current ? `${ACTIVE} font-semibold text-foreground` : "font-medium text-[var(--ink-2)] hover:bg-accent hover:text-foreground"
      }`}
    >
      <Icon className={`size-[18px] shrink-0 ${current ? "text-primary" : "text-muted-foreground"}`} />
      <span>{children}</span>
      {count !== undefined && <span className={COUNT}>{count}</span>}
    </Link>
  );
}

function SectionLabel({ id, count, children }: { id: string; count?: number; children: ReactNode }) {
  return (
    <h2 id={id} className="mx-2.5 mb-1.5 flex items-baseline justify-between text-xs font-bold uppercase leading-4 tracking-[.07em] text-muted-foreground">
      {children}
      {count !== undefined && <span className={`${COUNT} tracking-normal`}>{count}</span>}
    </h2>
  );
}

// Разделы открытой закупки — прямо под ней в списке.
function PurchaseSections({ purchase, pathname }: { purchase: Purchase; pathname: string }) {
  const base = `/p/${purchase.id}`;
  const reqCount = REQ_GROUP_KEYS.reduce((n, key) => n + purchase.requirements[key].length, 0);
  const fill = purchase.tp ? fillCount(purchase.tp) : 0;
  const asked = purchase.chat?.filter((m) => m.role === "user").length ?? 0;
  const tpMark = !purchase.tp ? null : fill ? (
    <span className="ml-auto min-w-[22px] rounded-[var(--r-pill)] bg-[var(--warn-tint)] px-1.5 py-px text-center font-mono text-[11.5px] font-semibold leading-4 text-[var(--warn)]">
      <span className="sr-only">впишите данные: </span>
      {fill}
    </span>
  ) : (
    <span className="ml-auto text-[var(--ok)]">
      <CheckIcon className="size-4" />
      <span className="sr-only">готово</span>
    </span>
  );

  const item = (href: string, label: string, extra: ReactNode) => {
    const current = pathname === href;
    return (
      <li>
        <Link
          href={href}
          aria-current={current ? "page" : undefined}
          className={`flex min-h-[34px] items-center gap-2 rounded-[var(--r-ctl)] px-2.5 py-1.5 text-sm leading-[19px] ${
            current ? "bg-[var(--brand-tint)] font-semibold text-primary" : "text-[var(--ink-2)] hover:bg-accent hover:text-foreground"
          }`}
        >
          <span>{label}</span>
          {extra}
        </Link>
      </li>
    );
  };

  return (
    <ul className="grid gap-px pb-2 pl-3.5 pt-1">
      {item(`${base}/requirements`, "Требования", <span className={COUNT}>{reqCount}</span>)}
      {item(`${base}/tp`, "Техническое предложение", tpMark)}
      {item(`${base}/chat`, "Вопросы", asked ? <span className={COUNT}>{asked}</span> : null)}
    </ul>
  );
}

function PurchaseItem({ purchase, pathname, open }: { purchase: Purchase; pathname: string; open: boolean }) {
  const due = dueLine(purchase.deadline, false);
  const law = purchase.kind.split(" · ")[0].trim();
  const meta = [law, due && due.days < 0 ? "приём закончился" : "", purchase.sample ? "пример" : ""].filter(Boolean).join(" · ");
  const overview = pathname === `/p/${purchase.id}`;

  return (
    <li>
      <Link
        href={`/p/${purchase.id}`}
        aria-current={overview ? "page" : open ? "true" : undefined}
        className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-[3px] rounded-[var(--r-ctl)] px-2.5 py-[9px] ${
          open ? ACTIVE : "hover:bg-accent"
        }`}
      >
        <span className="line-clamp-2 text-[14.5px] font-semibold leading-[19px]">{titleOf(purchase)}</span>
        {due && due.days >= 0 && (
          <span
            className={`col-start-2 row-start-1 whitespace-nowrap rounded-[var(--r-pill)] px-[7px] py-0.5 font-mono text-[11.5px] font-semibold leading-4 tabular-nums ${
              due.tone === "soon" ? "bg-[var(--warn-tint)] text-[var(--warn)]" : "bg-accent text-[var(--ink-2)]"
            }`}
          >
            {due.days === 0 ? "сегодня" : `${due.days} ${plural(due.days, "день", "дня", "дней")}`}
          </span>
        )}
        {meta && <span className="col-start-1 text-[12.5px] leading-[17px] text-muted-foreground">{meta}</span>}
      </Link>
      {open && <PurchaseSections purchase={purchase} pathname={pathname} />}
    </li>
  );
}

// Сайдбар: новая закупка, главная, общий чат, закупки по срочности и «Мои данные».
export function SideNav() {
  const pathname = usePathname();
  const [data, setData] = useState<SideData | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([listPurchases(), getProfile(), countMyDocuments()]).then(
        ([list, profile, docs]) => {
          if (!alive) return;
          const purchases = list.map(upgradePurchase).sort((a, b) => byUrgency(a.deadline, b.deadline));
          setData({ purchases, filled: filledCount(profile), docs });
        },
        // Хранилище недоступно — об этом скажет сам экран; в меню остаются только разделы.
        () => {}
      );
    void load();
    const off = onDataChanged(() => void load());
    return () => {
      alive = false;
      off();
    };
  }, []);

  const openId = /^\/p\/([^/]+)/.exec(pathname)?.[1];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto overscroll-contain px-3 pb-5 pt-1">
      <Link
        href="/new"
        data-autofocus
        className="flex min-h-11 items-center justify-center gap-2 rounded-[var(--r-ctl)] bg-primary px-4 text-[15px] font-semibold text-primary-foreground hover:opacity-90"
      >
        <PlusIcon className="size-[18px]" />
        Новая закупка
      </Link>

      <nav aria-label="Разделы" className="grid gap-0.5">
        <NavItem href="/" icon={HouseIcon} current={pathname === "/"}>
          Главная
        </NavItem>
        <NavItem href="/chat" icon={MessageSquareIcon} current={pathname === "/chat"}>
          Спросить про тендер
        </NavItem>
      </nav>

      {data && (
        <section aria-labelledby="side-purchases">
          <SectionLabel id="side-purchases" count={data.purchases.length}>
            Мои закупки
          </SectionLabel>
          {data.purchases.length ? (
            <ul className="grid gap-0.5">
              {data.purchases.map((p) => (
                <PurchaseItem key={p.id} purchase={p} pathname={pathname} open={p.id === openId} />
              ))}
            </ul>
          ) : (
            <p className="mx-2.5 text-sm text-muted-foreground">Закупок пока нет.</p>
          )}
        </section>
      )}

      <section aria-labelledby="side-me">
        <SectionLabel id="side-me">Мои данные</SectionLabel>
        <div className="grid gap-0.5">
          <NavItem
            href="/me/profile"
            icon={UserRoundIcon}
            current={pathname === "/me/profile"}
            count={data ? `${data.filled}/${PROFILE_KEYS.length}` : undefined}
          >
            Реквизиты
          </NavItem>
          <NavItem href="/me/documents" icon={FolderIcon} current={pathname === "/me/documents"} count={data?.docs}>
            Мои документы
          </NavItem>
        </div>
      </section>
    </div>
  );
}
