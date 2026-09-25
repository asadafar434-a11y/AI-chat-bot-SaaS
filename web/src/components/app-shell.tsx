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

// Каркас всех экранов: сайдбар и основная часть. От 1280 px это одна рамка с отступом от краёв окна.
// Уже 1024 px сайдбар прячется и выезжает по кнопке из шапки, а остальная страница на это время неактивна.
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

  return (
    <ShellContext value={{ menuOpen: open, openMenu: () => setOpenAt(pathname), menuButton }}>
      <div className="grid h-full grid-cols-[var(--side-w)_minmax(0,1fr)] bg-[var(--frame)] max-lg:grid-cols-1 xl:overflow-hidden xl:rounded-[var(--r-shell)] xl:border xl:border-[var(--line)] xl:shadow-[var(--lift)]">
        <aside
          ref={side}
          id="side-nav"
          aria-label="Навигация"
          className={`flex min-h-0 flex-col border-r border-[var(--line)] bg-[var(--frame)] max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-40 max-lg:w-[min(320px,88vw)] max-lg:border-r-0 max-lg:pb-[env(safe-area-inset-bottom,0px)] max-lg:pt-[env(safe-area-inset-top,0px)] max-lg:shadow-[var(--lift-lg)] max-lg:duration-200 motion-reduce:transition-none ${
            // Открывается — видимо сразу, чтобы на меню встал фокус; закрывается — видимо, пока не уедет.
            open ? "max-lg:transition-[translate]" : "max-lg:invisible max-lg:-translate-x-[102%] max-lg:transition-[translate,visibility]"
          }`}
        >
          <SideNav onClose={close} />
        </aside>
        {open && <div className="fixed inset-0 z-30 bg-[var(--scrim)] lg:hidden" onClick={close} aria-hidden />}

        <div inert={open} className="flex min-h-0 min-w-0 flex-col bg-[var(--canvas)]">
          {children}
        </div>
      </div>
    </ShellContext>
  );
}
