"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CaretRightIcon,
  ChatIcon,
  ClipboardIcon,
  CrossIcon,
  FolderIcon,
  HelpCircleIcon,
  HomeIcon,
  ScalesIcon,
  UserIcon,
  type IconComponent,
} from "@/components/icons";
import { onDataChanged } from "@/lib/db";
import { LEGAL_PAGES } from "@/lib/legal";
import { getProfile } from "@/lib/me-store";
import { filledCount, PROFILE_KEYS, type Profile } from "@/lib/profile";
import { listPurchases } from "@/lib/purchase-store";

type SideData = { purchases: number; profile: Profile };

// Выбранный раздел — заливка брендом; иконка и счётчик на ней — от --on-brand, а не белые.
const ON_BRAND_SOFT = "text-[color-mix(in_srgb,var(--on-brand)_78%,transparent)]";

function NavItem({ href, icon: Icon, current, count, first, children }: {
  href: string;
  icon: IconComponent;
  current: boolean;
  count?: ReactNode;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      data-autofocus={first || undefined}
      className={`flex min-h-8 min-w-0 items-center gap-2.5 rounded-[var(--r-ctl)] px-2.5 py-1.5 ${
        current
          ? "t-strong bg-primary text-primary-foreground shadow-[0_1px_2px_color-mix(in_srgb,var(--brand)_40%,transparent)]"
          : "t-label text-[var(--ink-2)] hover:bg-[var(--hover)] hover:text-foreground"
      }`}
    >
      <Icon className={`size-4 shrink-0 ${current ? ON_BRAND_SOFT : "text-[var(--ink-3)]"}`} />
      <span className="min-w-0 truncate">{children}</span>
      {count !== undefined && <span className={`count ml-auto ${current ? ON_BRAND_SOFT : ""}`}>{count}</span>}
    </Link>
  );
}

// Инициалы для карточки участника: из названия в кавычках, если оно есть, — «Ромашка» даст «Р».
function initials(name: string) {
  const inner = /«([^»]+)»/.exec(name)?.[1] ?? name;
  const letters = inner.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("");
  return (letters || "?").toUpperCase();
}

function MemberCard({ profile, current }: { profile: Profile; current: boolean }) {
  const name = profile.shortName.trim() || profile.fullName.trim() || "Участник закупок";
  const sub = profile.email.trim() || (profile.inn.trim() ? `ИНН ${profile.inn.trim()}` : "реквизиты не заполнены");
  return (
    <Link
      href="/me/profile"
      aria-label={`Реквизиты: ${name}`}
      aria-current={current ? "page" : undefined}
      className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[var(--r-ctl)] px-1 py-1.5 hover:bg-[var(--hover)]"
    >
      <span aria-hidden className="grid size-7 place-items-center rounded-full bg-[var(--brand-tint)] text-xs font-bold text-primary">
        {initials(name)}
      </span>
      <span className="grid min-w-0">
        <span className="t-strong truncate">{name}</span>
        <span className="t-caption truncate text-[var(--ink-3)]">{sub}</span>
      </span>
      <CaretRightIcon className="size-4 text-[var(--ink-3)]" />
    </Link>
  );
}

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="t-over mx-2.5 mb-1 text-[var(--ink-3)]">
        {title}
      </h2>
      <div className="grid gap-px">{children}</div>
    </section>
  );
}

// Сайдбар — остров-меню: разделы по смыслу — работа с закупками, данные компании, помощь; внизу карточка участника.
// Знак, иконки пунктов и аватар стоят на одной вертикали.
export function SideNav({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const [data, setData] = useState<SideData | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([listPurchases(), getProfile()]).then(
        ([list, profile]) => alive && setData({ purchases: list.length, profile }),
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

  const inPurchases = pathname === "/purchases" || pathname.startsWith("/p/") || pathname === "/new";

  return (
    <>
      <div className="flex min-h-14 flex-none items-center gap-2 py-2.5 pl-3 pr-2">
        <Link href="/" aria-label="Тендерный юрист — на главную" className="inline-flex min-w-0 items-center gap-2.5">
          <span className="grid size-7 flex-none place-items-center rounded-[var(--r-ctl)] bg-primary text-primary-foreground shadow-[inset_0_-2px_0_rgb(0_0_0/.12)]">
            <ScalesIcon className="size-4" />
          </span>
          <span className="font-heading text-sm leading-5 font-bold tracking-[-0.01em]">Тендерный юрист</span>
        </Link>
        <button type="button" onClick={onClose} aria-label="Закрыть меню" className="icon-btn ml-auto lg:hidden">
          <CrossIcon className="size-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-2 pb-3 pt-1">
        <nav aria-label="Разделы" className="grid gap-px">
          <NavItem href="/" icon={HomeIcon} current={pathname === "/"} first>
            Главная
          </NavItem>
          <NavItem href="/purchases" icon={ClipboardIcon} current={inPurchases} count={data?.purchases}>
            Закупки
          </NavItem>
          <NavItem href="/chat" icon={ChatIcon} current={pathname === "/chat"}>
            Спросить про тендер
          </NavItem>
        </nav>

        <Group id="side-me" title="Данные компании">
          <NavItem
            href="/me/profile"
            icon={UserIcon}
            current={pathname === "/me/profile"}
            count={data ? `${filledCount(data.profile)}/${PROFILE_KEYS.length}` : undefined}
          >
            Реквизиты
          </NavItem>
          {/* Без счётчика: с ним длинное название не помещается в сайдбар. Сколько документов — видно на главной. */}
          <NavItem href="/me/documents" icon={FolderIcon} current={pathname === "/me/documents"}>
            Образцы и реквизиты
          </NavItem>
        </Group>

        <div className="mt-auto grid gap-px">
          <NavItem href="/help" icon={HelpCircleIcon} current={pathname === "/help"}>
            Как это работает
          </NavItem>
          <p className="t-caption flex flex-wrap gap-x-3 gap-y-1 px-2 pt-2">
            {LEGAL_PAGES.map((page) => (
              <Link key={page.href} href={page.href} className="link link-quiet">
                {page.short}
              </Link>
            ))}
          </p>
        </div>
      </div>

      <div className="min-h-[57px] flex-none border-t border-[var(--line)] p-2">
        {data && <MemberCard profile={data.profile} current={pathname === "/me/profile"} />}
      </div>
    </>
  );
}
