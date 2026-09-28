"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Dialog } from "@base-ui/react/dialog";
import { Badge } from "@/components/badge";
import { CrossIcon, DocumentIcon, DownloadIcon, WarningIcon } from "@/components/icons";
import { Note } from "@/components/note";
import { SourceQuote } from "@/components/purchase-bits";
import { usePurchase } from "@/components/purchase-provider";
import { archiveName, fileRows, fingerprint, submitItems, toggleReady } from "@/lib/application-files";
import { rowsOf } from "@/lib/cast";
import { evidenceOf, getProfile, listMyDocuments, samplesOf, type MyDocument } from "@/lib/me-store";
import { isEvidencePart, PART_SAMPLE_KIND, type PartKey } from "@/lib/my-docs";
import type { PartDoc } from "@/lib/part-doc";
import { plural } from "@/lib/plural";
import { filledCount, PROFILE_KEYS, type Profile } from "@/lib/profile";
import { titleOf, type Purchase } from "@/lib/purchase";
import { saveFile } from "@/lib/save-file";
import { stepsOf } from "@/lib/steps";
import type { TpResult } from "@/lib/tp";
import { criteriaRowsFor, PART_TITLES, partsOf, type TpPart } from "@/lib/tp-parts";

// Состав исполнителей для таблицы в файле ТП: кто по ТЗ, ФИО и звание.
const castLines = (cast: TpResult["cast"]) =>
  cast && {
    clause: cast.clause,
    rows: cast.groups.flatMap((g) =>
      rowsOf(cast, g.key).map((r) => ({ who: g.one, name: r.name.trim(), title: r.title.trim(), titled: g.rank !== "none" }))
    ),
  };

async function fileFrom(path: "/api/tp/docx" | "/api/tp/zip", body: object, failed: string): Promise<Blob> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.text()) || failed);
  return res.blob();
}

export type Downloading = TpPart | "all" | null;

// Скачивание частей заявки — на шаге ТП и в окне «Документы заявки» одно и то же. Анкета, декларация, цена,
// опыт и специалисты пишутся по форме заказчика и образцам того же вида; готовая часть хранится в закупке
// и скачивается сразу, пока не изменились форма, реквизиты, цена или образцы.
export function useApplicationFiles() {
  const { purchase, documents, update } = usePurchase();
  const [myDocs, setMyDocs] = useState<MyDocument[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  // Пока реквизиты и документы не прочитаны, нельзя сказать, актуальны ли готовые части заявки.
  const [meReady, setMeReady] = useState(false);
  const [downloading, setDownloading] = useState<Downloading>(null);
  // Какую часть сейчас пишет ИИ — и когда скачивают одну часть, и когда архив.
  const [writing, setWriting] = useState<TpPart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void Promise.allSettled([
      listMyDocuments().then(setMyDocs, () => setMyDocs([])),
      getProfile().then(setProfile, () => setProfile(null)),
    ]).then(() => setMeReady(true));
  }, []);

  // Для опыта и специалистов — не образцы оформления, а сами сведения: договоры с актами, документы сотрудников.
  const partSamples = (part: PartKey) =>
    isEvidencePart(part) ? evidenceOf(myDocs, PART_SAMPLE_KIND[part]) : samplesOf(myDocs, PART_SAMPLE_KIND[part]);
  // Строки порядка оценки, по которым собираются сведения об опыте и о специалистах.
  const partCriteria = (part: PartKey) => (isEvidencePart(part) ? criteriaRowsFor(purchase.criteria, part) : null);

  const basisKeyOf = (current: TpResult, part: PartKey) =>
    fingerprint({
      form: current.form,
      profile,
      price: current.form.hasPrice ? (purchase.tpPrice ?? null) : null,
      samples: partSamples(part).map((d) => d.id),
      criteria: partCriteria(part),
    });

  const isFresh = (current: TpResult, part: PartKey) => {
    const made = purchase.parts?.[part];
    return meReady && made !== undefined && made.basisKey === basisKeyOf(current, part);
  };

  // Техническое предложение — всегда из черновика на экране. По этому же шаблону без ИИ собираются
  // остальные части в примере и когда ИИ не подключён.
  const templatePayload = (current: TpResult, part: TpPart) => ({
    subject: purchase.subject,
    form: current.form,
    goods: current.goods.map(({ name, characteristics, quantity }) => ({ name, characteristics, quantity })),
    items: current.items.map(({ clause, requirement, offer }) => ({ clause, requirement, offer })),
    // Фамилии исполнителей нужны только в самом ТП.
    cast: part === "tp" ? castLines(current.cast) : undefined,
    price: current.form.hasPrice ? purchase.tpPrice : undefined,
    // Реквизиты — только в анкету, декларацию и цену; техническое предложение подают анонимно.
    profile: part === "tp" ? undefined : profile,
  });

  // Что уйдёт в файл части: готовый документ, шаблон или документ, который ИИ напишет сейчас.
  // parts — готовые части на этот момент: при скачивании архивом они пишутся одна за другой.
  async function payloadOf(current: TpResult, part: TpPart, parts: Purchase["parts"], redo = false) {
    if (part === "tp" || purchase.sample) return { payload: templatePayload(current, part), parts };
    const basisKey = basisKeyOf(current, part);
    const made = parts?.[part];
    if (!redo && made?.basisKey === basisKey) return { payload: { doc: made.doc }, parts };
    setWriting(part);
    try {
      const res = await fetch("/api/tp/part", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          part,
          documents,
          samples: partSamples(part).map(({ name, text }) => ({ name, text })),
          profile,
          price: current.form.hasPrice ? purchase.tpPrice : undefined,
          criteria: partCriteria(part) ?? undefined,
        }),
      });
      if (res.status === 503) {
        setNote("ИИ не подключён, поэтому документ собран по стандартному шаблону — без ваших образцов.");
        return { payload: templatePayload(current, part), parts };
      }
      if (!res.ok) throw new Error((await res.text()) || "Не удалось составить документ.");
      const doc = (await res.json()) as PartDoc;
      const next = { ...parts, [part]: { doc, basisKey } };
      update({ parts: next });
      return { payload: { doc }, parts: next };
    } finally {
      setWriting(null);
    }
  }

  async function run(key: Exclude<Downloading, null>, work: () => Promise<void>) {
    setDownloading(key);
    setError(null);
    setNote(null);
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(null);
    }
  }

  const downloadPart = (current: TpResult, part: TpPart, redo = false) =>
    run(part, async () => {
      const { payload } = await payloadOf(current, part, purchase.parts, redo);
      saveFile(await fileFrom("/api/tp/docx", { part, ...payload }, "Не удалось собрать файл."), `${PART_TITLES[part]}.docx`);
    });

  // Все файлы заявки одним архивом: недостающие части пишутся по очереди, архив собирает сервер.
  const downloadAll = (current: TpResult) =>
    run("all", async () => {
      let parts = purchase.parts;
      const files: object[] = [];
      for (const part of partsOf(current.form, purchase.criteria)) {
        const made = await payloadOf(current, part, parts);
        parts = made.parts;
        files.push({ part, ...made.payload });
      }
      const name = archiveName(purchase);
      saveFile(await fileFrom("/api/tp/zip", { name, files }, "Не удалось собрать архив."), `${name}.zip`);
    });

  return { myDocs, profile, meReady, downloading, writing, error, note, partSamples, isFresh, downloadPart, downloadAll };
}

