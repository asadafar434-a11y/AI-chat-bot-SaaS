"use client";

import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { ConsentChecks, legalLink as doc } from "@/components/consent-checks";
import { ScalesIcon } from "@/components/icons";
import { hasConsent, saveConsent } from "@/lib/consent";

// Согласие дали в другой вкладке — эта узнает об этом из события storage.
const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

// Перед началом работы — два согласия, даже если вход без пароля. Отмечены на странице входа — второй раз не спросим.
// На сервере хранилища браузера нет: пока согласие не проверено, ничего не показываем, иначе приложение мелькнёт до вопроса.
export function ConsentGate({ children }: { children: ReactNode }) {
  const stored = useSyncExternalStore(subscribe, () => hasConsent(), () => null);
  const [accepted, setAccepted] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [transfer, setTransfer] = useState(false);

  if (accepted || stored === true) return children;
  if (stored === null) return null;

  function submit(e: FormEvent) {
    e.preventDefault();
    saveConsent();
    setAccepted(true);
  }

  return (
    <main className="grid h-full place-items-center overflow-y-auto p-4">
      <form onSubmit={submit} className="island grid w-full max-w-[400px] gap-4 p-6 max-sm:p-5">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 flex-none place-items-center rounded-[var(--r-ctl)] bg-primary text-primary-foreground shadow-[inset_0_-2px_0_rgb(0_0_0/.12)]">
            <ScalesIcon className="size-4" />
          </span>
          <span className="font-heading text-sm leading-5 font-bold tracking-[-0.01em]">Тендерный юрист</span>
        </div>
        <div className="grid gap-1">
          <h1 className="t-page">Перед началом</h1>
          <p className="text-[var(--ink-2)]">
            Сервис читает документы закупки с помощью ИИ. В документах и реквизитах бывают персональные данные, поэтому нужны
            два согласия.
          </p>
        </div>
        <ConsentChecks processing={processing} transfer={transfer} onProcessing={setProcessing} onTransfer={setTransfer} />
        <button type="submit" disabled={!processing || !transfer} className="btn btn-lg">
          Продолжить
        </button>
        <p className="t-caption text-[var(--ink-3)]">
          Продолжая, вы принимаете {doc("/terms", "условия использования")}. Как сервис обращается с данными — в{" "}
          {doc("/privacy", "политике")}. Владелец сервиса — на странице {doc("/contacts", "«Контакты»")}.
        </p>
      </form>
    </main>
  );
}
