"use client";

import { useState, type FormEvent } from "react";
import { ConsentChecks, legalLink as doc } from "@/components/consent-checks";
import { ScalesIcon, WarningIcon } from "@/components/icons";
import { Note } from "@/components/note";
import { saveConsent } from "@/lib/consent";

// Куда вернуться после входа: только страница этого же сайта, чужой адрес в ?next= не пройдёт.
function nextPath() {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next) return "/";
  const url = new URL(next, window.location.origin);
  return url.origin === window.location.origin && url.pathname !== "/login" ? url.pathname + url.search + url.hash : "/";
}

// Вход по закрытой ссылке: поле пароля, согласие на обработку персональных данных, согласие на передачу за рубеж и кнопка.
// Согласия — отдельными галочками, не отмеченными заранее: с 1 сентября 2025 года их нельзя прятать в условия.
export function LoginForm() {
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "wrong" | "limited" | "failed">("idle");
  // Сколько ждать до следующей попытки — так, как написал сервер.
  const [limit, setLimit] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("busy");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.status === 401) {
        setState("wrong");
        return;
      }
      if (res.status === 429) {
        setLimit((await res.text()).trim() || "Слишком много попыток входа — попробуйте позже.");
        setState("limited");
        return;
      }
      if (!res.ok) throw new Error(res.statusText);
      // Галочки отмечены — согласие на этом устройстве записано, второй раз его не спросят.
      saveConsent();
      window.location.replace(nextPath());
    } catch {
      setState("failed");
    }
  }

  return (
    <main className="grid h-full place-items-center overflow-y-auto p-4">
      <form onSubmit={submit} className="island grid w-full max-w-[360px] gap-4 p-6 max-sm:p-5">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 flex-none place-items-center rounded-[var(--r-ctl)] bg-primary text-primary-foreground shadow-[inset_0_-2px_0_rgb(0_0_0/.12)]">
            <ScalesIcon className="size-4" />
          </span>
          <span className="font-heading text-sm leading-5 font-bold tracking-[-0.01em]">Тендерный юрист</span>
        </div>
        <div className="grid gap-1">
          <h1 className="t-page">Вход</h1>
          <p className="text-[var(--ink-2)]">Приложение открыто по паролю. Его знает тот, кто прислал вам ссылку.</p>
        </div>
        <label className="grid gap-1.5">
          <span className="t-strong">Пароль</span>
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.currentTarget.value);
              if (state === "wrong" || state === "limited" || state === "failed") setState("idle");
            }}
            autoComplete="current-password"
            autoFocus
            required
            className="field"
          />
        </label>
        {state === "wrong" && (
          <Note tone="warn" icon={WarningIcon}>
            Неверный пароль. Проверьте раскладку клавиатуры и попробуйте ещё раз.
          </Note>
        )}
        {state === "limited" && (
          <Note tone="warn" icon={WarningIcon}>
            {limit}
          </Note>
        )}
        {state === "failed" && (
          <Note tone="warn" icon={WarningIcon}>
            Не получилось войти — проверьте интернет и попробуйте ещё раз.
          </Note>
        )}
        <ConsentChecks processing={agreed} transfer={transfer} onProcessing={setAgreed} onTransfer={setTransfer} />
        <button type="submit" disabled={state === "busy" || !password || !agreed || !transfer} className="btn btn-lg">
          {state === "busy" ? "Вхожу…" : "Войти"}
        </button>
        <p className="t-caption text-[var(--ink-3)]">
          Нажимая «Войти», вы принимаете {doc("/terms", "условия использования")}. Как сервис обращается с данными — в{" "}
          {doc("/privacy", "политике")}. Владелец сервиса — на странице {doc("/contacts", "«Контакты»")}.
        </p>
      </form>
    </main>
  );
}
