"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CastPanel } from "@/components/cast-panel";
import { ArrowRightIcon, CheckIcon, EditIcon, WarningIcon } from "@/components/icons";
import { Island } from "@/components/island";
import { Note, Warnings } from "@/components/note";
import { scrollToTop } from "@/components/page-header";
import { SourceQuote } from "@/components/purchase-bits";
import { usePurchase } from "@/components/purchase-provider";
import { StepIntro, TabBody } from "@/components/purchase-view";
import { WorkingSteps } from "@/components/working-steps";
import { castHistory, castLeaks, castTodo, rowsOf } from "@/lib/cast";
import { evidenceOf, getProfile, listMyDocuments, samplesOf, type MyDocument } from "@/lib/me-store";
import { isEvidencePart, PART_SAMPLE_KIND, type PartKey } from "@/lib/my-docs";
import type { PartDoc } from "@/lib/part-doc";
import { plural } from "@/lib/plural";
import { identityValues, type Profile } from "@/lib/profile";
import { scanWarning } from "@/lib/read-documents";
import { formatRubles, parseRubles, rublesInWords } from "@/lib/rub-words";
import { saveFile } from "@/lib/save-file";
import { sampleTp } from "@/lib/sample-purchase";
import { itemsFill, needsFill, type TpResult } from "@/lib/tp";
import { criteriaRowsFor, PART_TITLES, partsOf, type TpPart } from "@/lib/tp-parts";
import { SAMPLE_CAST_HISTORY, SAMPLE_CAST_LIST } from "@/lib/tp-sample";
import { usePurchases } from "@/lib/use-purchases";

const WORKING_STEPS = [
  "Ищу в документах форму заявки…",
  "Читаю ТЗ…",
  "Выписываю товары и характеристики…",
  "Готовлю предложение по пунктам…",
  "Сверяю цитаты с ТЗ…",
];

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
      className="t-doc field-sizing-content -mx-2 min-h-12 max-w-[80ch] resize-none rounded-[var(--r-ctl)] bg-[var(--paper-2)] px-2 py-1 outline-none ring-2 ring-primary"
    />
  ) : (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={`Изменить: ${label}`}
      className="t-doc -mx-2 max-w-[80ch] cursor-text whitespace-pre-wrap rounded-[var(--r-ctl)] px-2 py-1 text-left hover:bg-[var(--hover)]"
    >
      <FieldText text={value} />
    </button>
  );
}

