"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRightIcon, CheckIcon, DocumentIcon, LinkIcon, UploadIcon } from "@/components/icons";
import { Warnings } from "@/components/note";
import { usePurchase } from "@/components/purchase-provider";
import { PurchaseFiles, TabBody, useAddDocuments } from "@/components/purchase-view";
import { Soon } from "@/components/soon";
import { dueLine } from "@/lib/deadline";
import { lawText } from "@/lib/dashboard";
import { plural } from "@/lib/plural";
import { scanWarning } from "@/lib/read-documents";

// Шаг 1 «Загрузка», как в прототипе: заголовок, карточка с зоной загрузки, список загруженного и то, что из
// документов распознано. Добавили файл — закупка перечитывается целиком (это делает шапка закупки, purchase-view.tsx).
export default function FilesPage() {
  const { purchase, documents } = usePurchase();
  const addDocuments = useAddDocuments();
  const [dragging, setDragging] = useState(false);
  const count = purchase.files.length + purchase.unreadable.length;
  const due = dueLine(purchase.deadline, true);
  const facts: [string, string][] = [
    ["Закон", lawText(purchase)],
    ["Начальная цена", purchase.price],
    ["Подать до", due ? due.head.replace(/^Подать /, "").replace(/^Приём заявок /, "") : ""],
    ["Заказчик", purchase.customer],
  ];

  return (
    <TabBody>
      <div className="px-[var(--pad)] py-1">
        <h1 className="t-page">Загрузка документации</h1>
        <p className="mt-1 max-w-[80ch] text-[var(--ink-2)]">
          Загрузите документы закупки с площадки — извещение, техническое задание, проект контракта. Распознаю состав и
          выпишу требования. Добавите файл — перечитаю закупку целиком.
        </p>
      </div>

      <Warnings
        items={[
          purchase.unreadable.length > 0 &&
            "Файл, который не прочитан, не участвует в разборе: пересохраните его в PDF или DOCX и добавьте ещё раз.",
          scanWarning(documents),
        ]}
      />

      <section className="island overflow-hidden p-0">
        <div
          title="Импорт по ссылке из ЕИС — в разработке. Сейчас скачайте файлы закупки с площадки и перетащите сюда."
          className="flex items-center gap-2 border-b border-[var(--line)] px-[var(--pad)] py-3 opacity-70"
        >
          <LinkIcon className="size-4 shrink-0 text-[var(--ink-3)]" />
          <input
            disabled
            aria-label="Ссылка на закупку в ЕИС"
            placeholder="Ссылка на закупку в ЕИС — zakupki.gov.ru/epz/order/notice/…"
            className="min-w-0 flex-1 cursor-not-allowed bg-transparent outline-none placeholder:text-[var(--ink-3)]"
          />
          <Soon />
        </div>

        <button
          type="button"
          onClick={() => addDocuments()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addDocuments([...e.dataTransfer.files]);
          }}
          className={`flex w-full cursor-pointer flex-col items-center justify-center gap-3 px-6 py-10 text-center ${
            dragging ? "bg-[var(--paper-2)]" : "hover:bg-[var(--hover)]"
          }`}
        >
          <span className="grid size-11 place-items-center rounded-full border border-[var(--line)] bg-[var(--paper-2)]">
            <UploadIcon className="size-5" />
          </span>
          <span className="grid gap-0.5">
            <span className="t-strong">Перетащите файлы сюда или нажмите для выбора</span>
            <span className="t-caption text-[var(--ink-3)]">PDF, Word, Excel, сканы и фото</span>
          </span>
        </button>
      </section>

      {count > 0 && (
        <section aria-labelledby="files-list" className="grid gap-2 px-[var(--pad)]">
          <div className="flex items-center justify-between gap-3">
            <h2 id="files-list" className="t-over text-[var(--ink-3)]">
              Загружено · {count} {plural(count, "файл", "файла", "файлов")}
            </h2>
            {purchase.unreadable.length === 0 && (
              <span className="t-caption inline-flex items-center gap-1.5 text-[var(--ok)]">
                <CheckIcon className="size-3.5" />
                Комплект распознан
              </span>
            )}
          </div>
          <PurchaseFiles purchase={purchase} documents={documents} />
        </section>
      )}

      {count === 0 && (
        <p className="flex items-center gap-2 px-[var(--pad)] text-[var(--ink-3)]">
          <DocumentIcon className="size-4" />
          Документов нет — добавьте извещение и техническое задание.
        </p>
      )}

      {facts.some(([, v]) => v) && (
        <section aria-labelledby="recognized" className="island grid gap-3 bg-[var(--paper-2)] p-[var(--pad)]">
          <h2 id="recognized" className="t-over text-[var(--ink-3)]">
            Распознанная закупка
          </h2>
          <p className="t-strong text-pretty">{purchase.subject || purchase.short}</p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            {facts
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="t-caption text-[var(--ink-3)]">{k}</dt>
                  <dd className="mt-0.5 font-mono text-[12px] break-words">{v}</dd>
                </div>
              ))}
          </dl>
        </section>
      )}

      <div className="flex justify-end">
        <Link href={`/p/${purchase.id}`} className="btn">
          Анализ документов
          <ArrowRightIcon />
        </Link>
      </div>
    </TabBody>
  );
}
