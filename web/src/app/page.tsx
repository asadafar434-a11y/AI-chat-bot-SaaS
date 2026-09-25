"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, ChevronRightIcon } from "lucide-react";
import { AskBox } from "@/components/ask-box";
import { Note } from "@/components/note";
import { byUrgency, dueLine } from "@/lib/deadline";
import { plural } from "@/lib/plural";
import { titleOf, upgradePurchase, type Purchase } from "@/lib/purchase";
import { listPurchases } from "@/lib/purchase-store";
import { openSamplePurchase } from "@/lib/sample-purchase";
import { fillCount } from "@/lib/tp";

const STORAGE_ERROR = "Браузер не дал открыть хранилище закупок. Обновите страницу; если не поможет — проверьте, что сайту разрешено хранить данные.";

const newButton =
  "inline-flex min-h-[52px] items-center justify-center rounded-[var(--r-ctl)] bg-primary px-6 font-semibold text-primary-foreground hover:opacity-90";

// В списке янтарём выделен только обратный отсчёт, как в прототипе.
function DueText({ purchase }: { purchase: Purchase }) {
  const due = dueLine(purchase.deadline, false);
  if (!due) return <>Срок подачи не найден в документах</>;
  const soon = due.tone === "soon" ? "font-semibold text-[var(--warn)]" : "";
  if (!due.left) return <span className={soon}>{due.head}</span>;
  return (
    <>
      {due.head} · <span className={soon}>{due.left}</span>
    </>
  );
}

const TAG_TONES = {
  warn: "bg-[var(--warn-tint)] text-[var(--warn)]",
  ok: "bg-[var(--ok-tint)] text-[var(--ok)]",
  calm: "bg-muted text-[var(--ink-2)]",
};

function Tag({ tone, children }: { tone: keyof typeof TAG_TONES; children: ReactNode }) {
  return (
    <span className={`rounded-[var(--r-pill)] px-[11px] py-1 text-[13.5px] font-semibold leading-[19px] ${TAG_TONES[tone]}`}>
      {children}
    </span>
  );
}

// Состояние технического предложения видно прямо в списке — не нужно открывать закупку.
function TpTag({ purchase }: { purchase: Purchase }) {
  if (!purchase.tp) return <Tag tone="calm">ТП не составлено</Tag>;
  const fill = fillCount(purchase.tp);
  if (!fill) return <Tag tone="ok">ТП готово</Tag>;
  return (
    <Tag tone="warn">
      ТП: впишите {fill} {plural(fill, "пункт", "пункта", "пунктов")}
    </Tag>
  );
}

// Главная — сводка: вопрос про тендеры и закупки с тем, что по каждой осталось сделать.
// Подробности — на экране закупки, по одному разделу на экран.
export default function HomePage() {
  const router = useRouter();
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPurchases().then(
      (list) => setPurchases(list.map(upgradePurchase).sort((a, b) => byUrgency(a.deadline, b.deadline))),
      () => setError(STORAGE_ERROR)
    );
  }, []);

  async function sample() {
    setError(null);
    try {
      router.push(`/p/${await openSamplePurchase()}`);
    } catch {
      setError(STORAGE_ERROR);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto w-full max-w-[680px] px-4 pb-10">
        <h1 className="sr-only">Главная</h1>
        <AskBox />

        <section aria-labelledby="purchases-title">
          <div className="mt-9 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <h2
              id="purchases-title"
              className="font-heading text-[clamp(21px,4.4vw,26px)] font-bold leading-[1.2] tracking-[-0.02em]"
            >
              Мои закупки
            </h2>
            {purchases && purchases.length > 0 && (
              <Link href="/new" className={`${newButton} max-[480px]:w-full`}>
                + Новая закупка
              </Link>
            )}
          </div>

          {error && (
            <Note tone="warn" icon={AlertTriangleIcon} className="mt-5">
              {error}
            </Note>
          )}

          {purchases?.length === 0 && (
            <>
              <p className="mt-3 max-w-[46ch] text-[17px] leading-[26px] text-[var(--ink-2)]">
                Загрузите документы закупки — выпишу требования и сроки, составлю черновик технического предложения и отвечу на вопросы по документам.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
                <Link href="/new" className={newButton}>
                  Новая закупка
                </Link>
                <span className="text-[15px] text-muted-foreground">
                  или{" "}
                  <button type="button" onClick={() => void sample()} className="font-semibold text-primary underline underline-offset-4">
                    посмотреть на примере
                  </button>
                </span>
              </div>
            </>
          )}

          {purchases && purchases.length > 0 && (
            <ul className="mt-4 grid gap-2.5">
              {purchases.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/p/${p.id}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1 rounded-[var(--r-card)] bg-card px-5 py-[18px] hover:shadow-[var(--lift)] max-[480px]:p-4"
                  >
                    <span className="flex flex-wrap items-baseline gap-x-2 text-[17px] font-bold leading-6">
                      {titleOf(p)}
                      {p.sample && <span className="text-[13px] font-semibold text-muted-foreground">пример</span>}
                    </span>
                    <ChevronRightIcon className="row-span-3 size-5 text-muted-foreground" />
                    <span className="text-[14.5px] leading-[21px] text-muted-foreground">
                      <DueText purchase={p} />
                    </span>
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      <TpTag purchase={p} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-10 text-[13px] text-muted-foreground">
          Закупки хранятся в этом браузере. Ответы ИИ не являются юридической консультацией — проверяйте нормы по первоисточнику.
        </p>
      </main>
    </div>
  );
}
