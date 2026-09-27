"use client";

import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { HelpCircleIcon } from "@/components/icons";

// Подсказка к термину: кнопка «?» рядом с подписью, короткое объяснение — карточкой поверх экрана.
// Мышью открывается наведением и закрывается, когда мышь уходит с кнопки и карточки; нажатие закрепляет карточку.
// На телефоне наведения нет — там, как и с клавиатуры (Enter, пробел), открывается нажатием. Закрывается Esc и нажатием мимо.
// Длинные пояснения со ссылками на статьи живут здесь, а не абзацем под каждым полем.
// label — о чём подсказка: заголовок карточки и подпись кнопки для экранного диктора.
export function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={150}
        closeDelay={150}
        aria-label={`Подсказка: ${label}`}
        className="-my-1.5 inline-grid size-7 flex-none place-items-center rounded-[var(--r-ctl)] align-middle text-[var(--ink-3)] outline-offset-1 focus-visible:outline-2 focus-visible:outline-[var(--brand)] data-[popup-open]:text-[var(--brand)] hover:bg-[var(--hover)] hover:text-foreground"
      >
        <HelpCircleIcon className="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={6} collisionPadding={8} className="z-50">
          <Popover.Popup className="grid max-w-[min(320px,calc(100vw-16px))] origin-[var(--transform-origin)] gap-1 rounded-[var(--r-surface)] bg-card px-3 py-2.5 text-[var(--ink-2)] shadow-[var(--float)] outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none">
            <Popover.Title className="t-strong text-foreground">{label}</Popover.Title>
            <Popover.Description className="t-body">{children}</Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
