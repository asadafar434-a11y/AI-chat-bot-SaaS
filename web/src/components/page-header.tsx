"use client";

import type { ReactNode } from "react";
import { MenuIcon } from "@/components/icons";
import { useShell } from "@/components/app-shell";

// Шапка экрана на холсте: заголовок, рядом главная цифра экрана, справа — одно главное действие.
// Заголовок стоит на одной линии со знаком в сайдбаре и по левому краю островов под ним. Справа шапка
// оставляет место под полосу прокрутки, как острова под ней, — края кнопки и островов совпадают.
export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  const { menuOpen, openMenu, menuButton } = useShell();
  return (
    <header className="flex min-h-16 flex-none items-center gap-x-3 gap-y-2 overflow-hidden px-2 pt-2 [scrollbar-gutter:stable] max-lg:min-h-14 max-lg:py-2">
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

// Холст под шапкой, на нём острова. fill — для экранов, где острова прокручиваются сами.
// Поля по 8 px вокруг — место для кольца и тени островов, иначе край прокрутки их срежет.
export function PageBody({ fill = false, children }: { fill?: boolean; children: ReactNode }) {
  return (
    <main
      data-scroll-root={fill ? undefined : ""}
      className={`min-h-0 flex-1 px-2 pt-1 ${
        fill ? "flex flex-col overflow-hidden pb-2" : "overflow-y-auto overscroll-contain pb-4 [scrollbar-gutter:stable]"
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
