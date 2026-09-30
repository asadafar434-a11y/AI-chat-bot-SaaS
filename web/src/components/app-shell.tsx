"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { ChatLauncher } from "@/components/chat-launcher";
import { ConsentGate } from "@/components/consent-gate";
import { MenuIcon, PlusIcon } from "@/components/icons";
import { BrandName, SideNav } from "@/components/side-nav";
import { askPersistentStorage } from "@/lib/backup";
import { isLegalPath } from "@/lib/legal";

// Каркас всех экранов: на холсте — остров-сайдбар и основная часть, в которой свои острова.
// Уже 1024 px, как в прототипе, сверху шапка с логотипом, «Новой закупкой» и кнопкой меню; сайдбар прячется
// и выезжает островом по этой кнопке, а остальная страница на это время неактивна.
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

  // Просим браузер не стирать данные сайта при нехватке места. Не разрешит — остаётся копия файлом на странице «Реквизиты».
  useEffect(() => {
    void askPersistentStorage();
  }, []);

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

  // Страница входа и правовые документы — без сайдбара: их открывают и те, кто ещё не вошёл.
  if (pathname === "/login" || isLegalPath(pathname)) return children;

  return (
    <ConsentGate>
      <div className="grid h-full grid-cols-[var(--side-w)_minmax(0,1fr)] max-lg:grid-cols-1 lg:pl-2">
        <aside
          ref={side}
          id="side-nav"
          aria-label="Навигация"
          className={`island flex min-h-0 flex-col rounded-[var(--r-shell)] lg:my-2 max-lg:fixed max-lg:bottom-[max(8px,env(safe-area-inset-bottom,0px))] max-lg:left-2 max-lg:top-[max(8px,env(safe-area-inset-top,0px))] max-lg:z-40 max-lg:w-[min(320px,calc(100vw-16px))] max-lg:shadow-[var(--float)] max-lg:duration-200 motion-reduce:transition-none ${
            // Открывается — видимо сразу, чтобы на меню встал фокус; закрывается — видимо, пока не уедет.
            open ? "max-lg:transition-[translate]" : "max-lg:invisible max-lg:-translate-x-[calc(100%+16px)] max-lg:transition-[translate,visibility]"
          }`}
        >
          <SideNav onClose={close} />
        </aside>
        {open && <div className="fixed inset-0 z-30 bg-[var(--scrim)] lg:hidden" onClick={close} aria-hidden />}

        <div inert={open} className="flex min-h-0 min-w-0 flex-col">
          <header className="mx-2 mt-[max(8px,env(safe-area-inset-top,0px))] flex flex-none items-center gap-2 rounded-[var(--r-shell)] bg-card py-2 pl-3 pr-2 shadow-[var(--island-shadow)] lg:hidden">
            <Link href="/" aria-label="Тендерный юрист — на главную" className="flex min-w-0 items-center gap-2.5">
              <BrandMark className="size-8" />
              <BrandName />
            </Link>
            <Link href="/new" aria-label="Новая закупка" title="Новая закупка" className="icon-btn ml-auto text-foreground shadow-[inset_0_0_0_1px_var(--line)]">
              <PlusIcon className="size-4" />
            </Link>
            <button
              ref={menuButton}
              type="button"
              onClick={() => setOpenAt(pathname)}
              aria-label="Открыть меню"
              aria-controls="side-nav"
              aria-expanded={open}
              className="icon-btn text-foreground shadow-[inset_0_0_0_1px_var(--line)]"
            >
              <MenuIcon className="size-5" />
            </button>
          </header>
          {children}
        </div>
      </div>
      <ChatLauncher />
    </ConsentGate>
  );
}
