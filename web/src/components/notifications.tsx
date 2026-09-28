"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Popover } from "@base-ui/react/popover";
import { DOT } from "@/components/badge";
import { BellIcon } from "@/components/icons";
import { markSeen, noticesOf, parseSeen, readSeen, subscribeSeen } from "@/lib/notifications";
import { usePurchases } from "@/lib/use-purchases";

// Колокольчик в шапке каждого экрана: число новых — пилюлей бренда на углу. Уведомления — всплывающим островом
// с тенью lg: пункты без разделителей, новые — жирным и с точкой бренда. Что в них — lib/notifications.ts.
export function Notifications() {
  const { purchases } = usePurchases();
  const raw = useSyncExternalStore(subscribeSeen, () => readSeen(), () => "[]");
  const notices = useMemo(() => (purchases ? noticesOf(purchases, parseSeen(raw)) : []), [purchases, raw]);
  const fresh = notices.filter((n) => n.unread).length;
  const [open, setOpen] = useState(false);
  const first = useRef<HTMLAnchorElement>(null);

  // «Прочитать все» пропадает — фокус заранее уходит на первое уведомление, а не в никуда.
  function readAll() {
    first.current?.focus();
    markSeen(
      notices.map((n) => n.key),
      notices
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`Уведомления${fresh ? `, новых: ${fresh}` : ""}`}
        className="icon-btn relative data-[popup-open]:bg-[var(--hover)] data-[popup-open]:text-foreground"
      >
        <BellIcon className="size-5" />
        {fresh > 0 && (
          <span
            aria-hidden
            className="absolute top-px right-px grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-xs leading-4 font-semibold text-primary-foreground shadow-[0_0_0_2px_var(--canvas)]"
          >
            {fresh}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={8} className="z-50">
          <Popover.Popup
            initialFocus={() => first.current}
            className="grid max-h-[min(560px,var(--available-height))] w-[min(380px,calc(100vw-16px))] origin-[var(--transform-origin)] content-start gap-1 overflow-y-auto overscroll-contain rounded-[var(--r-island)] bg-card pt-1 pb-3 shadow-[var(--float)] outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none"
          >
            <div className="flex min-h-10 items-center justify-between gap-3 px-[var(--pad)] pt-2">
              <Popover.Title className="t-section flex items-baseline gap-2">
                Уведомления
                {fresh > 0 && <span className="count">{fresh}</span>}
              </Popover.Title>
              {fresh > 0 && (
                <button type="button" onClick={readAll} className="link link-quiet t-caption">
                  Прочитать все
                </button>
              )}
            </div>
            {purchases &&
              (notices.length ? (
                <ul className="grid gap-0.5 px-2">
                  {notices.map((n, i) => (
                    <li key={n.key}>
                      <Link
                        ref={i === 0 ? first : undefined}
                        href={n.href}
                        onClick={() => {
                          markSeen([n.key], notices);
                          setOpen(false);
                        }}
                        className="item grid grid-cols-[auto_minmax(0,1fr)_8px] items-start gap-x-2.5 p-2"
                      >
                        <span aria-hidden className={`mx-[3px] mt-[5px] size-2.5 rounded-full ${DOT[n.tone]}`} />
                        <span className="grid min-w-0 gap-0.5">
                          <span className={n.unread ? "t-strong" : "t-body text-[var(--ink-2)]"}>
                            {n.title}
                            {n.unread && <span className="sr-only">, новое</span>}
                          </span>
                          {n.text && <span className="t-caption text-[var(--ink-2)]">{n.text}</span>}
                          <span className="t-caption text-[var(--ink-3)]">{n.sub}</span>
                        </span>
                        {n.unread ? <span aria-hidden className="mt-1.5 size-2 rounded-full bg-primary" /> : <span />}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="t-body px-[var(--pad)] pb-1 text-[var(--ink-3)]">
                  Пока ничего нет. Напомню, когда до срока подачи останется неделя, и скажу, когда приём заявок закончится.
                </p>
              ))}
            <p className="t-caption mx-[var(--pad)] mt-1 border-t border-[var(--line)] pt-2.5 text-[var(--ink-3)]">
              Напоминания видны только здесь — писем сервис не отправляет.
            </p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
