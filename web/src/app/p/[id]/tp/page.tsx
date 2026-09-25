"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangleIcon, CheckIcon, PencilIcon } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { BackLink } from "@/components/back-link";
import { Note } from "@/components/note";
import { PageTitle } from "@/components/page-title";
import { usePurchase } from "@/components/purchase-provider";
import { WorkingSteps } from "@/components/working-steps";
import { getProfile, listMyDocuments, samplesOf, type MyDocument } from "@/lib/me-store";
import { PART_SAMPLE_KIND, type PartKey } from "@/lib/my-docs";
import type { PartDoc } from "@/lib/part-doc";
import { plural } from "@/lib/plural";
import { identityValues, type Profile } from "@/lib/profile";
import { titleOf } from "@/lib/purchase";
import { formatRubles, parseRubles, rublesInWords } from "@/lib/rub-words";
import { sampleTp } from "@/lib/sample-purchase";
import { fillCount, needsFill, type TpResult } from "@/lib/tp";
import { PART_TITLES, partsOf, type TpPart } from "@/lib/tp-docx";

const WORKING_STEPS = [
  "Ищу в документах форму заявки…",
  "Читаю ТЗ…",
  "Выписываю товары и характеристики…",
  "Готовлю предложение по пунктам…",
  "Сверяю цитаты с ТЗ…",
];

const button =
  "min-h-[52px] rounded-[var(--r-ctl)] bg-primary px-6 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60";

function FieldText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[[^\]]+\])/).filter(Boolean).map((part, i) =>
        /^\[[^\]]+\]$/.test(part) ? (
          <mark key={i} className="rounded-md bg-[var(--warn-tint)] px-1 font-semibold text-[var(--warn)]">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

// Текст правится прямо в черновике: нажали — появилось поле, ушли — сохранилось.
function Editable({ value, label, onChange }: { value: string; label: string; onChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  return editing ? (
    <textarea
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => setEditing(false)}
      aria-label={label}
      className="field-sizing-content -mx-2 min-h-12 resize-none rounded-[10px] bg-muted px-2 py-1.5 text-base leading-6 outline-none ring-2 ring-primary"
    />
  ) : (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={`Изменить: ${label}`}
      className="-mx-2 rounded-[10px] px-2 py-1.5 text-left text-base leading-6 whitespace-pre-wrap hover:bg-muted"
    >
      <FieldText text={value} />
    </button>
  );
}

function Source({ id, source, quote, verified, open, onToggle }: {
  id: string;
  source: string;
  quote: string;
  verified: boolean;
  open: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onToggle(id)}
        className="justify-self-start text-left text-sm font-medium text-primary underline underline-offset-4"
      >
        {source || "цитата из ТЗ"}
      </button>
      {open && <blockquote className="rounded-[14px] bg-muted px-4 py-3 text-[14.5px] leading-[22px]">{quote}</blockquote>}
      {!verified && (
        <p className="flex items-center gap-2 text-[13.5px] font-medium text-[var(--warn)]">
          <AlertTriangleIcon className="size-4 shrink-0" />
          Не нашёл эту цитату в документах дословно — сверьте строку вручную.
        </p>
      )}
    </>
  );
}

function SamplesLine({ count }: { count: number }) {
  return (
    <p className="mt-4 text-[15px] leading-[22px] text-muted-foreground">
      {count > 0 ? (
        <>
          {`Пишу по вашим техническим предложениям: ${count} ${plural(count, "документ", "документа", "документов")} из `}
          <Link href="/me/documents" className="font-semibold text-primary underline underline-offset-4">
            «Моих документов»
          </Link>
          .
        </>
      ) : (
        <>
          Черновик будет в общем стиле.{" "}
          <Link href="/me/documents" className="font-semibold text-primary underline underline-offset-4">
            Загрузите свои документы
          </Link>
          {" "}— и ТП будет написано так, как пишете вы.
        </>
      )}
    </p>
  );
}

