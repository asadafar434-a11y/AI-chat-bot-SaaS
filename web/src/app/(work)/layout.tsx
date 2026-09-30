import type { ReactNode } from "react";
import { PageBody } from "@/components/page-header";

// Закупка открывается на всю ширину, как в прототипе: сверху шапка с шагами, под ней тело шага.
// Список закупок — главный экран «Мои закупки» (app/page.tsx), рядом с закупкой его не держим.
export default function WorkLayout({ children }: { children: ReactNode }) {
  return (
    <PageBody fill>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </PageBody>
  );
}
