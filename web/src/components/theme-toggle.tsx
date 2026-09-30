"use client";

import { useSyncExternalStore } from "react";
import { MoonIcon, SunIcon } from "@/components/icons";

// Тема — атрибут data-theme на <html>: «light» или «dark». Скрипт в <head> (layout.tsx) ставит его до
// первой отрисовки: сохранённый выбор или, если выбора нет, системная тема — поэтому страница не мигает.
const KEY = "theme";
const EVENT = "theme-change";

type Theme = "light" | "dark";

const subscribe = (notify: () => void) => {
  window.addEventListener(EVENT, notify);
  return () => window.removeEventListener(EVENT, notify);
};
const current = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

export function ThemeToggle() {
  // На сервере тема неизвестна: подпись и значок подставляются после загрузки, без предупреждения о расхождении.
  const theme = useSyncExternalStore(subscribe, current, () => "light" as Theme);
  const next: Theme = theme === "dark" ? "light" : "dark";

  const toggle = () => {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Хранилище закрыто — тема сменится до перезагрузки страницы.
    }
    window.dispatchEvent(new Event(EVENT));
  };

  const Icon = theme === "dark" ? SunIcon : MoonIcon;
  return (
    <button
      type="button"
      onClick={toggle}
      suppressHydrationWarning
      className="t-label flex min-h-9 w-full min-w-0 items-center gap-2.5 rounded-[var(--r-ctl)] px-2.5 py-2 text-left text-[var(--ink-3)] hover:bg-[var(--hover)] hover:text-foreground"
    >
      <Icon className="size-4 shrink-0" />
      <span suppressHydrationWarning className="min-w-0 truncate">
        {theme === "dark" ? "Светлая тема" : "Тёмная тема"}
      </span>
    </button>
  );
}
