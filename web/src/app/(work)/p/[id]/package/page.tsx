"use client";

import Link from "next/link";
import { PackageFiles } from "@/components/application-files";
import { NextStep, StepIntro, TabBody } from "@/components/purchase-view";
import { Soon } from "@/components/soon";
import { rubShort } from "@/lib/price-calc";
import { PRICE_APP, PRICE_EXPERT } from "@/lib/pricing";

// Шаг 5 «Пакет», как в прототипе: файлы заявки — по одному или архивом, что требует заказчик — с отметками готовности.
// Оплата заявки и проверка специалистом в приложении пока не работают: для них нужен сервер — они помечены «скоро».
export default function PackagePage() {
  return (
    <TabBody>
      <StepIntro>
        Шаг 5 — пакет заявки. Скачайте файлы Word по одному или архивом и отметьте, что из списка заказчика уже собрано.
        Потом подпишите заявку электронной подписью и подайте на площадке.
      </StepIntro>

      <PackageFiles />

      <section aria-label="Скоро" className="grid gap-2 sm:grid-cols-2">
        <div className="island grid content-start gap-1 px-[var(--pad)] py-3">
          <p className="t-section flex flex-wrap items-center gap-2">
            Оплата заявки · {rubShort(PRICE_APP)}
            <Soon />
          </p>
          <p className="text-[var(--ink-2)]">
            Пакеты на 5 и 10 заявок — со скидкой, подробнее — в{" "}
            <Link href="/tariffs" className="link">
              «Тарифах»
            </Link>
            . Пока оплаты нет — документы скачиваются бесплатно.
          </p>
        </div>
        <div className="island grid content-start gap-1 px-[var(--pad)] py-3">
          <p className="t-section flex flex-wrap items-center gap-2">
            Проверка специалистом · {rubShort(PRICE_EXPERT)}
            <Soon />
          </p>
          <p className="text-[var(--ink-2)]">
            Тендерный юрист сверит комплект с извещением перед подачей. Для переписки с юристом нужен сервер — его пока нет.
          </p>
        </div>
      </section>

      <NextStep from="package" />
    </TabBody>
  );
}
