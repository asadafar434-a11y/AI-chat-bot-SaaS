"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { usePathname } from "next/navigation";
import { SideNav } from "@/components/side-nav";

type Shell = { menuOpen: boolean; openMenu: () => void; menuButton: RefObject<HTMLButtonElement | null> };

const ShellContext = createContext<Shell | null>(null);

// Кнопка меню живёт в шапке экрана: на телефоне она стоит рядом с заголовком, как в макете.
export function useShell() {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("useShell работает только внутри AppShell");
  return shell;
}

// Каркас всех экранов: на холсте — остров-сайдбар и основная часть, в которой свои острова.
// Уже 1024 px сайдбар прячется и выезжает островом по кнопке из шапки, а остальная страница на это время неактивна.
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Меню открыто только на том экране, где его открыли: переход по ссылке его закрывает.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const side = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  // Закрыли крестиком, фоном или Escape — фокус возвращается на кнопку меню. После перехода по ссылке — нет.
  const returnFocus = useRef(false);

  const close = () => {
    returnFocus.current = true;
    setOpenAt(null);
  };

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 64rem)");
    const onChange = () => wide.matches && setOpenAt(null);
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  // Фокус переводится после отрисовки: пока страница inert, а меню скрыто, фокус на них не встаёт.
  useEffect(() => {
    if (!open) {
      if (returnFocus.current) menuButton.current?.focus();
      returnFocus.current = false;
      return;
    }
    side.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      returnFocus.current = true;
      setOpenAt(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Страница входа по закрытой ссылке — без сайдбара: до входа разделы приложения не показываем.
  if (pathname === "/login") return children;

  return (
    <ShellContext value={{ menuOpen: open, openMenu: () => setOpenAt(pathname), menuButton }}>
      <div className="grid h-full grid-cols-[var(--side-w)_minmax(0,1fr)] max-lg:grid-cols-1 lg:pl-2">
        <aside
          ref={side}
          id="side-nav"
          aria-label="Навигация"
          className={`island flex min-h-0 flex-col lg:my-2 max-lg:fixed max-lg:bottom-[max(8px,env(safe-area-inset-bottom,0px))] max-lg:left-2 max-lg:top-[max(8px,env(safe-area-inset-top,0px))] max-lg:z-40 max-lg:w-[min(320px,calc(100vw-16px))] max-lg:shadow-[var(--float)] max-lg:duration-200 motion-reduce:transition-none ${
            // Открывается — видимо сразу, чтобы на меню встал фокус; закрывается — видимо, пока не уедет.
            open ? "max-lg:transition-[translate]" : "max-lg:invisible max-lg:-translate-x-[calc(100%+16px)] max-lg:transition-[translate,visibility]"
          }`}
        >
          <SideNav onClose={close} />
        </aside>
        {open && <div className="fixed inset-0 z-30 bg-[var(--scrim)] lg:hidden" onClick={close} aria-hidden />}

        <div inert={open} className="flex min-h-0 min-w-0 flex-col">
          {children}
        </div>
      </div>
    </ShellContext>
  );
}