function SamplesLine({ count }: { count: number }) {
  return (
    <p className="t-body text-[var(--ink-3)]">
      {count > 0 ? (
        <>
          {`Пишу по вашим техническим предложениям: ${count} ${plural(count, "документ", "документа", "документов")} из `}
          <Link href="/me/documents" className="link">
            «Образцов и реквизитов»
          </Link>
          .
        </>
      ) : (
        <>
          Черновик будет в общем стиле.{" "}
          <Link href="/me/documents" className="link">
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

function PriceBlock({ tp, price, nmck, calcHref, onChange }: {
  tp: TpResult;
  price: number | undefined;
  nmck: number | null;
  calcHref: string;
  onChange: (price: number | undefined) => void;
}) {
  const [text, setText] = useState(price ? String(price) : "");
  const drop = nmck && price ? (1 - price / nmck) * 100 : null;
  const percent = drop !== null ? drop.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) : "";

  return (
    <section className="island grid gap-1.5 px-[var(--pad)] py-3">
      <label htmlFor="tp-price" className="t-strong">
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
          autoComplete="off"
          className="field max-w-60 font-mono tabular-nums"
        />
        <span className="text-[var(--ink-3)]">₽</span>
      </div>
      {price && <p className="text-[var(--ink-2)]">Прописью: {rublesInWords(price)}</p>}
      {nmck && (
        <p className="text-[var(--ink-3)]">
          Начальная цена — {formatRubles(nmck)} ₽{drop !== null && drop > 0 ? ` · снижение ${percent}%` : ""}
        </p>
      )}
      <Link href={calcHref} className="link justify-self-start">
        До какой цены снижаться
      </Link>
      {drop !== null && drop < 0 && (
        <Note tone="warn" icon={WarningIcon}>
          Цена выше начальной — такую заявку отклонят.
        </Note>
      )}
      {drop !== null && drop >= 25 && (
        <Note tone="warn" icon={WarningIcon}>
          {`Снижение ${percent}% — это 25% и больше. `}
          {tp.antiDumping.rule ||
            "В таких случаях обычно действуют антидемпинговые меры: обеспечение исполнения в полтора раза больше или подтверждение опыта. Проверьте условия в извещении."}
        </Note>
      )}
    </section>
  );
}


// Сведения об опыте и о специалистах, пока не составлены: из чего составлю — или чего не хватает для баллов.
function evidenceStatus(part: "experience" | "staff", count: number): string {
  const docs = `${count} ${plural(count, "документ", "документа", "документов")}`;
  if (part === "experience") {
    return count
      ? `составлю из ваших договоров и актов (${docs}) и оценю баллы`
      : "ваших договоров с актами нет — загрузите их в «Образцы и реквизиты», иначе баллов за опыт не будет";
  }
  return count
    ? `составлю из документов сотрудников (${docs}) и оценю баллы`
    : "документов сотрудников нет — загрузите дипломы, удостоверения и договоры в «Образцы и реквизиты», иначе баллов за специалистов не будет";
}

export default function TpPage() {
  const { purchase, documents, update } = usePurchase();
  // Составы других закупок — подсказки при наборе фамилии в составе исполнителей.
  const { purchases } = usePurchases();
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
  // Для опыта и специалистов — не образцы оформления, а сами сведения: договоры с актами, документы сотрудников.
  const partSamples = (part: PartKey) =>
    isEvidencePart(part) ? evidenceOf(myDocs, PART_SAMPLE_KIND[part]) : samplesOf(myDocs, PART_SAMPLE_KIND[part]);
  // Строки порядка оценки, по которым собираются сведения об опыте и о специалистах.
  const partCriteria = (part: PartKey) => (isEvidencePart(part) ? criteriaRowsFor(purchase.criteria, part) : null);

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
      scrollToTop();
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

  // Состав исполнителей для таблицы в файле ТП: кто по ТЗ, ФИО и звание.
  const castLines = (cast: TpResult["cast"]) =>
    cast && {
      clause: cast.clause,
      rows: cast.groups.flatMap((g) =>
        rowsOf(cast, g.key).map((r) => ({ who: g.one, name: r.name.trim(), title: r.title.trim(), titled: g.rank !== "none" }))
      ),
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
      criteria: partCriteria(part),
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
            criteria: partCriteria(part) ?? undefined,
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

  if (working || !tp) {
    return (
      <TabBody>
        {working ? (
          <div className="island px-[var(--pad)]">
            <WorkingSteps steps={WORKING_STEPS} />
          </div>
        ) : (
          <div className="island grid justify-items-start gap-3 p-[var(--pad)]">
            <p className="max-w-[70ch] text-[var(--ink-2)]">
              Шаг 2 — техническое предложение. Найду в документах форму заявки и заполню её, как тендерный юрист: товары с конкретными характеристиками, предложение по пунктам ТЗ, цена. Вам останется вписать то, что знаете только вы.
            </p>
            {!purchase.sample && <SamplesLine count={usedSamples.length} />}
            {error && (
              <Note tone="warn" icon={WarningIcon}>
                {error}
              </Note>
            )}
            <button type="button" onClick={() => void compose()} className="btn btn-lg">
              Составить черновик
            </button>
          </div>
        )}
      </TabBody>
    );
  }

  const fill = itemsFill(tp);
  const castLeft = castTodo(tp.cast) > 0;
  const points = `${fill} ${plural(fill, "пункт", "пункта", "пунктов")}`;
  // Всё, что уйдёт в техническое предложение: в нём не должно быть ничего, что раскрывает участника.
  const tpText = [tp.form.consent, ...tp.goods.flatMap((g) => [g.name, g.characteristics]), ...tp.items.map((it) => it.offer)].join(" ");
  const leaks = profile ? identityValues(profile).filter((value) => tpText.includes(value)) : [];
  const ownLeaks = profile ? castLeaks(tp.cast, profile.signer) : [];
  const history = [...castHistory(purchases ?? [], purchase.id), ...(purchase.sample ? SAMPLE_CAST_HISTORY : [])];
  const unverified = [...tp.goods, ...tp.items].filter((row) => !row.verified).length;
  const setGood = (index: number, characteristics: string) =>
    update({ tp: { ...tp, goods: tp.goods.map((g, i) => (i === index ? { ...g, characteristics } : g)) } });
  const setOffer = (index: number, offer: string) =>
    update({ tp: { ...tp, items: tp.items.map((it, i) => (i === index ? { ...it, offer } : it)) } });
  const flag = <span className="t-tag text-[var(--warn)]">впишите данные</span>;

  return (
    <>
      <TabBody>
        <StepIntro>
          {tp.form.source
            ? `По форме заказчика: ${tp.form.title} (${tp.form.source}). Каждая часть заявки — отдельным файлом.`
            : "Формы заявки в документах нет — составлено как техническое предложение по пунктам ТЗ."}{" "}
          Техническое предложение идёт в первую часть заявки, поэтому в нём нет ни названия, ни ИНН, ни подписи участника.
        </StepIntro>

        {fill || castLeft ? (
          <Note tone="warn" icon={EditIcon}>
            {fill && castLeft
              ? `Впишите свои данные в ${points} и состав исполнителей. Пункты выделены жёлтым — нажмите на текст, чтобы исправить.`
              : fill
                ? `Впишите свои данные в ${points} — они выделены жёлтым. Нажмите на текст, чтобы исправить.`
                : "Осталось вписать состав исполнителей — он ниже, после пунктов ТЗ."}
          </Note>
        ) : (
          <Note tone="ok" icon={CheckIcon}>
            Все пункты заполнены.
          </Note>
        )}
        <Warnings
          items={[
            leaks.length > 0 &&
              `В техническом предложении есть ваши данные: ${leaks.map((v) => `«${v}»`).join(", ")}. Уберите их — ТП подают в первую часть заявки анонимно, иначе заявку отклонят.`,
            ownLeaks.length > 0 &&
              `Среди исполнителей — ${ownLeaks.map((v) => `«${v}»`).join(", ")}, как в подписи заявки. ТП подают в первую часть заявки анонимно: прежде чем подавать, уточните у юриста, не раскроет ли это участника.`,
            unverified > 0 &&
              `В ${unverified} ${plural(unverified, "строке", "строках", "строках")} цитата не найдена в документах дословно — сверьте их вручную.`,
            scanWarning(documents),
          ]}
        />

        {tp.form.hasPrice && (
          <PriceBlock
            tp={tp}
            price={purchase.tpPrice}
            nmck={parseRubles(purchase.price)}
            calcHref={`/p/${purchase.id}/price`}
            onChange={(tpPrice) => update({ tpPrice })}
          />
        )}

        {tp.goods.length > 0 && (
          <Island id="tp-goods" level={3} title="Товары и оборудование" count={tp.goods.length}>
            <ol className="divide-y divide-[var(--line)] px-[var(--pad)] pb-1">
              {tp.goods.map((g, i) => (
                <li key={i} className="grid gap-1.5 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h4 className="t-section">
                      {i + 1}. {g.name}
                    </h4>
                    {g.quantity && <span className="t-caption text-[var(--ink-3)]">{g.quantity}</span>}
                    {needsFill(g.characteristics) && flag}
                  </div>
                  <SourceQuote
                    source={g.source || "цитата из ТЗ"}
                    quote={g.quote}
                    verified={g.verified}
                    what="строку"
                    open={open === `g${i}`}
                    onToggle={() => toggle(`g${i}`)}
                  />
                  <Editable value={g.characteristics} label={`Характеристики: ${g.name}`} onChange={(v) => setGood(i, v)} />
                </li>
              ))}
            </ol>
          </Island>
        )}

        {tp.items.length > 0 && (
          <Island id="tp-items" level={3} title="Предложение по пунктам ТЗ" count={tp.items.length}>
            <ol className="divide-y divide-[var(--line)] px-[var(--pad)] pb-1">
              {tp.items.map((it, i) => (
                <li key={i} className="grid gap-1.5 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h4 className="t-section">
                      {i + 1}. {it.topic}
                    </h4>
                    {needsFill(it.offer) && flag}
                  </div>
                  <p className="text-[var(--ink-3)]">
                    В ТЗ{it.clause ? `, п. ${it.clause}` : ""}: {it.requirement}
                  </p>
                  <SourceQuote
                    source="цитата из ТЗ"
                    quote={it.quote}
                    verified={it.verified}
                    what="строку"
                    open={open === `i${i}`}
                    onToggle={() => toggle(`i${i}`)}
                  />
                  <Editable value={it.offer} label={`Предложение: ${it.topic}`} onChange={(v) => setOffer(i, v)} />
                </li>
              ))}
            </ol>
          </Island>
        )}

        {tp.cast && (
          <CastPanel
            cast={tp.cast}
            onChange={(cast) => update({ tp: { ...tp, cast } })}
            history={history}
            sample={purchase.sample ? SAMPLE_CAST_LIST : undefined}
            open={open}
            onToggle={toggle}
          />
        )}

        <div className="grid gap-2">
          {confirmRedo ? (
            <div className="island grid gap-2.5 p-3">
              <p className="t-strong">Составить черновик заново? Ваши правки в этом черновике пропадут.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void compose()} className="btn btn-xs">
                  Составить заново
                </button>
                <button type="button" onClick={() => setConfirmRedo(false)} className="btn btn-line btn-xs">
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <p className="px-[var(--pad)] py-1 text-[var(--ink-3)]">
              Добавили документы или черновик не подходит?{" "}
              <button type="button" onClick={() => setConfirmRedo(true)} className="link">
                Составить заново
              </button>
            </p>
          )}
          {error && (
            <Note tone="warn" icon={WarningIcon}>
              {error}
            </Note>
          )}
        </div>

        <Island id="tp-parts" level={3} title="Остальные части заявки" sub="Каждая — отдельным файлом Word">
          <ul className="divide-y divide-[var(--line)] px-[var(--pad)]">
            {partsOf(tp.form, purchase.criteria)
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
                        ? made.doc.score || made.doc.basis
                        : made
                          ? "реквизиты, цена или образцы изменились — составлю заново"
                          : isEvidencePart(part)
                            ? evidenceStatus(part, samples.length)
                            : samples.length
                              ? `составлю по вашему образцу «${samples[0].name}»${samples.length > 1 ? ` и ещё ${samples.length - 1}` : ""}`
                              : "ваших образцов нет — составлю по форме заказчика";
                // Нет договоров или документов сотрудников — баллы по показателю потеряны: подсказка янтарная.
                const missing = meReady && !purchase.sample && !fresh && !made && isEvidencePart(part) && samples.length === 0;
                const gaps = fresh && !purchase.sample ? (made.doc.gaps ?? []) : [];
                return (
                  <li key={part} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-2.5 max-sm:grid-cols-1">
                    <span className="t-strong">{PART_TITLES[part]}</span>
                    <button
                      type="button"
                      onClick={() => void downloadPart(tp, part)}
                      disabled={downloading !== null || !meReady}
                      className="btn btn-line btn-xs row-span-2 max-sm:row-span-1 max-sm:row-start-3 max-sm:mt-2 max-sm:justify-self-start"
                    >
                      {downloading === part ? (fresh ? "Собираю…" : "Пишу…") : "Скачать"}
                    </button>
                    <span className={`t-caption ${missing ? "text-[var(--warn)]" : "text-[var(--ink-3)]"}`}>
                      {status}
                      {fresh && !purchase.sample && downloading !== part && (
                        <>
                          {" · "}
                          <button
                            type="button"
                            onClick={() => void downloadPart(tp, part, true)}
                            disabled={downloading !== null}
                            className="link link-quiet disabled:opacity-60"
                          >
                            составить заново
                          </button>
                        </>
                      )}
                    </span>
                    {gaps.length > 0 && (
                      <ul className="t-caption col-span-full mt-1 grid gap-1 text-[var(--warn)]">
                        {gaps.map((gap, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <WarningIcon className="size-4 shrink-0" />
                            {gap}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
          </ul>
          <p className="mx-[var(--pad)] border-t border-[var(--line)] py-2.5 text-[var(--ink-3)]">
            Реквизиты берутся из{" "}
            <Link href="/me/profile" className="link">
              «Реквизитов»
            </Link>
            , образцы — из{" "}
            <Link href="/me/documents" className="link">
              «Образцов и реквизитов»
            </Link>
            . Чего там нет — выделено в Word жёлтым.
          </p>
          {partNote && (
            <div className="px-[var(--pad)] pb-3">
              <Note tone="info">{partNote}</Note>
            </div>
          )}
        </Island>
      </TabBody>

      {/* Главное действие шага — плавающим островом внизу, пока листаете черновик.
          Полоса холста под ним закрывает черновик до края окна. */}
      <div className="sticky -bottom-2 z-[5] -mx-2 -mb-2 mt-auto bg-[linear-gradient(to_top,var(--canvas)_8px,transparent_8px)] px-2 pb-2 pt-2">
        <div className="island grid gap-2 p-2 shadow-[var(--float)]">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void download(tp, "tp")}
              disabled={downloading !== null}
              className="btn max-sm:flex-1"
            >
              {downloading === "tp" ? "Собираю файл…" : "Скачать техническое предложение"}
            </button>
            <Link href={`/p/${purchase.id}/check`} className="btn btn-line max-sm:flex-1">
              Дальше: проверка заявки
              <ArrowRightIcon />
            </Link>
          </div>
          {downloadError && <p className="t-strong px-1 text-destructive">{downloadError}</p>}
        </div>
      </div>
    </>
  );
}
