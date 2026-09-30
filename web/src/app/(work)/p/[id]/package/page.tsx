"use client";

import { useState } from "react";
import Link from "next/link";
import { PackageFiles } from "@/components/application-files";
import { ArrowLeftIcon, CheckIcon, UserCheckIcon, WalletIcon, WarningIcon } from "@/components/icons";
import { Note } from "@/components/note";
import { usePurchase } from "@/components/purchase-provider";
import { NextStep, TabBody } from "@/components/purchase-view";
import { Soon } from "@/components/soon";
import { submitItems } from "@/lib/application-files";
import { FILE_FORMATS, type FileFormat } from "@/lib/file-format";
import { rubShort } from "@/lib/price-calc";
import { PRICE_APP, PRICE_EXPERT } from "@/lib/pricing";
import { stepsOf } from "@/lib/steps";

// Шаг 5 «Пакет», как в прототипе: готова ли заявка к подаче, оплата, формат файлов, состав пакета — по одному или
// архивом — и проверка специалистом. Оплата и специалист пока не работают (для них нужен сервер) — помечены «скоро»;
// документы скачиваются бесплатно, формат только DOCX.
export default function PackagePage() {
  const { purchase } = usePurchase();
  const [format, setFormat] = useState<FileFormat>("docx");
  const review = stepsOf(purchase)[3];
  const items = submitItems(purchase);
  const ready = items.filter((i) => i.ready).length;
  const docsOpen = items.length > 0 && ready < items.length;
  const notReady = review.state !== "done" || docsOpen;

  return (
    <TabBody>
      <div className="px-[var(--pad)] py-1">
        <h1 className="t-page">Пакет документов</h1>
        <p className="mt-1 max-w-[80ch] text-[var(--ink-2)]">
          Скачайте файлы Word по одному или архивом и отметьте, что из списка заказчика уже собрано. Потом подпишите заявку
          электронной подписью и подайте на площадке.
        </p>
      </div>

      {purchase.tp && notReady && (
        <Note tone="warn" icon={WarningIcon}>
          Заявка ещё не готова к подаче: {review.state !== "done" ? `${review.status}` : "поля заполнены"}
          {items.length > 0 ? `; документов отмечено готовыми: ${ready} из ${items.length}` : ""}.{" "}
          <Link href={review.href} className="link">
            Шаг 4, проверка
          </Link>
        </Note>
      )}

      <section aria-label="Оплата" className="island flex flex-wrap items-center gap-x-4 gap-y-3 px-[var(--pad)] py-3.5">
        <span aria-hidden className="grid size-10 flex-none place-items-center rounded-full bg-[var(--paper-2)] text-[var(--ink-2)]">
          <WalletIcon className="size-5" />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="t-strong flex flex-wrap items-center gap-2">
            Заявка под ключ · {rubShort(PRICE_APP)}
            <Soon />
          </p>
          <p className="text-[var(--ink-2)]">
            Оплаты пока нет — документы скачиваются бесплатно. Пакет 5 или 10 заявок — дешевле, подробнее в{" "}
            <Link href="/tariffs" className="link">
              «Тарифах»
            </Link>
            .
          </p>
        </div>
        <button type="button" disabled className="btn">
          Оплатить {rubShort(PRICE_APP)}
        </button>
      </section>

      <div role="group" aria-label="Формат файлов" className="flex flex-wrap items-center gap-2 px-[var(--pad)]">
        <span className="t-over text-[var(--ink-3)]">Формат:</span>
        {(Object.keys(FILE_FORMATS) as FileFormat[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={format === key}
            title={key === "pdf" ? "PDF — для подписи и подачи: тот же текст и жёлтые места, что в Word" : "Word — можно править и дописывать жёлтые места"}
            onClick={() => setFormat(key)}
            className={`t-label rounded-[var(--r-ctl)] px-3 py-1.5 ${
              format === key ? "bg-primary text-[var(--on-brand)]" : "border border-[var(--line)] bg-card text-[var(--ink-2)] hover:bg-[var(--paper-2)]"
            }`}
          >
            {key === "docx" ? "DOCX" : "PDF"}
          </button>
        ))}
        <span className="t-label inline-flex items-center gap-2 rounded-[var(--r-ctl)] border border-[var(--line)] bg-card px-3 py-1.5 text-[var(--ink-3)] opacity-70">
          ODT <Soon />
        </span>
      </div>

      <div className="@container">
        <div className="grid items-start gap-2 @min-[880px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="grid min-w-0 gap-2">
            <PackageFiles format={format} />
          </div>

          <section aria-label="Проверка специалистом" className="island grid gap-3 p-[var(--pad)]">
            <p className="t-section flex flex-wrap items-center gap-2">
              <UserCheckIcon className="size-4" />
              Проверка специалистом
              <Soon />
            </p>
            <p className="text-[var(--ink-2)]">
              Пакет проверил ИИ. Тендерный юрист вручную сверит документы с извещением и даст заключение перед подачей. Для
              переписки с юристом нужен сервер — его пока нет.
            </p>
            <ul className="grid gap-1.5">
              {["Ручная сверка с извещением", "То, чего не видит ИИ: сроки, подписи, формы", "Заключение за 2 часа"].map((text) => (
                <li key={text} className="flex items-start gap-2 text-[var(--ink-2)]">
                  <CheckIcon className="mt-0.5 size-4 flex-none text-[var(--ok)]" />
                  {text}
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between gap-3 pt-1">
              <span className="t-caption text-[var(--ink-3)]">Разовая услуга</span>
              <span className="[font:600_20px/28px_var(--mono)] tabular-nums">{rubShort(PRICE_EXPERT)}</span>
            </div>
            <button type="button" disabled className="btn bg-brand-gradient text-white">
              Отправить специалисту · {rubShort(PRICE_EXPERT)}
            </button>
          </section>
        </div>
      </div>

      <NextStep from="package" />

      <div className="px-[var(--pad)] pb-2">
        <Link href={`/p/${purchase.id}/check`} className="btn btn-line">
          <ArrowLeftIcon />
          Проверка
        </Link>
      </div>
    </TabBody>
  );
}
