"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckIcon, FolderIcon, HouseIcon, ListIcon, MessageSquareIcon, PlusIcon, UserRoundIcon, type LucideIcon } from "lucide-react";
import { Note } from "@/components/note";
import { PageBody, PageHeader } from "@/components/page-header";
import { openSamplePurchase } from "@/lib/sample-purchase";
import { STORAGE_ERROR } from "@/lib/use-purchases";

const PATH: { n: ReactNode; title: string; where: string; text: string }[] = [
  {
    n: <PlusIcon className="size-3.5" />,
    title: "Новая закупка",
    where: "кнопка «Новая закупка»",
    text: "Загрузите извещение, ТЗ и проект контракта — PDF, Word, сканы или фото. Через 1–2 минуты закупка появится в разделе «Закупки».",
  },
  {
    n: "1",
    title: "Требования",
    where: "в закупке, шаг 1",
    text: "Кто может участвовать, что подать в заявке, что требует ТЗ, сроки и деньги. Под каждым пунктом — ссылка на точную цитату из документа.",
  },
  {
    n: "2",
    title: "Техническое предложение",
    where: "в закупке, шаг 2",
    text: "Черновик по форме заказчика. Впишите свои данные в пункты, выделенные жёлтым, и скачайте файл Word. Там же — анкета, декларация и предложение о цене.",
  },
  {
    n: "3",
    title: "Проверка заявки",
    where: "в закупке, шаг 3",
    text: "Загрузите заявку, которую собираетесь подавать. Покажу ошибки, за которые могут отклонить, и замечания — с цитатами из документов.",
  },
  {
    n: <CheckIcon className="size-3.5" strokeWidth={3} />,
    title: "Подача",
    where: "на электронной площадке",
    text: "Заявку подаёте вы сами на площадке, до срока подачи. Срок и сколько дней осталось видны в шапке закупки.",
  },
];

const SECTIONS: { icon: LucideIcon; title: string; href: string; text: string }[] = [
  { icon: HouseIcon, title: "Главная", href: "/", text: "Что сделать сейчас по всем закупкам и ближайший срок подачи." },
  { icon: ListIcon, title: "Закупки", href: "/purchases", text: "Все закупки: список слева, открытая закупка справа — с шагами и вопросами по ней." },
  {
    icon: MessageSquareIcon,
    title: "Спросить про тендер",
    href: "/chat",
    text: "Общий вопрос по 44-ФЗ и 223-ФЗ. Вопрос про конкретную закупку задайте внутри неё — в «Вопросах»: отвечу по её документам.",
  },
  { icon: UserRoundIcon, title: "Реквизиты", href: "/me/profile", text: "Данные компании. Сами попадают в анкету, декларацию и цену — но никогда в ТП: его подают анонимно." },
  {
    icon: FolderIcon,
    title: "Документы компании",
    href: "/me/documents",
    text: "Ваши прошлые заявки, анкеты, карточка предприятия. По ним заполняются реквизиты и пишутся новые документы — так же, как пишете вы.",
  },
];

const MARKS: { dot: ReactNode; text: string }[] = [
  { dot: <span className="size-2.5 rounded-full bg-[var(--warn)]" />, text: "Янтарный — нужно ваше действие: вписать данные, сверить цифры." },
  { dot: <span className="size-2.5 rounded-full bg-destructive" />, text: "Красный — ошибка в заявке, за неё могут отклонить." },
  {
    dot: (
      <span className="grid size-4 place-items-center rounded-full bg-[var(--ok-tint)] text-[var(--ok)]">
        <CheckIcon className="size-2.5" strokeWidth={3} />
      </span>
    ),
    text: "Зелёный с галочкой — шаг сделан.",
  },
  { dot: <span className="size-2.5 rounded-full bg-[var(--edge-2)]" />, text: "Серый — ещё не начато." },
];

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel overflow-hidden">
      <div className="panel-head">
        <h2 className="t-section">{title}</h2>
      </div>
      {children}
    </section>
  );
}

// «Как это работает» — карта приложения: путь по закупке, что где лежит и что значат цвета.
export default function HelpPage() {
  const router = useRouter();
  const [error, setError] = useState(false);

  async function sample() {
    setError(false);
    try {
      router.push(`/p/${await openSamplePurchase()}`);
    } catch {
      setError(true);
    }
  }

  return (
    <>
      <PageHeader title="Как это работает" sub="Путь по закупке и где что лежит" />
      <PageBody>
        <div className="grid max-w-[880px] gap-3">
          <Panel title="Путь по одной закупке">
            <ol className="divide-y divide-[var(--line)]">
              {PATH.map((step) => (
                <li key={step.title} className="grid grid-cols-[24px_minmax(0,1fr)] gap-3 px-[var(--pad)] py-3">
                  <span aria-hidden className="grid size-6 place-items-center rounded-full bg-[var(--brand-tint)] font-mono text-xs font-bold text-primary">
                    {step.n}
                  </span>
                  <div className="grid gap-0.5">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="t-section">{step.title}</span>
                      <span className="t-caption text-[var(--ink-3)]">{step.where}</span>
                    </p>
                    <p className="t-read text-[var(--ink-2)]">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--line)] px-[var(--pad)] py-3">
              <Link href="/new" className="btn">
                <PlusIcon />
                Новая закупка
              </Link>
              <span className="text-[var(--ink-3)]">
                или{" "}
                <button type="button" onClick={() => void sample()} className="link">
                  пройти путь на примере
                </button>
              </span>
            </div>
            {error && (
              <div className="px-[var(--pad)] pb-3">
                <Note tone="warn">{STORAGE_ERROR}</Note>
              </div>
            )}
          </Panel>

          <Panel title="Разделы слева">
            <ul className="divide-y divide-[var(--line)]">
              {SECTIONS.map(({ icon: Icon, title, href, text }) => (
                <li key={title}>
                  <Link href={href} className="grid grid-cols-[16px_minmax(0,1fr)] gap-3 px-[var(--pad)] py-2.5 hover:bg-[var(--hover)]">
                    <Icon className="mt-0.5 size-4 text-[var(--ink-3)]" />
                    <span className="grid gap-0.5">
                      <span className="t-strong">{title}</span>
                      <span className="text-[var(--ink-2)]">{text}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Что значат цвета">
            <ul className="grid gap-2 px-[var(--pad)] py-3">
              {MARKS.map((mark) => (
                <li key={mark.text} className="grid grid-cols-[16px_minmax(0,1fr)] items-center gap-3">
                  <span className="grid place-items-center">{mark.dot}</span>
                  <span>{mark.text}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <p className="t-caption text-[var(--ink-3)]">
            Закупки и документы хранятся только в этом браузере. Ответы ИИ не являются юридической консультацией — проверяйте нормы по первоисточнику.
          </p>
        </div>
      </PageBody>
    </>
  );
}
