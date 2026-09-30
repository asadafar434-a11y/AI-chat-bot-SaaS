"use client";

import { AttachIcon } from "@/components/icons";
import { Island } from "@/components/island";
import { Warnings } from "@/components/note";
import { usePurchase } from "@/components/purchase-provider";
import { NextStep, PurchaseFiles, StepIntro, TabBody, useAddDocuments } from "@/components/purchase-view";
import { scanWarning } from "@/lib/read-documents";

// Шаг 1 «Загрузка», как в прототипе: документы закупки, из которых выписаны требования, — прочитанные и нет.
// Добавили файл — закупка перечитывается целиком (это делает шапка закупки, purchase-view.tsx).
export default function FilesPage() {
  const { purchase, documents } = usePurchase();
  const addDocuments = useAddDocuments();
  const count = purchase.files.length + purchase.unreadable.length;

  return (
    <TabBody>
      <StepIntro>
        Шаг 1 — документы закупки с площадки: извещение, техническое задание, проект контракта. Добавите файл — перечитаю
        закупку целиком: требования, сроки и цену.
      </StepIntro>

      <Warnings
        items={[
          purchase.unreadable.length > 0 &&
            "Файл, который не прочитан, не участвует в разборе: пересохраните его в PDF или DOCX и добавьте ещё раз.",
          scanWarning(documents),
        ]}
      />

      <Island
        id="files-list"
        level={3}
        title="Документы закупки"
        count={count}
        action={
          <button type="button" onClick={addDocuments} className="btn btn-line btn-xs">
            <AttachIcon />
            Добавить документы
          </button>
        }
      >
        <div className="px-[var(--pad)] pb-3 pt-1">
          {count ? (
            <PurchaseFiles purchase={purchase} documents={documents} />
          ) : (
            <p className="text-[var(--ink-3)]">Документов нет — добавьте извещение и техническое задание.</p>
          )}
        </div>
      </Island>

      <NextStep from="upload" />
    </TabBody>
  );
}