// Короткий отпечаток данных: по нему видно, что часть заявки составлена из тех же реквизитов, цены и образцов.
function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = (hash * 33 + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PriceBlock({ tp, price, nmck, onChange }: {
  tp: TpResult;
  price: number | undefined;
  nmck: number | null;
  onChange: (price: number | undefined) => void;
}) {
  const [text, setText] = useState(price ? String(price) : "");
  const drop = nmck && price ? (1 - price / nmck) * 100 : null;
  const percent = drop !== null ? drop.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) : "";

  return (
    <section className="mt-6 grid gap-2 rounded-[var(--r-card)] bg-card p-4">
      <label htmlFor="tp-price" className="font-bold">
        Цена вашего предложения
      </label>
      <div className="flex items-center gap-2">
        <input
          id="tp-price"
          inputMode="decimal"
          placeholder="например, 4000000"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const value = Number(e.target.value.replace(/[\s\u00a0]/g, "").replace(",", "."));
            onChange(Number.isFinite(value) && value > 0 ? value : undefined);
          }}
          className="h-11 w-full max-w-60 rounded-[var(--r-ctl)] bg-muted px-3 text-base outline-none focus:ring-2 focus:ring-primary"
        />
        <span className="text-muted-foreground">₽</span>
      </div>
      {price && <p className="text-[14.5px] text-[var(--ink-2)]">Прописью: {rublesInWords(price)}</p>}
      {nmck && (
        <p className="text-[14.5px] text-muted-foreground">
          Начальная цена — {formatRubles(nmck)} ₽{drop !== null && drop > 0 ? ` · снижение ${percent}%` : ""}
        </p>
      )}
      {drop !== null && drop < 0 && (
        <Note tone="warn" icon={AlertTriangleIcon}>
          Цена выше начальной — такую заявку отклонят.
        </Note>
      )}
      {drop !== null && drop >= 25 && (
        <Note tone="warn" icon={AlertTriangleIcon}>
          {`Снижение ${percent}% — это 25% и больше. `}
          {tp.antiDumping.rule ||
            "В таких случаях обычно действуют антидемпинговые меры: обеспечение исполнения в полтора раза больше или подтверждение опыта. Проверьте условия в извещении."}
        </Note>
      )}
    </section>
  );
}

