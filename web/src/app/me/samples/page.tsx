"use client";

import { useEffect, useState } from "react";
import { AlertTriangleIcon, FileTextIcon } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { BackLink } from "@/components/back-link";
import { FileDrop } from "@/components/file-drop";
import { Note } from "@/components/note";
import { PageTitle } from "@/components/page-title";
import { addSamples, deleteSample, listSamples, samplesForRequest, type Sample } from "@/lib/me-store";
import { plural } from "@/lib/plural";
import { readDocuments } from "@/lib/read-documents";

const pages = (text: string) => Math.max(1, Math.round(text.length / 2500));

// Образцы — настоящие поданные документы участника. По ним ИИ повторяет его структуру и формулировки.
export default function SamplesPage() {
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const reload = () => listSamples().then(setSamples, () => setError("Браузер не дал открыть образцы. Обновите страницу."));
  useEffect(() => {
    void reload();
  }, []);

  async function add(files: File[]) {
    setReading(true);
    setError(null);
    try {
      const { documents, failed } = await readDocuments(files);
      const addedAt = new Date().toISOString();
      await addSamples(documents.map((d) => ({ id: crypto.randomUUID(), name: d.name, text: d.text, addedAt })));
      if (failed.length) setError(`Не получилось прочитать: ${failed.map((f) => `${f.name} — ${f.reason}`).join("; ")}.`);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }

  async function remove(id: string) {
    setConfirm(null);
    try {
      await deleteSample(id);
      await reload();
    } catch {
      setError("Не получилось удалить образец — попробуйте ещё раз.");
    }
  }

  const used = new Set(samplesForRequest(samples ?? []).map((s) => s.id));

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-[680px] px-4 pb-10">
        <BackLink href="/me">Мои данные</BackLink>
        <PageTitle className="mt-4">Образцы документов</PageTitle>
        <p className="mt-3 max-w-[48ch] text-[17px] leading-[26px] text-[var(--ink-2)]">
          Загрузите свои технические предложения, которые вы уже подавали, — лучше те, по которым вас допустили. Новые будут написаны так же: ваша структура, ваши таблицы, ваши формулировки.
        </p>

        {error && (
          <Note tone="warn" icon={AlertTriangleIcon} className="mt-5">
            {error}
          </Note>
        )}

        {samples && samples.length > 0 && (
          <ul className="mt-6 overflow-hidden rounded-[var(--r-surface)] bg-card">
            {samples.map((s) => (
              <li key={s.id} className="grid gap-2 border-t border-border px-5 py-4 first:border-t-0">
                <div className="flex items-start gap-3">
                  <FileTextIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="break-words font-semibold">{s.name}</span>
                    <span className="text-[14px] text-muted-foreground">
                      {`≈ ${pages(s.text)} ${plural(pages(s.text), "страница", "страницы", "страниц")} · добавлен ${new Date(s.addedAt).toLocaleDateString("ru-RU")}`}
                      {used.has(s.id) ? "" : " · не используется: образцов уже достаточно"}
                    </span>
                  </div>
                  {confirm !== s.id && (
                    <button
                      type="button"
                      onClick={() => setConfirm(s.id)}
                      className="shrink-0 text-[14px] font-medium text-muted-foreground underline underline-offset-4 hover:text-destructive"
                    >
                      Удалить
                    </button>
                  )}
                </div>
                {confirm === s.id && (
                  <div className="flex flex-wrap items-center gap-2 pl-8">
                    <span className="text-[14.5px]">Удалить образец?</span>
                    <button
                      type="button"
                      onClick={() => void remove(s.id)}
                      className="min-h-9 rounded-[var(--r-ctl)] bg-[color-mix(in_oklab,var(--destructive)_14%,transparent)] px-4 font-semibold text-destructive"
                    >
                      Удалить
                    </button>
                    <button type="button" onClick={() => setConfirm(null)} className="min-h-9 rounded-[var(--r-ctl)] bg-muted px-4 font-semibold">
                      Отмена
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {reading ? (
          <p className="mt-8 animate-pulse text-lg font-semibold">Читаю файлы…</p>
        ) : (
          <FileDrop
            hint="Перетащите сюда свои технические предложения — PDF или Word, можно сразу несколько"
            button="Загрузить образцы"
            onFiles={(files) => void add(files)}
          />
        )}
      </main>
    </div>
  );
}
