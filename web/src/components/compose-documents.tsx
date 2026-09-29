"use client";

import { useState } from "react";
import Link from "next/link";
import { useApplicationFiles } from "@/components/application-files";
import { WarningIcon } from "@/components/icons";
import { Note } from "@/components/note";
import { scrollToTop } from "@/components/page-header";
import { usePurchase } from "@/components/purchase-provider";
import { WorkingSteps } from "@/components/working-steps";
import { samplesOf } from "@/lib/me-store";
import { plural } from "@/lib/plural";
import { aiHeaders } from "@/lib/purchase";
import { sampleTp } from "@/lib/sample-purchase";
import type { TpResult } from "@/lib/tp";

// Составить документы заявки: ИИ находит в документах закупки форму заявки и заполняет её — техническое предложение,
// анкету, декларацию. Раньше это был шаг «Техническое предложение»; теперь — начало шага «Проверка»
// (решение владельца 29.09.2026), а сам документ ТП открывается из «Пакета».

export const COMPOSE_STEPS = [
  "Ищу в документах форму заявки…",
  "Читаю ТЗ…",
  "Выписываю товары и характеристики…",
  "Готовлю предложение по пунктам…",
  "Сверяю цитаты с ТЗ…",
];

export function useCompose() {
  const { purchase, documents, update } = usePurchase();
  const files = useApplicationFiles();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const samples = samplesOf(files.myDocs, "tp");

  async function compose() {
    setWorking(true);
    setError(null);
    try {
      let next: TpResult;
      if (purchase.sample) {
        next = sampleTp();
      } else {
        const res = await fetch("/api/tp", {
          method: "POST",
          headers: aiHeaders(purchase.id),
          body: JSON.stringify({ documents, samples: samples.map(({ name, text }) => ({ name, text })) }),
        });
        if (!res.ok) throw new Error((await res.text()) || "Не удалось составить черновик.");
        next = await res.json();
      }
      // Черновик ИИ сохраняется отдельно: по нему карта полей видит, какие жёлтые места участник уже вписал.
      update({ tp: next, tpDraft: next });
      scrollToTop();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  return { compose, working, error, samples: samples.length };
}

export function SamplesLine({ count }: { count: number }) {
  return (
    <p className="t-body text-[var(--ink-3)]">
      {count > 0 ? (
        <>
          {`Пишу по вашим техническим предложениям: ${count} ${plural(count, "документ", "документа", "документов")} из `}
          <Link href="/me/documents" className="link">
            «Образцов и реквизитов»
          </Link>
          .
        </>
      ) : (
        <>
          Черновик будет в общем стиле.{" "}
          <Link href="/me/documents" className="link">
            Загрузите свои документы
          </Link>{" "}
          — и ТП будет написано так, как пишете вы.
        </>
      )}
    </p>
  );
}

// Документов ещё нет: что сделаю и главная кнопка шага. Пока ИИ пишет — ход работы.
export function ComposeCard({ state }: { state: ReturnType<typeof useCompose> }) {
  const { purchase } = usePurchase();
  if (state.working) {
    return (
      <div className="island px-[var(--pad)]">
        <WorkingSteps steps={COMPOSE_STEPS} />
      </div>
    );
  }
  return (
    <div className="island grid justify-items-start gap-3 p-[var(--pad)]">
      <p className="t-section">Документы заявки ещё не составлены</p>
      <p className="max-w-[70ch] text-[var(--ink-2)]">
        Найду в документах закупки форму заявки и заполню её, как тендерный юрист: техническое предложение с товарами
        и предложением по пунктам ТЗ, анкету, декларацию, цену. Вам останется вписать то, что знаете только вы, — здесь же,
        по списку.
      </p>
      {!purchase.sample && <SamplesLine count={state.samples} />}
      {state.error && (
        <Note tone="warn" icon={WarningIcon}>
          {state.error}
        </Note>
      )}
      <button type="button" onClick={() => void state.compose()} className="btn btn-lg">
        Составить документы
      </button>
    </div>
  );
}