export default function TpPage() {
  const { purchase, documents, update } = usePurchase();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [confirmRedo, setConfirmRedo] = useState(false);
  const [downloading, setDownloading] = useState<TpPart | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [partNote, setPartNote] = useState<string | null>(null);
  const [myDocs, setMyDocs] = useState<MyDocument[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  // Пока реквизиты и документы не прочитаны, нельзя сказать, актуальны ли готовые части заявки.
  const [meReady, setMeReady] = useState(false);
  const tp = purchase.tp;
  const toggle = (id: string) => setOpen(open === id ? null : id);
  const usedSamples = samplesOf(myDocs, "tp");
  const partSamples = (part: PartKey) => samplesOf(myDocs, PART_SAMPLE_KIND[part]);

  useEffect(() => {
    void Promise.allSettled([
      listMyDocuments().then(setMyDocs, () => setMyDocs([])),
      getProfile().then(setProfile, () => setProfile(null)),
    ]).then(() => setMeReady(true));
  }, []);

  async function compose() {
    setWorking(true);
    setError(null);
    setConfirmRedo(false);
    try {
      let next: TpResult;
      if (purchase.sample) {
        next = sampleTp();
      } else {
        const res = await fetch("/api/tp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documents, samples: usedSamples.map(({ name, text }) => ({ name, text })) }),
        });
        if (!res.ok) throw new Error((await res.text()) || "Не удалось составить черновик.");
        next = await res.json();
      }
      setOpen(null);
      update({ tp: next });
      window.scrollTo(0, 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  async function fetchWord(part: TpPart, payload: object) {
    const res = await fetch("/api/tp/docx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ part, ...payload }),
    });
    if (!res.ok) throw new Error((await res.text()) || "Не удалось собрать файл.");
    saveFile(await res.blob(), `${PART_TITLES[part]}.docx`);
  }

  // Техническое предложение — всегда из черновика на экране. По этому же шаблону без ИИ собираются
  // остальные части в примере и когда ИИ не подключён.
  const templatePayload = (current: TpResult, part: TpPart) => ({
    subject: purchase.subject,
    form: current.form,
    goods: current.goods.map(({ name, characteristics, quantity }) => ({ name, characteristics, quantity })),
    items: current.items.map(({ clause, requirement, offer }) => ({ clause, requirement, offer })),
    price: current.form.hasPrice ? purchase.tpPrice : undefined,
    // Реквизиты — только в анкету, декларацию и цену; техническое предложение подают анонимно.
    profile: part === "tp" ? undefined : profile,
  });

  async function download(current: TpResult, part: TpPart) {
    setDownloading(part);
    setDownloadError(null);
    try {
      await fetchWord(part, templatePayload(current, part));
    } catch (e) {
      setDownloadError((e as Error).message);
    } finally {
      setDownloading(null);
    }
  }

  const basisKeyOf = (current: TpResult, part: PartKey) =>
    fingerprint({
      form: current.form,
      profile,
      price: current.form.hasPrice ? (purchase.tpPrice ?? null) : null,
      samples: partSamples(part).map((d) => d.id),
    });

  // Анкета, декларация и цена пишутся по форме заказчика и образцам того же вида. Готовая часть хранится
  // в закупке и скачивается сразу, пока не изменились форма, реквизиты, цена или образцы.
  async function downloadPart(current: TpResult, part: PartKey, redo = false) {
    if (purchase.sample) return download(current, part);
    setDownloading(part);
    setDownloadError(null);
    setPartNote(null);
    try {
      const basisKey = basisKeyOf(current, part);
      const made = purchase.parts?.[part];
      let doc: PartDoc | null = !redo && made?.basisKey === basisKey ? made.doc : null;
      if (!doc) {
        const res = await fetch("/api/tp/part", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            part,
            documents,
            samples: partSamples(part).map(({ name, text }) => ({ name, text })),
            profile,
            price: current.form.hasPrice ? purchase.tpPrice : undefined,
          }),
        });
        if (res.status === 503) {
          setPartNote("ИИ не подключён, поэтому документ собран по стандартному шаблону — без ваших образцов.");
          await fetchWord(part, templatePayload(current, part));
          return;
        }
        if (!res.ok) throw new Error((await res.text()) || "Не удалось составить документ.");
        doc = (await res.json()) as PartDoc;
        update({ parts: { ...purchase.parts, [part]: { doc, basisKey } } });
      }
      await fetchWord(part, { doc });
    } catch (e) {
      setDownloadError((e as Error).message);
    } finally {
      setDownloading(null);
    }
  }

  const head = (
    <>
      <BackLink href={`/p/${purchase.id}`}>{titleOf(purchase)}</BackLink>
      <PageTitle className="mt-4">Техническое предложение</PageTitle>
    </>
  );

  if (working || !tp) {
    return (
      <div className="flex min-h-dvh flex-col">
        <AppHeader />
        <main className="mx-auto w-full max-w-[680px] px-4 pb-10">
          {head}
          {working ? (
            <WorkingSteps steps={WORKING_STEPS} />
          ) : (
            <>
              <p className="mt-3 max-w-[48ch] text-[17px] leading-[26px] text-[var(--ink-2)]">
                Найду в документах форму заявки и заполню её, как тендерный юрист: товары с конкретными характеристиками, предложение по пунктам ТЗ, цена. Вам останется вписать то, что знаете только вы.
              </p>
              {!purchase.sample && <SamplesLine count={usedSamples.length} />}
              {error && (
                <Note tone="warn" icon={AlertTriangleIcon} className="mt-5">
                  {error}
                </Note>
              )}
              <button type="button" onClick={() => void compose()} className={`mt-6 ${button}`}>
                Составить черновик
              </button>
            </>
          )}
        </main>
      </div>
    );
  }

  const fill = fillCount(tp);
  // Всё, что уйдёт в техническое предложение: в нём не должно быть ничего, что раскрывает участника.
  const tpText = [tp.form.consent, ...tp.goods.flatMap((g) => [g.name, g.characteristics]), ...tp.items.map((it) => it.offer)].join(" ");
  const leaks = profile ? identityValues(profile).filter((value) => tpText.includes(value)) : [];
  const unverified = [...tp.goods, ...tp.items].filter((row) => !row.verified).length;
  const setGood = (index: number, characteristics: string) =>
    update({ tp: { ...tp, goods: tp.goods.map((g, i) => (i === index ? { ...g, characteristics } : g)) } });
  const setOffer = (index: number, offer: string) =>
    update({ tp: { ...tp, items: tp.items.map((it, i) => (i === index ? { ...it, offer } : it)) } });

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-[680px] px-4 pb-10">
        {head}
        <p className="mt-3 text-[15px] leading-[22px] text-muted-foreground">
          {tp.form.source
            ? `По форме заказчика: ${tp.form.title} (${tp.form.source}). Каждая часть заявки — отдельным файлом.`
            : "Формы заявки в документах нет — составлено как техническое предложение по пунктам ТЗ."}{" "}
          Техническое предложение идёт в первую часть заявки, поэтому в нём нет ни названия, ни ИНН, ни подписи участника.
        </p>

        {fill ? (
          <Note tone="warn" icon={PencilIcon} className="mt-4">
            {`Впишите свои данные в ${fill} ${plural(fill, "пункт", "пункта", "пунктов")} — они выделены жёлтым. Нажмите на текст, чтобы исправить.`}
          </Note>
        ) : (
          <Note tone="ok" icon={CheckIcon} className="mt-4">
            Все пункты заполнены.
          </Note>
        )}
        {leaks.length > 0 && (
          <Note tone="warn" icon={AlertTriangleIcon} className="mt-2">
            {`В техническом предложении есть ваши данные: ${leaks.map((v) => `«${v}»`).join(", ")}. Уберите их — ТП подают в первую часть заявки анонимно, иначе заявку отклонят.`}
          </Note>
        )}
        {unverified > 0 && (
          <Note tone="warn" icon={AlertTriangleIcon} className="mt-2">
            {`В ${unverified} ${plural(unverified, "строке", "строках", "строках")} цитата не найдена в документах дословно — сверьте их вручную.`}
          </Note>
        )}

        {tp.form.hasPrice && (
          <PriceBlock
            tp={tp}
            price={purchase.tpPrice}
            nmck={parseRubles(purchase.price)}
            onChange={(tpPrice) => update({ tpPrice })}
          />
        )}

        {tp.goods.length > 0 && (
          <section className="mt-7">
            <h2 className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              Товары и оборудование — {tp.goods.length}
            </h2>
            <ol className="overflow-hidden rounded-[var(--r-surface)] bg-card">
              {tp.goods.map((g, i) => (
                <li key={i} className="grid gap-1.5 border-t border-border px-5 py-[18px] first:border-t-0">
                  <div className="flex flex-wrap items-baseline gap-x-2.5">
                    <h3 className="text-base font-bold">{i + 1}. {g.name}</h3>
                    {g.quantity && <span className="text-[14px] text-muted-foreground">{g.quantity}</span>}
                    {needsFill(g.characteristics) && <span className="text-[13px] font-semibold text-[var(--warn)]">впишите данные</span>}
                  </div>
                  <Source id={`g${i}`} source={g.source} quote={g.quote} verified={g.verified} open={open === `g${i}`} onToggle={toggle} />
                  <Editable value={g.characteristics} label={`Характеристики: ${g.name}`} onChange={(v) => setGood(i, v)} />
                </li>
              ))}
            </ol>
          </section>
        )}

        {tp.items.length > 0 && (
          <section className="mt-7">
            <h2 className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              Предложение по пунктам ТЗ — {tp.items.length}
            </h2>
            <ol className="overflow-hidden rounded-[var(--r-surface)] bg-card">
              {tp.items.map((it, i) => (
                <li key={i} className="grid gap-1.5 border-t border-border px-5 py-[18px] first:border-t-0">
                  <div className="flex flex-wrap items-baseline gap-x-2.5">
                    <h3 className="text-base font-bold">{i + 1}. {it.topic}</h3>
                    {needsFill(it.offer) && <span className="text-[13px] font-semibold text-[var(--warn)]">впишите данные</span>}
                  </div>
                  <p className="text-[14.5px] leading-[21px] text-muted-foreground">
                    В ТЗ{it.clause ? `, п. ${it.clause}` : ""}: {it.requirement}
                  </p>
                  <Source id={`i${i}`} source="" quote={it.quote} verified={it.verified} open={open === `i${i}`} onToggle={toggle} />
                  <Editable value={it.offer} label={`Предложение: ${it.topic}`} onChange={(v) => setOffer(i, v)} />
                </li>
              ))}
            </ol>
          </section>
        )}


        <div className="mt-5">
          {confirmRedo ? (
            <div className="grid gap-3 rounded-[var(--r-card)] bg-card p-4">
              <p className="font-semibold">Составить черновик заново? Ваши правки в этом черновике пропадут.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void compose()} className="min-h-11 rounded-[var(--r-ctl)] bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90">
                  Составить заново
                </button>
                <button type="button" onClick={() => setConfirmRedo(false)} className="min-h-11 rounded-[var(--r-ctl)] bg-muted px-5 font-semibold hover:bg-accent">
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[15px] text-muted-foreground">
              Добавили документы или черновик не подходит?{" "}
              <button type="button" onClick={() => setConfirmRedo(true)} className="font-semibold text-primary underline underline-offset-4">
                Составить заново
              </button>
            </p>
          )}
          {error && (
            <Note tone="warn" icon={AlertTriangleIcon} className="mt-3">
              {error}
            </Note>
          )}
        </div>

        <section className="mt-8">
          <h2 className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            Остальные части заявки — отдельными файлами
          </h2>
          <ul className="overflow-hidden rounded-[var(--r-surface)] bg-card">
            {partsOf(tp.form)
              .filter((part): part is PartKey => part !== "tp")
              .map((part) => {
                const made = purchase.parts?.[part];
                const fresh = meReady && made !== undefined && made.basisKey === basisKeyOf(tp, part);
                const samples = partSamples(part);
                const status = !meReady
                  ? "…"
                  : purchase.sample
                    ? "в примере — по стандартному шаблону"
                    : downloading === part && !fresh
                      ? "Пишу документ — это около минуты…"
                      : fresh
                        ? made.doc.basis
                        : made
                          ? "реквизиты, цена или образцы изменились — составлю заново"
                          : samples.length
                            ? `составлю по вашему образцу «${samples[0].name}»${samples.length > 1 ? ` и ещё ${samples.length - 1}` : ""}`
                            : "ваших образцов нет — составлю по форме заказчика";
                return (
                  <li
                    key={part}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-t border-border px-5 py-4 first:border-t-0"
                  >
                    <span className="font-semibold leading-6">{PART_TITLES[part]}</span>
                    <button
                      type="button"
                      onClick={() => void downloadPart(tp, part)}
                      disabled={downloading !== null || !meReady}
                      className="row-span-2 min-h-11 rounded-[var(--r-ctl)] bg-muted px-4 font-semibold hover:bg-accent disabled:opacity-60"
                    >
                      {downloading === part ? (fresh ? "Собираю…" : "Пишу…") : "Скачать"}
                    </button>
                    <span className="text-[14px] leading-[20px] text-muted-foreground">
                      {status}
                      {fresh && !purchase.sample && downloading !== part && (
                        <>
                          {" · "}
                          <button
                            type="button"
                            onClick={() => void downloadPart(tp, part, true)}
                            disabled={downloading !== null}
                            className="underline underline-offset-4 disabled:opacity-60"
                          >
                            составить заново
                          </button>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
          </ul>
          <p className="mt-2.5 text-[14.5px] leading-[22px] text-muted-foreground">
            Реквизиты берутся из{" "}
            <Link href="/me/profile" className="font-semibold text-primary underline underline-offset-4">
              «Реквизитов»
            </Link>
            , образцы — из{" "}
            <Link href="/me/documents" className="font-semibold text-primary underline underline-offset-4">
              «Моих документов»
            </Link>
            . Чего там нет — выделено в Word жёлтым.
          </p>
          {partNote && (
            <Note tone="info" className="mt-2">
              {partNote}
            </Note>
          )}
        </section>

        <div className="sticky bottom-0 mt-2 grid gap-2 bg-gradient-to-b from-transparent to-background to-30% pb-[calc(16px+env(safe-area-inset-bottom,0px))] pt-4">
          <button
            type="button"
            onClick={() => void download(tp, "tp")}
            disabled={downloading !== null}
            className={`justify-self-start max-[480px]:justify-self-stretch ${button}`}
          >
            {downloading === "tp" ? "Собираю файл…" : "Скачать техническое предложение"}
          </button>
          {downloadError && <p className="text-sm font-medium text-destructive">{downloadError}</p>}
        </div>
      </main>
    </div>
  );
}
