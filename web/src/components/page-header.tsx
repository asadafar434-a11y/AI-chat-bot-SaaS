"use client";

import type { ReactNode } from "react";
import { MenuIcon } from "lucide-react";
import { useShell } from "@/components/app-shell";

// Шапка экрана на холсте: заголовок, под ним главная цифра экрана, справа — одно главное действие.
export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  const { menuOpen, openMenu, menuButton } = useShell();
  return (
    <header className="flex min-h-14 flex-none items-center gap-x-3 gap-y-2 px-[var(--gutter)] py-2.5 max-lg:pl-1.5">
      <button
        ref={menuButton}
        type="button"
        onClick={openMenu}
        aria-label="Открыть меню"
        aria-controls="side-nav"
        aria-expanded={menuOpen}
        className="icon-btn lg:hidden"
      >
        <MenuIcon className="size-5" />
      </button>
      <div className="flex min-w-0 flex-1 items-baseline gap-x-3 max-md:flex-col">
        <h1 className="t-page flex-none">{title}</h1>
        {sub && <p className="t-caption min-w-0 truncate text-[var(--ink-3)] max-md:max-w-full">{sub}</p>}
      </div>
      {actions && <div className="flex flex-none items-center gap-2">{actions}</div>}
    </header>
  );
}

// Прокручиваемая часть экрана под шапкой. fill — для экранов, где панели прокручиваются сами.
export function PageBody({ fill = false, children }: { fill?: boolean; children: ReactNode }) {
  return (
    <main
      data-scroll-root={fill ? undefined : ""}
      className={`min-h-0 flex-1 px-[var(--gutter)] pb-[var(--gutter)] ${
        fill ? "flex flex-col overflow-hidden" : "overflow-y-auto overscroll-contain"
      }`}
    >
      {children}
    </main>
  );
}

// После долгой операции результат показывается сверху: прокрутка экрана и панели закупки — к началу.
export function scrollToTop() {
  document.querySelectorAll("[data-scroll-root]").forEach((el) => el.scrollTo({ top: 0 }));
}
