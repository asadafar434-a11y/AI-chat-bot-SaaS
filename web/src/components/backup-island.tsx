"use client";

import { useRef, useState } from "react";
import { CheckIcon, DownloadIcon, UploadIcon, WarningIcon } from "@/components/icons";
import { Island } from "@/components/island";
import { Note } from "@/components/note";
import { exportBackup, restoreBackup } from "@/lib/backup";
import { parseBackup } from "@/lib/backup-format";
import { plural } from "@/lib/plural";
import { saveFile } from "@/lib/save-file";

type Outcome = { tone: "ok" | "warn" | "info"; text: string };

// «1 закупка, 2 образца и реквизиты» — только то, что есть.
function contents({ purchases, samples, profile }: { purchases: number; samples: number; profile: boolean }) {
  const parts = [
    purchases > 0 && `${purchases} ${plural(purchases, "закупка", "закупки", "закупок")}`,
    samples > 0 && `${samples} ${plural(samples, "образец", "образца", "образцов")}`,
    profile && "реквизиты",
  ].filter((part): part is string => Boolean(part));
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} и ${parts.at(-1)}` : (parts[0] ?? "");
}

// Копия файлом: способ выгрузить данные организации (PostgreSQL + S6), перенести их
// и восстановить после удаления.
export function BackupIsland({ onRestored }: { onRestored?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function save() {
    setBusy(true);
    setOutcome(null);
    try {
      const { backup, ...counts } = await exportBackup();
      const inside = contents(counts);
      if (!inside) {
        setOutcome({ tone: "info", text: "Сохранять пока нечего: в организации нет ни закупок, ни образцов, ни реквизитов." });
        return;
      }
      const name = `Тендерный юрист — копия ${new Date(backup.savedAt).toLocaleDateString("ru-RU")}.json`;
      saveFile(new Blob([JSON.stringify(backup)], { type: "application/json" }), name);
      setOutcome({ tone: "ok", text: `Копия сохранена — файл «${name}» в загрузках браузера. В нём ${inside}.` });
    } catch {
      setOutcome({ tone: "warn", text: "Не удалось прочитать данные — копия не сохранилась. Обновите страницу и попробуйте ещё раз." });
    } finally {
      setBusy(false);
    }
  }

  async function load(file: File) {
    setBusy(true);
    setOutcome(null);
    try {
      let raw: unknown = null;
      try {
        raw = JSON.parse(await file.text());
      } catch {
        // Не JSON — parseBackup скажет, что это не копия.
      }
      const parsed = parseBackup(raw);
      if (!parsed.ok) {
        setOutcome({ tone: "warn", text: parsed.reason });
        return;
      }
      const added = contents(await restoreBackup(parsed.dump));
      setOutcome(
        added
          ? { tone: "ok", text: `Из копии добавлено: ${added}. То, что уже было, не тронуто.` }
          : { tone: "info", text: "Всё из копии уже есть — ничего не менял." }
      );
      onRestored?.();
    } catch {
      setOutcome({ tone: "warn", text: "Не удалось записать данные — возможно, на диске кончилось место. Освободите место и загрузите копию ещё раз." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Island id="backup" title="Копия данных" sub="Закупки, документы, реквизиты и образцы">
      <div className="grid gap-3 px-[var(--pad)] pb-4 pt-1">
        <p className="max-w-[70ch] text-[var(--ink-2)]">
          Данные хранятся на сервере, в вашей организации. Копия файлом — способ выгрузить их, перенести в другую
          организацию или восстановить после удаления. В файле реквизиты и тексты документов — храните его так же
          бережно, как сами документы.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void save()} disabled={busy} className="btn btn-line">
            <DownloadIcon />
            Сохранить копию
          </button>
          <button type="button" onClick={() => input.current?.click()} disabled={busy} className="btn btn-line">
            <UploadIcon />
            Загрузить копию
          </button>
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (file) void load(file);
            }}
          />
        </div>
        {/* Область объявлений стоит всегда: так экранный диктор прочитает итог, когда он появится. */}
        <div aria-live="polite" className="empty:hidden">
          {outcome && (
            <Note tone={outcome.tone} icon={outcome.tone === "ok" ? CheckIcon : outcome.tone === "warn" ? WarningIcon : undefined}>
              {outcome.text}
            </Note>
          )}
        </div>
      </div>
    </Island>
  );
}
