"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { BotMark } from "@/components/bot-mark";
import { GeneralChat } from "@/components/general-chat";
import { CrossIcon } from "@/components/icons";

// Робот в правом нижнем углу любого экрана — как в прототипе: нажали, справа сверху открылось окно с общим чатом.
// Окно остаётся в странице и когда закрыто, поэтому разговор не пропадает при переходе между экранами.
// На самой странице «Спросить ИИ» робот не нужен: там тот же разговор, только большой.
export function ChatLauncher() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  if (pathname === "/chat") return null;

  return (
    <>
      <div
        role="dialog"
        aria-label="ИИ-ассистент"
        aria-hidden={!open}
        inert={!open}
        className={`fixed right-3 top-3 z-40 h-[560px] max-h-[calc(100dvh-1.5rem)] w-[380px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-[var(--r-island)] bg-[var(--canvas)] shadow-[var(--float)] ${
          open ? "flex" : "hidden"
        }`}
      >
        <div className="flex flex-none items-center gap-2.5 px-3 py-2.5">
          <BotMark className="size-8" />
          <div className="grid min-w-0 flex-1 leading-tight">
            <p className="t-strong">ИИ-ассистент</p>
            <p className="t-caption text-[var(--ink-3)]">общие вопросы по 44-ФЗ и 223-ФЗ</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Закрыть чат" className="icon-btn">
            <CrossIcon className="size-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-2 pb-2">
          <GeneralChat globalDrop={false} />
        </div>
      </div>

      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Спросить ИИ"
          title="Спросить ИИ"
          className="fixed bottom-5 right-5 z-40 grid size-14 place-items-center rounded-full transition-transform hover:-translate-y-0.5 max-lg:bottom-[max(20px,env(safe-area-inset-bottom,0px))]"
        >
          <BotMark className="animate-bot-glow size-14" />
        </button>
      )}
    </>
  );
}
