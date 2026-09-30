"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/icons";
import { ComposeCard, useCompose } from "@/components/compose-documents";
import { FieldMap } from "@/components/field-map";
import { OwnCheck } from "@/components/own-check";
import { usePurchase } from "@/components/purchase-provider";
import { TabBody } from "@/components/purchase-view";

// Шаг 4 «Проверка», как в прототипе: документы заявки составлены — по карте полей видно, что заполнено само,
// что вписать, подтвердить или исправить; не составлены — главная кнопка шага их составляет. Кто готовил
// заявку сам, проверяет её файлом — кнопкой внизу (решение владельца 29.09.2026).
export default function ReviewPage() {
  const { purchase } = usePurchase();
  const compose = useCompose();
  // Своя заявка уже проверялась — её итог сразу на виду.
  const [own, setOwn] = useState(Boolean(purchase.check));

  return (
    <TabBody>
      <div className="px-[var(--pad)] py-1">
        <h1 className="t-page">Проверка перед подачей</h1>
        <p className="mt-1 max-w-[80ch] text-[var(--ink-2)]">
          Дописать и проверить заявку. Всё, что нашлось в документах закупки и в «Реквизитах», уже вписано; здесь — то, что
          знаете только вы, и то, что нужно подтвердить.
        </p>
      </div>

      {purchase.tp && !compose.working ? <FieldMap /> : <ComposeCard state={compose} />}

      {own ? (
        <>
          <h3 className="t-section px-[var(--pad)] pt-2">Своя заявка — проверка файлом</h3>
          <OwnCheck />
        </>
      ) : (
        <div className="island flex flex-wrap items-center justify-between gap-3 px-[var(--pad)] py-3">
          <div className="grid min-w-0 gap-0.5">
            <p className="t-section">Готовили заявку сами?</p>
            <p className="max-w-[70ch] text-[var(--ink-2)]">
              Загрузите её файлом — сверю с извещением и ТЗ по каждому пункту и скажу, за что могут отклонить.
            </p>
          </div>
          <button type="button" onClick={() => setOwn(true)} className="btn btn-line">
            Проверить свою заявку файлом
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 px-[var(--pad)] pb-2">
        <Link href={`/p/${purchase.id}/price`} className="btn btn-line">
          <ArrowLeftIcon />
          Цена
        </Link>
        <Link href={`/p/${purchase.id}/package`} className="btn">
          Пакет документов
          <ArrowRightIcon />
        </Link>
      </div>
    </TabBody>
  );
}
