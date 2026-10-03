"use client";

import { useState } from "react";
import Link from "next/link";
import { WarningIcon } from "@/components/icons";
import { Island } from "@/components/island";
import { Note } from "@/components/note";
import { wipeAll } from "@/lib/wipe";

type State = "idle" | "confirm" | "wiping" | "blocked" | "failed";

// Всё сразу, без письма владельцу: удаляются данные на сервере (в объёме роли: владелец —
// данные организации, участник — личные) и локальное зеркало этого браузера.
export function WipeIsland() {
  const [state, setState] = useState<State>("idle");

  async function wipe() {
    setState("wiping");
    try {
      if ((await wipeAll()) === "blocked") {
        setState("blocked");
        return;
      }
      // Приложение открывается заново, с чистого листа: с вопроса о согласии. Нужна полная перезагрузка, а не переход
      // роутером — она сбрасывает открытые соединения с базами и всё, что приложение держит в памяти.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/");
    } catch {
      setState("failed");
    }
  }

  const asking = state === "confirm" || state === "wiping";

  return (
    <Island id="wipe" title="Удалить все данные" sub="На сервере и в этом браузере">
      <div className="grid gap-3 px-[var(--pad)] pb-4 pt-1">
        <p className="max-w-[70ch] text-[var(--ink-2)]">
          Владелец удаляет данные организации — закупки с документами и черновиками, реквизиты, образцы и базу доказательств;
          участник — только свои персональные данные (профиль и контакты). Также очищаются данные этого браузера и отметка о
          согласии. Вернуть удалённое можно будет только из копии — сохраните её выше. То, что уже отправлено ИИ, хранится у
          Anthropic по её условиям — подробнее в{" "}
          <Link href="/privacy" className="link">
            политике
          </Link>
          .
        </p>
        {asking ? (
          <div className="grid gap-2.5">
            <p className="t-strong">Удалить данные? Вернуть их можно будет только из копии.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void wipe()} disabled={state === "wiping"} className="btn btn-danger btn-xs">
                {state === "wiping" ? "Удаляю…" : "Удалить всё"}
              </button>
              {/* Фокус — на безопасном ответе: случайный Enter ничего не удалит. */}
              <button type="button" autoFocus onClick={() => setState("idle")} disabled={state === "wiping"} className="btn btn-line btn-xs">
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setState("confirm")} className="link link-quiet link-del justify-self-start">
            Удалить все мои данные
          </button>
        )}
        <div aria-live="polite" className="empty:hidden">
          {state === "blocked" && (
            <Note tone="warn" icon={WarningIcon}>
              Сервис открыт ещё в другой вкладке — закройте её: удаление закончится, когда она закроется. Потом обновите эту страницу.
            </Note>
          )}
          {state === "failed" && (
            <Note tone="warn" icon={WarningIcon}>
              Не удалось удалить данные. Проверьте соединение и повторите; данные этого браузера можно удалить в его
              настройках — «Очистить данные сайта».
            </Note>
          )}
        </div>
      </div>
    </Island>
  );
}
