"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WarningIcon } from "@/components/icons";
import { FileDrop } from "@/components/file-drop";
import { Note } from "@/components/note";
import { PageBody, PageHeader } from "@/components/page-header";
import { WorkingSteps } from "@/components/working-steps";
import { extractRequirements, fromRequirements, type Purchase } from "@/lib/purchase";
import { savePurchaseWithDocuments } from "@/lib/purchase-store";
import { readDocuments } from "@/lib/read-documents";
import { openSamplePurchase } from "@/lib/sample-purchase";

const WORKING_STEPS = [
  "Читаю документы…",
  "Смотрю, кто может участвовать…",
  "Выписываю, что подать в заявке…",
  "Разбираю требования ТЗ…",
  "Проверяю сроки и суммы…",
  "Сверяю цитаты с документами…",
];

export default function NewPurchasePage() {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(files: File[]) {
    setWorking(true);
    setError(null);
    try {
      const { documents, failed } = await readDocuments(files);
      // Номер закупки — до разбора: по нему сервер считает бюджет ИИ этой заявки.
      const id = crypto.randomUUID();
      const result = await extractRequirements(documents, id);
      const purchase: Purchase = {
        ...fromRequirements(result),
        id,
        createdAt: new Date().toISOString(),
        files: documents.map((d) => d.name),
        unreadable: failed,
      };
      await savePurchaseWithDocuments(purchase, documents);
      router.replace(`/p/${purchase.id}`);
    } catch (e) {
      setError((e as Error).message);
      setWorking(false);
    }
  }

  async function sample() {
    setError(null);
    try {
      router.push(`/p/${await openSamplePurchase()}`);
    } catch {
      setError("Не получилось открыть пример: браузер не дал сохранить данные.");
    }
  }

  return (
    <>
      <PageHeader title="Новая закупка" sub="Начало пути: загрузите документы — дальше шаги подскажут, что делать" />
      <PageBody>
        <section className="island max-w-[880px] p-[var(--pad)]">
          {working ? (
            <WorkingSteps steps={WORKING_STEPS} />
          ) : (
            <div className="grid gap-3">
              <p className="max-w-[70ch] text-[var(--ink-2)]">
                Загрузите извещение, ТЗ и проект контракта — выпишу требования и сроки. Потом закупка откроется на шаге 1 «Требования», а дальше будут техническое предложение и проверка заявки.
              </p>
              {error && (
                <Note tone="warn" icon={WarningIcon}>
                  {error}
                </Note>
              )}
              <FileDrop
                hint="Перетащите сюда документы закупки — можно сразу несколько: PDF, Word, Excel, сканы и фото"
                button="Загрузить документы"
                onFiles={(files) => void create(files)}
                onSample={() => void sample()}
              />
            </div>
          )}
        </section>
      </PageBody>
    </>
  );
}
