"use client";

import { useEffect, useState } from "react";
import { archiveName, fingerprint } from "@/lib/application-files";
import { blankRequest } from "@/lib/blank-request";
import { rowsOf } from "@/lib/cast";
import { anketaExtraValues } from "@/lib/fields";
import { FILE_FORMATS, type FileFormat } from "@/lib/file-format";
import { errorMessage, errorText } from "@/lib/http-error";
import { evidenceOf, getProfile, listMyDocuments, samplesOf, type MyDocument } from "@/lib/me-store";
import { isEvidencePart, PART_SAMPLE_KIND, type PartKey } from "@/lib/my-docs";
import type { PartDoc } from "@/lib/part-doc";
import { aiHeaders, type Purchase } from "@/lib/purchase";
import { forServer, type SentDocument } from "@/lib/read-documents";
import { saveFile } from "@/lib/save-file";
import type { DetectedForm, TpResult } from "@/lib/tp";
import { criteriaRowsFor, PART_TITLES, partsOf, type TpPart } from "@/lib/tp-parts";
import type { Profile } from "@/lib/profile";

// Закупка, с которой работает хук: её отдаёт провайдер закупки — и приложения на Next, и прототипа на Vite.
export type ApplicationSource = {
  purchase: Purchase;
  documents: SentDocument[];
  update: (patch: Partial<Purchase>) => void;
};

// Состав исполнителей для таблицы в файле ТП: кто по ТЗ, ФИО и звание.
const castLines = (cast: TpResult["cast"]) =>
  cast && {
    clause: cast.clause,
    rows: cast.groups.flatMap((g) =>
      rowsOf(cast, g.key).map((r) => ({ who: g.one, name: r.name.trim(), title: r.title.trim(), titled: g.rank !== "none" }))
    ),
  };

async function fileFrom(path: "/api/tp/docx" | "/api/tp/pdf" | "/api/tp/odt" | "/api/tp/zip", body: object, failed: string): Promise<Blob> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await errorText(res, failed));
  return res.blob();
}

export type Downloading = TpPart | "all" | null;

// Скачивание частей заявки — на шаге «Пакет» и в документе ТП одно и то же. Анкета, декларация, цена,
// опыт и специалисты пишутся по форме заказчика и образцам того же вида; готовая часть хранится в закупке
// и скачивается сразу, пока не изменились форма, реквизиты, цена или образцы.
export function useApplicationFilesOf({ purchase, documents, update }: ApplicationSource) {
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
    // Дополнительные бланки заказчика попадают только в единый бланк заявки (application).
    detectedForms: part === "application" ? (current.detectedForms ?? []) : undefined,
    // Фамилии исполнителей нужны только в самом ТП.
    cast: part === "tp" ? castLines(current.cast) : undefined,
    price: current.form.hasPrice || part === "application" ? purchase.tpPrice : undefined,
    // Реквизиты — только в анкету, декларацию и цену; техническое предложение подают анонимно.
    profile: part === "tp" ? undefined : profile,
    // Строки анкеты заказчика сверх реквизитов — со значениями, вписанными для этой закупки.
    anketaExtra: part === "participant" ? anketaExtraValues(purchase, current.form) : undefined,
  });

  // Что уйдёт в файл части: готовый документ, шаблон или документ, который ИИ напишет сейчас.
  // parts — готовые части на этот момент: при скачивании архивом они пишутся одна за другой.
  async function payloadOf(current: TpResult, part: TpPart, parts: Purchase["parts"], redo = false) {
    // "application" — детерминированный бланк (Приложение 1), не требует ИИ.
    if (part === "tp" || part === "application" || purchase.sample) return { payload: templatePayload(current, part), parts };
    const basisKey = basisKeyOf(current, part);
    const made = parts?.[part];
    if (!redo && made?.basisKey === basisKey) return { payload: { doc: made.doc }, parts };
    setWriting(part);
    try {
      const res = await fetch("/api/tp/part", {
        method: "POST",
        headers: aiHeaders(purchase.id),
        body: JSON.stringify({
          part,
          documents: forServer(documents),
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
      if (!res.ok) throw new Error(await errorText(res, "Не удалось составить документ."));
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
      setError(errorMessage(e));
    } finally {
      setDownloading(null);
    }
  }

  // redo — составить часть заново, даже если готовая актуальна; format — Word (по умолчанию), PDF или ODT.
  const downloadPart = (current: TpResult, part: TpPart, { redo = false, format = "docx" }: { redo?: boolean; format?: FileFormat } = {}) =>
    run(part, async () => {
      const { payload } = await payloadOf(current, part, purchase.parts, redo);
      const { ext } = FILE_FORMATS[format];
      saveFile(await fileFrom(`/api/tp/${ext}` as "/api/tp/docx" | "/api/tp/pdf" | "/api/tp/odt", { part, ...payload }, "Не удалось собрать файл."), `${PART_TITLES[part]}.${ext}`);
    });

  // Все файлы заявки одним архивом: недостающие части пишутся по очереди, архив собирает сервер.
  // Формат один на весь архив: Word, PDF или ODT.
  const downloadAll = (current: TpResult, format: FileFormat = "docx", blanks: DetectedForm[] = []) =>
    run("all", async () => {
      let parts = purchase.parts;
      const files: object[] = [];
      for (const part of partsOf(current.form, purchase.criteria, purchase.kind)) {
        const made = await payloadOf(current, part, parts);
        parts = made.parts;
        files.push({ part, ...made.payload });
      }
      for (const df of blanks) files.push(blankRequest(purchase.subject, df));
      const name = archiveName(purchase);
      saveFile(await fileFrom("/api/tp/zip", { name, files, format }, "Не удалось собрать архив."), `${name}.zip`);
    });

  return { myDocs, profile, meReady, downloading, writing, error, note, partSamples, isFresh, downloadPart, downloadAll };
}
