"use client";

import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import { ApplicationFiles } from "@/components/application-files";
import { PurchaseProvider } from "@/components/purchase-provider";
import { PurchaseView } from "@/components/purchase-view";

// Закупка загружается один раз на все её вкладки: требования, ТП и вопросы. Окно «Документы заявки» — тоже одно на все.
export default function PurchaseLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  return (
    <PurchaseProvider key={id} id={id}>
      <ApplicationFiles>
        <PurchaseView>{children}</PurchaseView>
      </ApplicationFiles>
    </PurchaseProvider>
  );
}
