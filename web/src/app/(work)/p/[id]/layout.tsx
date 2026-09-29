"use client";

import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import { PurchaseProvider } from "@/components/purchase-provider";
import { PurchaseView } from "@/components/purchase-view";

// Закупка загружается один раз на все её шаги и инструменты: загрузка, анализ, цена, проверка, пакет, поиск и вопросы.
export default function PurchaseLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  return (
    <PurchaseProvider key={id} id={id}>
      <PurchaseView>{children}</PurchaseView>
    </PurchaseProvider>
  );
}
