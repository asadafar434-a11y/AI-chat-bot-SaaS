"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/badge";
import { DocumentIcon, DownloadIcon, WarningIcon } from "@/components/icons";
import { Note } from "@/components/note";
import { SourceQuote } from "@/components/purchase-bits";
import { usePurchase } from "@/components/purchase-provider";
import { fileRows, submitItems, toggleReady } from "@/lib/application-files";
import { FILE_FORMATS, type FileFormat } from "@/lib/file-format";
import { plural } from "@/lib/plural";
import { filledCount, PROFILE_KEYS } from "@/lib/profile";
import { stepsOf } from "@/lib/steps";
import { useApplicationFilesOf } from "@/lib/use-application-files";
import { PART_TITLES, partsOf } from "@/lib/tp-parts";

export type { Downloading } from "@/lib/use-application-files";

// Скачивание частей заявки — на шаге «Пакет» и в документе ТП одно и то же. Сама работа — в lib/use-application-files.ts:
// её же использует прототип на Vite, у которого свой провайдер закупки.
export const useApplicationFiles = () => useApplicationFilesOf(usePurchase());

// Строки содержимого — с разделителями; на узком окне бейдж уходит под название, кнопка остаётся справа.
const FILE_ROW =
  "grid grid-cols-[32px_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1.5 py-2.5 @max-[520px]:grid-cols-[32px_minmax(0,1fr)_auto]";

// Шаг «Пакет»: файлы, которые пишет приложение, — скачать по одному или архивом; ниже — что требует заказчик,
// с отметками готовности. Раньше это было окно «Документы заявки» поверх закупки.
export function PackageFiles({ format = "docx" }: { format?: FileFormat }) {
  const { purchase, update } = usePurchase();
  const files = useApplicationFiles();
  const [quote, setQuote] = useState<string | null>(null);
  const tp = purchase.tp;
  const review = stepsOf(purchase)[3];
  const busy = files.downloading !== null || !files.meReady;
  const rows = fileRows(purchase, {
    missing: files.profile ? PROFILE_KEYS.length - filledCount(files.profile) : 0,
    evidence: {
      experience: files.myDocs.filter((d) => d.kinds.includes("experience")).length,
      staff: files.myDocs.filter((d) => d.kinds.includes("staff")).length,
    },
    writing: files.writing,
  });
  const items = submitItems(purchase);
  const ready = items.filter((i) => i.ready).length;
  const count = tp ? partsOf(tp.form, purchase.criteria, purchase.kind).length : 1;

  return (
    <>
      <section aria-labelledby="files-made" className="island @container grid gap-1 px-[var(--pad)] pb-3 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h3 id="files-made" className="t-section">
            Состав пакета · {count} док.
          </h3>
          <button type="button" onClick={() => tp && void files.downloadAll(tp, format)} disabled={busy || !tp} className="btn btn-xs">
            <DownloadIcon />
            {files.downloading === "all" ? (files.writing ? `Пишу: ${PART_TITLES[files.writing]}…` : "Собираю архив…") : "Всё архивом · ZIP"}
          </button>
        </div>
        <p className="t-caption text-[var(--ink-3)]">Файлы, которые пишу я · {`${count} ${plural(count, "файл", "файла", "файлов")} ${FILE_FORMATS[format].label}`}</p>
        <ul className="divide-y divide-[var(--line)]">
          {rows.map((row) => (
            <li key={row.part} className={FILE_ROW}>
              <span aria-hidden className="law law-icon @max-[520px]:row-span-2 @max-[520px]:self-start">
                <DocumentIcon className="size-4" />
              </span>
              <span className="grid min-w-0 gap-0.5">
                {row.part === "tp" && tp ? (
                  <Link href={`/p/${purchase.id}/tp`} className="t-strong justify-self-start underline decoration-[var(--edge-2)] underline-offset-4 hover:decoration-current">
                    {row.title}
                  </Link>
                ) : (
                  <span className="t-strong">{row.title}</span>
                )}
                <span className="t-caption text-[var(--ink-3)]">{row.sub}</span>
              </span>
              <Badge {...row.badge} className="justify-self-end @max-[520px]:col-start-2 @max-[520px]:row-start-2 @max-[520px]:justify-self-start" />
              {row.action === "compose" ? (
                <Link href={review.href} className="btn btn-line btn-xs @max-[520px]:col-start-3 @max-[520px]:row-span-2 @max-[520px]:row-start-1">
                  Составить
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => tp && void files.downloadPart(tp, row.part, { format })}
                  disabled={busy || !tp}
                  className="btn btn-line btn-xs @max-[520px]:col-start-3 @max-[520px]:row-span-2 @max-[520px]:row-start-1"
                >
                  {files.downloading === row.part ? (files.writing === row.part ? "Пишу…" : "Собираю…") : "Скачать"}
                </button>
              )}
            </li>
          ))}
          {!tp && (
            <li className="py-2.5 text-[var(--ink-3)]">
              Анкета, декларация и предложение о цене появятся, когда составите документы на шаге «Проверка»: форму заявки беру
              из документов закупки.
            </li>
          )}
        </ul>
        {files.error && (
          <Note tone="warn" icon={WarningIcon} className="mt-2">
            {files.error}
          </Note>
        )}
        {files.note && (
          <Note tone="info" className="mt-2">
            {files.note}
          </Note>
        )}
      </section>

      <section aria-labelledby="files-ask" className="island grid gap-1 px-[var(--pad)] pb-3 pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 id="files-ask" className="t-section">
            Что требует заказчик
          </h3>
          {items.length > 0 && <span className="t-caption text-[var(--ink-3)]">{`готово ${ready} из ${items.length}`}</span>}
        </div>
        {items.length === 0 ? (
          <p className="text-[var(--ink-3)]">
            Перечня документов в документах закупки не нашлось — сверьтесь с извещением: что подать, обычно сказано в требованиях к заявке.
          </p>
        ) : (
          <>
            <p className="t-caption text-[var(--ink-3)]">Всё, что заказчик просит приложить. Часть закрывают файлы выше — отметьте, что уже готово.</p>
            <ul className="divide-y divide-[var(--line)]">
              {items.map((item, i) => (
                <li key={`${i}:${item.text}`} className="grid gap-1 py-2.5">
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={item.ready}
                      onChange={() => update({ submitReady: toggleReady(purchase, item.text) })}
                      className="mt-0.5 size-4 flex-none accent-[var(--brand)]"
                    />
                    <span className={`t-read ${item.ready ? "text-[var(--ink-3)] line-through decoration-[var(--edge-2)]" : ""}`}>{item.text}</span>
                  </label>
                  <div className="pl-[26px]">
                    <SourceQuote
                      source={item.source || "цитата"}
                      quote={item.quote}
                      verified={item.verified}
                      what="пункт"
                      open={quote === `submit-${i}`}
                      onToggle={() => setQuote(quote === `submit-${i}` ? null : `submit-${i}`)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

    </>
  );
}
