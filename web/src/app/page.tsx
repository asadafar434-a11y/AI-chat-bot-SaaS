import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { AppHeader } from "@/components/app-header";

const SECTIONS = [
  {
    href: "/tp",
    title: "Техническое предложение",
    text: "Загрузите ТЗ — составлю черновик по каждому пункту и соберу файл Word.",
  },
  {
    href: "/chat",
    title: "Вопросы по закупке",
    text: "Отвечу по документам закупки со ссылкой на пункт и статью закона.",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-[680px] px-4 pb-10">
        <h1 className="mt-6 font-heading text-[clamp(24px,5vw,32px)] font-bold leading-[1.15] tracking-[-0.04em] text-balance">
          Что будем делать?
        </h1>
        <ul className="mt-6 overflow-hidden rounded-[var(--r-surface)] bg-card">
          {SECTIONS.map((s) => (
            <li key={s.href} className="border-t border-border first:border-t-0">
              <Link
                href={s.href}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-5 hover:bg-muted"
              >
                <span className="text-[17px] font-bold leading-6">{s.title}</span>
                <ChevronRightIcon className="row-span-2 size-5 text-muted-foreground" />
                <span className="text-[15px] leading-[22px] text-muted-foreground">{s.text}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-[13px] text-muted-foreground">
          Ответы ИИ не являются юридической консультацией. Проверяйте нормы по первоисточнику.
        </p>
      </main>
    </div>
  );
}
