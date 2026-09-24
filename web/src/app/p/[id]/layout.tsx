"use client";

import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import { PurchaseProvider } from "@/components/purchase-provider";

// Закупка загружается один раз на все её экраны: требования, ТП и вопросы.
export default function PurchaseLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  return (
    <PurchaseProvider key={id} id={id}>
      {children}
    </PurchaseProvider>
  );
}
