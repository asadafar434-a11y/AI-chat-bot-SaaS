"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AlertTriangleIcon, ClockIcon } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { BackLink } from "@/components/back-link";
import { MenuRow } from "@/components/menu-row";
import { Note } from "@/components/note";
import { PageTitle } from "@/components/page-title";
import { usePurchase } from "@/components/purchase-provider";
import { WorkingSteps } from "@/components/working-steps";
import { checkSummary } from "@/lib/check";
import { dueLine } from "@/lib/deadline";
import { plural } from "@/lib/plural";
import { extractRequirements, fromRequirements, titleOf } from "@/lib/purchase";
import { ACCEPTED_FILES, readDocuments } from "@/lib/read-documents";
import { REQ_GROUP_KEYS } from "@/lib/requirements";
import { fillCount } from "@/lib/tp";

const DUE_TONES = {
  soon: "bg-[var(--warn-tint)] text-[var(--warn)]",
  calm: "bg-card text-[var(--ink-2)]",
  past: "bg-card text-muted-foreground",
};

const CHECK_TONES = {
  bad: "text-destructive",
  warn: "text-[var(--warn)]",
  ok: "text-[var(--ok)]",
};

const ADDING_STEPS = [
  "Читаю новые документы…",
  "Перечитываю закупку целиком…",
  "Обновляю требования и сроки…",
  "Сверяю цитаты с документами…",
];

