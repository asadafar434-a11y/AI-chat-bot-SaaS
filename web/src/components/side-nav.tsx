"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BotMark } from "@/components/bot-mark";
import { BrandMark } from "@/components/brand-mark";
import { Soon } from "@/components/soon";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  BriefcaseIcon,
  CaretRightIcon,
  CrossIcon,
  FolderIcon,
  HelpCircleIcon,
  ClockIcon,
  HomeIcon,
  PlusIcon,
  SearchIcon,
  UserIcon,
  WalletIcon,
  type IconComponent,
} from "@/components/icons";
import { onDataChanged } from "@/lib/db";
import { LEGAL_PAGES } from "@/lib/legal";
import { getProfile } from "@/lib/me-store";
import { filledCount, PROFILE_KEYS, type Profile } from "@/lib/profile";
import { listPurchases } from "@/lib/purchase-store";

type SideData = { purchases: number; profile: Profile };

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
      className={`t-label flex min-h-9 min-w-0 items-center gap-2.5 rounded-[var(--r-ctl)] px-2.5 py-2 ${
        // Как в прототипе: выбранный — светло-серая заливка и чёрный текст, остальные — серые до наведения.
        current ? "bg-[var(--select)] text-foreground" : "text-[var(--ink-3)] hover:bg-[var(--hover)] hover:text-foreground"
      }`}
    >
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 truncate">{children}</span>
      {count !== undefined && <span className="count ml-auto">{count}</span>}
    </Link>
  );
}

// Раздел, которого в приложении ещё нет: виден, как в прототипе, но не ведёт никуда и помечен «скоро».
function SoonItem({ icon: Icon, children }: { icon: IconComponent; children: ReactNode }) {
  return (
    <div aria-disabled="true" className="t-label flex min-h-9 min-w-0 items-center gap-2.5 rounded-[var(--r-ctl)] px-2.5 py-2 text-[var(--ink-3)] opacity-70">
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 truncate">{children}</span>
      <Soon className="ml-auto" />
    </div>
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
      <span aria-hidden className="grid size-7 place-items-center rounded-full bg-[var(--paper-2)] text-xs font-semibold text-foreground">
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
      <div className="grid gap-0.5">{children}</div>
    </section>
  );
}

// Сайдбар — остров-меню, как в прототипе: логотип, «Новая закупка», разделы, ИИ-ассистент с роботом,
// данные компании и помощь; внизу карточка участника. Знак, иконки пунктов и аватар стоят на одной вертикали.
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
      <div className="flex min-h-16 flex-none items-center gap-2 py-3 pl-3 pr-2">
        <Link href="/" aria-label="Тендерный юрист — на главную" className="inline-flex min-w-0 items-center gap-3">
          <BrandMark className="size-9" />
          <BrandName />
        </Link>
        <button type="button" onClick={onClose} aria-label="Закрыть меню" className="icon-btn ml-auto lg:hidden">
          <CrossIcon className="size-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-2 pb-3 pt-1">
        <Link href="/new" aria-current={pathname === "/new" ? "page" : undefined} className="btn w-full">
          <PlusIcon />
          Новая закупка
        </Link>

        <nav aria-label="Разделы" className="grid gap-0.5">
          <NavItem href="/" icon={HomeIcon} current={pathname === "/"} first>
            Главная
          </NavItem>
          <NavItem href="/purchases" icon={BriefcaseIcon} current={inPurchases} count={data?.purchases}>
            Закупки
          </NavItem>
          <SoonItem icon={SearchIcon}>Поиск закупок</SoonItem>
          <SoonItem icon={ClockIcon}>История заявок</SoonItem>
        </nav>

        {/* ИИ-ассистент — карточка с роботом, как «Спросить ИИ» в прототипе */}
        <Link
          href="/chat"
          aria-current={pathname === "/chat" ? "page" : undefined}
          className="flex min-w-0 items-center gap-2.5 rounded-[var(--r-ctl)] border border-[var(--line)] bg-[color-mix(in_srgb,var(--paper-2)_50%,transparent)] px-2.5 py-2 hover:bg-[var(--paper-2)] aria-[current=page]:bg-[var(--select)]"
        >
          <BotMark className="size-8" />
          <span className="grid min-w-0">
            <span className="t-label truncate">Спросить про тендер</span>
            <span className="truncate font-mono text-[11px] leading-4 text-[var(--ink-3)]">ИИ-ассистент</span>
          </span>
        </Link>

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

        <div className="mt-auto grid gap-0.5">
          <NavItem href="/tariffs" icon={WalletIcon} current={pathname === "/tariffs"}>
            Тарифы
          </NavItem>
          <NavItem href="/help" icon={HelpCircleIcon} current={pathname === "/help"}>
            Как это работает
          </NavItem>
          <ThemeToggle />
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

// Название сервиса рядом с логотипом — в меню и в шапке на телефоне
export function BrandName() {
  return (
    <span className="grid min-w-0 leading-none">
      <span className="truncate text-sm font-semibold tracking-[-0.01em]">Тендерный юрист</span>
      <span className="mt-1 truncate font-mono text-[10px] uppercase tracking-wider text-[var(--ink-3)]">AI · 44-ФЗ / 223-ФЗ</span>
    </span>
  );
}
