"use client";

import type { ReactNode } from "react";
import { MenuIcon } from "lucide-react";
import { useShell } from "@/components/app-shell";

// Шапка экрана на холсте: заголовок, под ним главная цифра экрана, справа — одно главное действие.
export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  const { menuOpen, openMenu, menuButton } = useShell();
  return (
    <header className="flex min-h-20 flex-none items-center gap-x-4 gap-y-3 px-[var(--gutter)] py-4 max-lg:min-h-16 max-lg:gap-2 max-lg:py-3 max-lg:pl-2 max-lg:pr-4">
      <button
        ref={menuButton}
        type="button"
        onClick={openMenu}
        aria-label="Открыть меню"
        aria-controls="side-nav"
        aria-expanded={menuOpen}
        className="icon-btn lg:hidden"
      >
        <MenuIcon className="size-[22px]" />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="t-page truncate max-lg:t-title">{title}</h1>
        {sub && <p className="t-body truncate text-[var(--ink-3)]">{sub}</p>}
      </div>
      {actions && <div className="flex flex-none items-center gap-3">{actions}</div>}
    </header>
  );
}

// Прокручиваемая часть экрана под шапкой. fill — для экранов, где панели прокручиваются сами.
export function PageBody({ fill = false, children }: { fill?: boolean; children: ReactNode }) {
  return (
    <main
      data-scroll-root={fill ? undefined : ""}
      className={`min-h-0 flex-1 px-[var(--gutter)] pb-[var(--gutter)] max-lg:px-3 max-lg:pb-3 ${
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