// Окно открывается из любого шага закупки: из шапки, из «Готово к подаче» и по ссылке …#files с главной.
const OpenFiles = createContext<() => void>(() => {});
export const useOpenApplicationFiles = () => useContext(OpenFiles);

export function ApplicationFiles({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fromLink = () => {
      if (window.location.hash !== "#files") return;
      history.replaceState(null, "", window.location.pathname + window.location.search);
      setOpen(true);
    };
    const timer = setTimeout(fromLink);
    window.addEventListener("hashchange", fromLink);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("hashchange", fromLink);
    };
  }, []);

  return (
    <OpenFiles.Provider value={() => setOpen(true)}>
      {children}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-[rgb(16_18_39/.32)]" />
          <Dialog.Popup className="island fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-32px)] w-[min(680px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain shadow-[var(--float)] outline-none">
            <FilesBody close={() => setOpen(false)} />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </OpenFiles.Provider>
  );
}

// Строки содержимого — с разделителями; на узком окне бейдж уходит под название, кнопка остаётся справа.
const FILE_ROW =
  "grid grid-cols-[32px_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1.5 py-2.5 @max-[520px]:grid-cols-[32px_minmax(0,1fr)_auto]";

function FilesBody({ close }: { close: () => void }) {
  const { purchase, update } = usePurchase();
  const files = useApplicationFiles();
  const [quote, setQuote] = useState<string | null>(null);
  const tp = purchase.tp;
  const [, , check] = stepsOf(purchase);
  const busy = files.downloading !== null || !files.meReady;
  const rows = fileRows(purchase, {
    missing: files.profile ? PROFILE_KEYS.length - filledCount(files.profile) : 0,
    evidence: {
      experience: files.myDocs.filter((d) => d.kinds.includes("experience")).length,
      staff: files.myDocs.filter((d) => d.kinds.includes("staff")).length,
    },
    writing: files.writing,
  });
  const items = submitItems(purchase);
  const ready = items.filter((i) => i.ready).length;
  const count = tp ? partsOf(tp.form, purchase.criteria).length : 1;

  return (
    <div className="grid gap-4 p-[var(--pad)]">
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <p className="t-over truncate text-[var(--ink-3)]">{titleOf(purchase)}</p>
          <Dialog.Title className="t-page">Документы заявки</Dialog.Title>
          <Dialog.Description className="text-[var(--ink-2)]">
            Состав заявки задаёт заказчик. Часть файлов пишу я — каждый отдельным файлом Word, что осталось вписать, выделено жёлтым.
            Остальное собираете вы.
          </Dialog.Description>
        </div>
        <Dialog.Close aria-label="Закрыть" className="icon-btn -mr-1 -mt-1 flex-none">
          <CrossIcon className="size-5" />
        </Dialog.Close>
      </div>

      <section aria-labelledby="files-made" className="@container grid gap-1">
        <h3 id="files-made" className="t-section">
          Файлы, которые пишу я
        </h3>
        <ul className="divide-y divide-[var(--line)]">
          {rows.map((row) => (
            <li key={row.part} className={FILE_ROW}>
              <span aria-hidden className="law law-icon @max-[520px]:row-span-2 @max-[520px]:self-start">
                <DocumentIcon className="size-4" />
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span className="t-strong">{row.title}</span>
                <span className="t-caption text-[var(--ink-3)]">{row.sub}</span>
              </span>
              <Badge {...row.badge} className="justify-self-end @max-[520px]:col-start-2 @max-[520px]:row-start-2 @max-[520px]:justify-self-start" />
              {row.action === "compose" ? (
                <Link href={`/p/${purchase.id}/tp`} onClick={close} className="btn btn-line btn-xs @max-[520px]:col-start-3 @max-[520px]:row-span-2 @max-[520px]:row-start-1">
                  Составить
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => tp && void files.downloadPart(tp, row.part)}
                  disabled={busy || !tp}
                  className="btn btn-line btn-xs @max-[520px]:col-start-3 @max-[520px]:row-span-2 @max-[520px]:row-start-1"
                >
                  {files.downloading === row.part ? (files.writing === row.part ? "Пишу…" : "Собираю…") : "Скачать"}
                </button>
              )}
            </li>
          ))}
          {!tp && (
            <li className="py-2.5 text-[var(--ink-3)]">
              Анкета, декларация и предложение о цене появятся, когда составите ТП: форму заявки беру из документов закупки.
            </li>
          )}
        </ul>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--line)] pt-3">
          <button type="button" onClick={() => tp && void files.downloadAll(tp)} disabled={busy || !tp} className="btn">
            <DownloadIcon />
            {files.downloading === "all" ? (files.writing ? `Пишу: ${PART_TITLES[files.writing]}…` : "Собираю архив…") : "Скачать всё архивом"}
          </button>
          <span className="t-caption text-[var(--ink-3)]">{`${count} ${plural(count, "файл", "файла", "файлов")} Word`}</span>
        </div>
        {files.error && (
          <Note tone="warn" icon={WarningIcon} className="mt-2">
            {files.error}
          </Note>
        )}
        {files.note && (
          <Note tone="info" className="mt-2">
            {files.note}
          </Note>
        )}
      </section>

      <section aria-labelledby="files-ask" className="grid gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 id="files-ask" className="t-section">
            Что требует заказчик
          </h3>
          {items.length > 0 && <span className="t-caption text-[var(--ink-3)]">{`готово ${ready} из ${items.length}`}</span>}
        </div>
        {items.length === 0 ? (
          <p className="text-[var(--ink-3)]">
            Перечня документов в документах закупки не нашлось — сверьтесь с извещением: что подать, обычно сказано в требованиях к заявке.
          </p>
        ) : (
          <>
            <p className="t-caption text-[var(--ink-3)]">Всё, что заказчик просит приложить. Часть закрывают файлы выше — отметьте, что уже готово.</p>
            <ul className="divide-y divide-[var(--line)]">
              {items.map((item, i) => (
                <li key={`${i}:${item.text}`} className="grid gap-1 py-2.5">
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={item.ready}
                      onChange={() => update({ submitReady: toggleReady(purchase, item.text) })}
                      className="mt-0.5 size-4 flex-none accent-[var(--brand)]"
                    />
                    <span className={`t-read ${item.ready ? "text-[var(--ink-3)] line-through decoration-[var(--edge-2)]" : ""}`}>{item.text}</span>
                  </label>
                  <div className="pl-[26px]">
                    <SourceQuote
                      source={item.source || "цитата"}
                      quote={item.quote}
                      verified={item.verified}
                      what="пункт"
                      open={quote === `submit-${i}`}
                      onToggle={() => setQuote(quote === `submit-${i}` ? null : `submit-${i}`)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {check.state !== "done" && (
        <p className="t-caption border-t border-[var(--line)] pt-3 text-[var(--ink-2)]">
          Перед подачей проверьте заявку:{" "}
          <Link href={check.href} onClick={close} className="link">
            шаг 3, проверка заявки
          </Link>
          .
        </p>
      )}
    </div>
  );
}
