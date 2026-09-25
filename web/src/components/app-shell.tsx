"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon, ScaleIcon, XIcon } from "lucide-react";
import { SideNav } from "@/components/side-nav";

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="Тендерный юрист — на главную">
      <span className="grid size-8 shrink-0 place-items-center rounded-[11px] bg-primary text-primary-foreground">
        <ScaleIcon className="size-4" />
      </span>
      <span className="font-heading text-[15px] font-bold leading-[1.15] tracking-[-0.03em]">Тендерный юрист</span>
    </Link>
  );
}

// Каркас всех экранов: сайдбар слева. На экране уже 1024 px сайдбар прячется
// и выезжает по кнопке из верхней полосы, а остальная страница на это время неактивна.
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
    <>
      <aside
        ref={side}
        id="side-nav"
        aria-label="Навигация"
        className={`fixed inset-y-0 left-0 z-40 flex w-[var(--side-w)] flex-col border-r border-border bg-sidebar pb-[env(safe-area-inset-bottom,0px)] pt-[env(safe-area-inset-top,0px)] max-lg:w-[min(320px,88vw)] max-lg:shadow-[var(--lift-lg)] max-lg:duration-200 motion-reduce:transition-none ${
          // Открывается — видимо сразу, чтобы на меню встал фокус; закрывается — видимо, пока не уедет.
          open ? "max-lg:transition-[translate]" : "max-lg:invisible max-lg:-translate-x-[102%] max-lg:transition-[translate,visibility]"
        }`}
      >
        <div className="flex items-center justify-between gap-2 pb-3 pl-[18px] pr-3 pt-[18px]">
          <Logo />
          <button
            type="button"
            onClick={close}
            aria-label="Закрыть меню"
            className="grid size-10 shrink-0 place-items-center rounded-full text-[var(--ink-2)] hover:bg-accent hover:text-foreground lg:hidden"
          >
            <XIcon className="size-5" />
          </button>
        </div>
        <SideNav />
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-[var(--scrim)] lg:hidden" onClick={close} aria-hidden />}

      <div inert={open} className="flex flex-1 flex-col lg:ml-[var(--side-w)] lg:pt-[var(--shell-top)]">
        <header className="sticky top-0 z-20 flex h-[var(--shell-top)] items-center gap-1.5 border-b border-border bg-background pl-2 pr-4 lg:hidden">
          <button
            ref={menuButton}
            type="button"
            onClick={() => setOpenAt(pathname)}
            aria-label="Открыть меню"
            aria-controls="side-nav"
            aria-expanded={open}
            className="grid size-10 shrink-0 place-items-center rounded-full text-[var(--ink-2)] hover:bg-accent hover:text-foreground"
          >
            <MenuIcon className="size-[22px]" />
          </button>
          <Logo />
        </header>
        {children}
      </div>
    </>
  );
}