export default function PurchasePage() {
  const { purchase, documents, replaceDocuments, remove } = usePurchase();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const base = `/p/${purchase.id}`;
  const due = dueLine(purchase.deadline, true);
  const reqCount = REQ_GROUP_KEYS.reduce((n, key) => n + purchase.requirements[key].length, 0);
  const fill = purchase.tp ? fillCount(purchase.tp) : 0;
  const asked = purchase.chat?.filter((m) => m.role === "user").length ?? 0;

  // Новый файл может поменять всё — сроки, цену, требования, — поэтому закупка перечитывается целиком.
  // Если модель не ответила, документы не добавляются: требования не должны расходиться с файлами.
  async function addFiles(files: File[]) {
    setAdding(true);
    setError(null);
    try {
      const { documents: added, failed } = await readDocuments(files);
      const addedNames = new Set(added.map((d) => d.name));
      const failedNames = new Set(failed.map((f) => f.name));
      const all = [...documents.filter((d) => !addedNames.has(d.name)), ...added];
      const result = await extractRequirements(all);
      await replaceDocuments(all, {
        ...fromRequirements(result),
        files: all.map((d) => d.name),
        unreadable: [
          ...purchase.unreadable.filter((f) => !addedNames.has(f.name) && !failedNames.has(f.name)),
          ...failed,
        ],
      });
    } catch (e) {
      setError(`Документы не добавлены. ${(e as Error).message}`);
    } finally {
      setAdding(false);
    }
  }

  async function deleteIt() {
    try {
      await remove();
      router.replace("/");
    } catch {
      setConfirmDelete(false);
      setError("Не получилось удалить закупку — попробуйте ещё раз.");
    }
  }

  const tpSub = !purchase.tp ? (
    "Ещё не составлено — составлю по ТЗ за пару минут"
  ) : fill ? (
    <span className="font-semibold text-[var(--warn)]">
      Черновик готов · впишите {fill} {plural(fill, "пункт", "пункта", "пунктов")}
    </span>
  ) : (
    <span className="font-semibold text-[var(--ok)]">Черновик готов</span>
  );

  const checked = purchase.check && checkSummary(purchase.check);
  const checkSub = checked ? (
    <span className={`font-semibold ${CHECK_TONES[checked.tone]}`}>{checked.text}</span>
  ) : (
    "Не проверена — загрузите заявку перед подачей"
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-[680px] px-4 pb-10">
        <BackLink href="/">Мои закупки</BackLink>
        {purchase.kind && <p className="mt-5 text-sm text-muted-foreground">{purchase.kind}</p>}
        <PageTitle className="mt-2">{purchase.subject || titleOf(purchase)}</PageTitle>
        {due && (
          <p className={`mt-4 inline-flex items-center gap-2.5 rounded-[var(--r-card)] px-4 py-2.5 text-[15px] font-semibold ${DUE_TONES[due.tone]}`}>
            <ClockIcon className="size-[18px] shrink-0" />
            {due.text}
          </p>
        )}
        {(purchase.customer || purchase.price) && (
          <dl className="mt-4 grid gap-1 text-[15.5px] leading-[23px] text-[var(--ink-2)]">
            {purchase.customer && (
              <div>
                <dt className="inline">Заказчик: </dt>
                <dd className="inline font-semibold text-foreground">{purchase.customer}</dd>
              </div>
            )}
            {purchase.price && (
              <div>
                <dt className="inline">Начальная цена: </dt>
                <dd className="inline font-semibold text-foreground">{purchase.price}</dd>
              </div>
            )}
          </dl>
        )}
        {purchase.sample && (
          <Note tone="info" className="mt-5">
            Это пример на вымышленной закупке — нажимайте на всё, ничего не сломается.
          </Note>
        )}

        {adding ? (
          <WorkingSteps steps={ADDING_STEPS} />
        ) : (
          <>
            {error && (
              <Note tone="warn" icon={AlertTriangleIcon} className="mt-5">
                {error}
              </Note>
            )}
            <ul className="mt-6 overflow-hidden rounded-[var(--r-surface)] bg-card">
              <MenuRow
                href={`${base}/requirements`}
                title="Требования"
                sub={`${reqCount} ${plural(reqCount, "пункт", "пункта", "пунктов")}: кто может участвовать, что подать, сроки и деньги`}
              />
              <MenuRow href={`${base}/tp`} title="Техническое предложение" sub={tpSub} />
              <MenuRow href={`${base}/check`} title="Проверка заявки" sub={checkSub} />
              <MenuRow
                href={`${base}/chat`}
                title="Вопросы по закупке"
                sub={
                  asked
                    ? `${asked} ${plural(asked, "вопрос", "вопроса", "вопросов")} · спросите ещё`
                    : "Сроки, обеспечение, требования — отвечу со ссылкой на пункт"
                }
              />
            </ul>

            <p className="mt-5 text-[14.5px] leading-[22px] text-muted-foreground">
              Документы: {purchase.files.join(", ")} ·{" "}
              <button
                type="button"
                onClick={() => input.current?.click()}
                className="font-semibold text-primary underline underline-offset-4"
              >
                добавить
              </button>
            </p>
            {purchase.unreadable.length > 0 && (
              <p className="mt-1 text-[14.5px] leading-[22px] text-[var(--warn)]">
                Не прочитаны: {purchase.unreadable.map((f) => `${f.name} — ${f.reason}`).join("; ")}
              </p>
            )}
            <input
              ref={input}
              type="file"
              multiple
              accept={ACCEPTED_FILES}
              className="hidden"
              onChange={(e) => {
                const files = e.currentTarget.files ? [...e.currentTarget.files] : [];
                e.currentTarget.value = "";
                if (files.length) void addFiles(files);
              }}
            />

            <div className="mt-10">
              {confirmDelete ? (
                <div className="grid gap-3 rounded-[var(--r-card)] bg-card p-4">
                  <p className="font-semibold">
                    Удалить закупку вместе с документами, черновиком и вопросами? Вернуть её не получится.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void deleteIt()}
                      className="min-h-11 rounded-[var(--r-ctl)] bg-[color-mix(in_oklab,var(--destructive)_14%,transparent)] px-5 font-semibold text-destructive hover:bg-[color-mix(in_oklab,var(--destructive)_22%,transparent)]"
                    >
                      Удалить
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="min-h-11 rounded-[var(--r-ctl)] bg-muted px-5 font-semibold hover:bg-accent"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="text-[14.5px] font-medium text-muted-foreground underline underline-offset-4 hover:text-destructive"
                >
                  Удалить закупку
                </button>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
