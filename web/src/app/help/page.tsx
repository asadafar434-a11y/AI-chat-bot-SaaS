"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChatIcon,
  CheckIcon,
  ClipboardIcon,
  FolderIcon,
  HomeIcon,
  PlusIcon,
  UserIcon,
  WalletIcon,
  type IconComponent,
} from "@/components/icons";
import { Island } from "@/components/island";
import { Note } from "@/components/note";
import { LEGAL_PAGES } from "@/lib/legal";
import { PageBody, PageHeader } from "@/components/page-header";
import { rubShort } from "@/lib/price-calc";
import { PRICE_APP } from "@/lib/pricing";
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
    title: "Загрузка",
    where: "в закупке, шаг 1",
    text: "Документы закупки — прочитанные и нет. Добавили файл — закупка перечитывается целиком: требования, сроки и цена.",
  },
  {
    n: "2",
    title: "Анализ",
    where: "в закупке, шаг 2",
    text: "Кто может участвовать, как оценят заявку и за что дают баллы, что подать, что требует ТЗ, сроки и деньги. Под каждым пунктом — ссылка на точную цитату из документа.",
  },
  {
    n: "3",
    title: "Цена",
    where: "в закупке, шаг 3",
    text: "До какой цены снижаться без убытка — по вашей себестоимости, налогу и обеспечению. Выбранную цену ставите в заявку.",
  },
  {
    n: "4",
    title: "Проверка",
    where: "в закупке, шаг 4",
    text: "Составлю техническое предложение, анкету и декларацию по форме заказчика. По списку видно, что заполнено само, что вписать и подтвердить. Готовили заявку сами — проверю её файлом.",
  },
  {
    n: "5",
    title: "Пакет",
    where: "в закупке, шаг 5",
    text: "Файлы заявки Word — по одному или архивом, и что из списка заказчика уже собрано. Оплата и проверка специалистом — скоро.",
  },
  {
    n: <CheckIcon className="size-3.5" strokeWidth={3} />,
    title: "Подача",
    where: "на электронной площадке",
    text: "Заявку подаёте вы сами на площадке, до срока подачи. Срок и сколько дней осталось видны в шапке закупки.",
  },
];

const SECTIONS: { icon: IconComponent; title: string; href: string; text: string }[] = [
  { icon: HomeIcon, title: "Главная", href: "/", text: "Что сделать сейчас по всем закупкам и ближайший срок подачи." },
  {
    icon: ClipboardIcon,
    title: "Закупки",
    href: "/purchases",
    text: "Все закупки: список слева, открытая закупка справа — с шагами, поиском по словам в её документах, расчётом, до какой цены снижаться, и вопросами по ней.",
  },
  {
    icon: ChatIcon,
    title: "Спросить про тендер",
    href: "/chat",
    text: "Общий вопрос по 44-ФЗ и 223-ФЗ. Вопрос про конкретную закупку задайте внутри неё — в «Вопросах»: отвечу по её документам.",
  },
  { icon: UserIcon, title: "Реквизиты", href: "/me/profile", text: "Данные компании. Сами попадают в анкету, декларацию и цену — но никогда в ТП: его подают анонимно." },
  {
    icon: FolderIcon,
    title: "Образцы и реквизиты",
    href: "/me/documents",
    text: "Ваши прошлые заявки, анкеты, карточка предприятия. По ним заполняются реквизиты и пишутся новые документы — так же, как пишете вы.",
  },
  {
    icon: WalletIcon,
    title: "Тарифы",
    href: "/tariffs",
    text: `Заявка — ${rubShort(PRICE_APP)}, пакеты на 5 и 10 заявок — со скидкой. Оплата пока не подключена: документы скачиваются бесплатно.`,
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

// «Как это работает» — карта приложения тремя островами: путь по закупке, что где лежит и что значат цвета.
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
        <div className="grid max-w-[880px] gap-2">
          <Island id="help-path" title="Путь по одной закупке">
            <ol className="divide-y divide-[var(--line)] px-[var(--pad)]">
              {PATH.map((step) => (
                <li key={step.title} className="grid grid-cols-[24px_minmax(0,1fr)] gap-3 py-3">
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
            <div className="mx-[var(--pad)] flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--line)] py-3">
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
          </Island>

          <Island id="help-sections" title="Разделы слева">
            <ul className="grid gap-0.5 px-2 pb-2">
              {SECTIONS.map(({ icon: Icon, title, href, text }) => (
                <li key={title}>
                  <Link href={href} className="item grid grid-cols-[16px_minmax(0,1fr)] items-start gap-3 py-2">
                    <Icon className="mt-0.5 size-4 text-[var(--ink-3)]" />
                    <span className="grid gap-0.5">
                      <span className="t-strong">{title}</span>
                      <span className="text-[var(--ink-2)]">{text}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Island>

          <Island id="help-colors" title="Что значат цвета">
            <ul className="grid gap-2 px-[var(--pad)] pb-4 pt-1">
              {MARKS.map((mark) => (
                <li key={mark.text} className="grid grid-cols-[16px_minmax(0,1fr)] items-center gap-3">
                  <span className="grid place-items-center">{mark.dot}</span>
                  <span>{mark.text}</span>
                </li>
              ))}
            </ul>
          </Island>

          <Island id="help-data" title="Где ваши данные">
            <ul className="grid list-disc gap-1.5 pb-4 pl-[calc(var(--pad)+20px)] pr-[var(--pad)] pt-1 marker:text-[var(--ink-3)]">
              <li>
                Закупки, документы и реквизиты хранятся только в этом браузере, на этом устройстве. Сервер их не сохраняет. Копию
                можно сохранить файлом — внизу страницы{" "}
                <Link href="/me/profile#backup" className="link">
                  «Реквизиты»
                </Link>
                : из неё всё вернётся, если браузер данные сотрёт. Там же — удаление всех данных.
              </li>
              <li>
                Для требований, ТП, проверки и ответов текст уходит в ИИ — Claude компании Anthropic, США. ФИО, телефоны, почта,
                паспорт и другие персональные данные перед этим заменяются метками, в ответе — возвращаются. Сканы и фото уходят на
                распознавание картинкой, как есть.
              </li>
              <li>Ответы ИИ не являются юридической консультацией — проверяйте нормы по первоисточнику.</li>
            </ul>
            <p className="t-caption mx-[var(--pad)] flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--line)] py-3">
              {LEGAL_PAGES.map((page) => (
                <Link key={page.href} href={page.href} className="link link-quiet">
                  {page.title}
                </Link>
              ))}
            </p>
          </Island>
        </div>
      </PageBody>
    </>
  );
}
