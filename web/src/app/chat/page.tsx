"use client";

import { GeneralChat } from "@/components/general-chat";
import { PageBody, PageHeader } from "@/components/page-header";

// «Спросить ИИ» — общий вопрос по 44-ФЗ и 223-ФЗ. Сам разговор — в components/general-chat.tsx, его же открывает
// робот в правом нижнем углу любого экрана.
export default function GeneralChatPage() {
  return (
    <>
      <PageHeader title="Спросить ИИ" sub="Общие вопросы по 44-ФЗ и 223-ФЗ — ответ со ссылкой на статью" />
      <PageBody fill>
        {/* Место под полосу прокрутки справа — как у шапки: правый край острова под кнопками шапки */}
        <div className="-mx-2 -mb-2 -mt-1 flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2 pt-1 [scrollbar-gutter:stable]">
          <GeneralChat />
        </div>
      </PageBody>
    </>
  );
}
