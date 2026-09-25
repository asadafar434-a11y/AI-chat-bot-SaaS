"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangleIcon, CheckIcon, FileTextIcon, PlusIcon } from "lucide-react";
import { FileDrop } from "@/components/file-drop";
import { Island } from "@/components/island";
import { Note } from "@/components/note";
import { PageBody, PageHeader, scrollToTop } from "@/components/page-header";
import {
  deleteMyDocument,
  fillProfileFromDocuments,
  listMyDocuments,
  samplesOf,
  saveMyDocuments,
  sortDocuments,
  type MyDocument,
} from "@/lib/me-store";
import { DOC_KIND_KEYS, DOC_KINDS, PART_SAMPLE_KIND, REQUISITE_KINDS, type DocKind } from "@/lib/my-docs";
import { plural } from "@/lib/plural";
import { ACCEPTED_FILES, readDocuments, type FailedFile } from "@/lib/read-documents";

const pages = (text: string) => Math.max(1, Math.round(text.length / 2500));

type Stage = "reading" | "sorting" | "profile";
const STAGE_TEXT: Record<Stage, string> = {
  reading: "Читаю файлы…",
  sorting: "Раскладываю по видам…",
  profile: "Заполняю реквизиты…",
};

// Что получилось после загрузки: сколько каких документов, что с реквизитами, что не прочиталось.
type Report = {
  added: MyDocument[];
  failed: FailedFile[];
  sortError?: string;
  filled?: number;
  suggestions?: number;
  profileError?: string;
};

// Виды, по которым пишутся части заявки: у них бывает «образцов уже достаточно».
const SAMPLE_KINDS: DocKind[] = ["tp", ...Object.values(PART_SAMPLE_KIND)];

const pill = (on: boolean) =>
  `t-strong min-h-9 rounded-[var(--r-pill)] px-4 ${on ? "bg-primary text-primary-foreground" : "bg-[var(--paper-2)] hover:bg-[var(--paper-3)]"}`;

function KindEditor({ doc, onSave, onCancel }: { doc: MyDocument; onSave: (kinds: DocKind[]) => void; onCancel: () => void }) {
  const [kinds, setKinds] = useState<DocKind[]>(doc.kinds);
  const toggle = (kind: DocKind) => setKinds(kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind]);
  return (
    <div className="grid gap-2.5 pl-[38px] max-sm:pl-0">
      <p className="t-strong">Что в этом файле? Можно выбрать несколько.</p>
      <div className="flex flex-wrap gap-2">
        {DOC_KIND_KEYS.map((kind) => (
          <button key={kind} type="button" aria-pressed={kinds.includes(kind)} onClick={() => toggle(kind)} className={pill(kinds.includes(kind))}>
            {DOC_KINDS[kind].group}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onSave(kinds.length ? DOC_KIND_KEYS.filter((k) => kinds.includes(k)) : ["other"])}
          className="btn btn-xs"
        >
          Готово
        </button>
        <button type="button" onClick={onCancel} className="btn btn-line btn-xs">
          Отмена
        </button>
      </div>
    </div>
  );
}

function countLine(docs: MyDocument[]) {
  return DOC_KIND_KEYS.map((kind) => [kind, docs.filter((d) => d.kinds.includes(kind)).length] as const)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${DOC_KINDS[kind].few} — ${n}`)
    .join(", ");
}

// «Документы компании» — всё, что участник подавал раньше, и документы его компании. Приложение раскладывает
// их по видам: по ТП пишутся новые ТП, по анкетам — анкеты, из анкет и карточки заполняются реквизиты.
export default function MyDocumentsPage() {
  const [docs, setDocs] = useState<MyDocument[] | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Файл может лежать в нескольких группах сразу, поэтому правка и удаление открываются для пары «группа — файл».
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const reload = () => listMyDocuments().then(setDocs, () => setError("Браузер не дал открыть ваши документы. Обновите страницу."));
  useEffect(() => {
    void reload();
  }, []);

  async function add(files: File[]) {
    setError(null);
    setReport(null);
    setStage("reading");
    try {
      const { documents, failed } = await readDocuments(files);
      setStage("sorting");
      const { sorted, error: sortError } = await sortDocuments(documents);
      const addedAt = new Date().toISOString();
      const added: MyDocument[] = documents.map((d, i) => ({
        id: crypto.randomUUID(),
        name: d.name,
        text: d.text,
        addedAt,
        kinds: sorted[i].kinds,
        about: sorted[i].about,
        ...(d.scan && { scan: true }),
      }));
      await saveMyDocuments(added);
      const next: Report = { added, failed, sortError };

      if (!sortError && added.some((d) => d.kinds.some((k) => REQUISITE_KINDS.includes(k)))) {
        setStage("profile");
        try {
          const { filled, suggestions } = await fillProfileFromDocuments(await listMyDocuments());
          next.filled = filled.length;
          next.suggestions = suggestions;
        } catch (e) {
          next.profileError = (e as Error).message;
        }
      }
      setReport(next);
      scrollToTop();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStage(null);
      await reload();
    }
  }

  async function saveKinds(doc: MyDocument, kinds: DocKind[]) {
    setEditing(null);
    try {
      await saveMyDocuments([{ ...doc, kinds }]);
      await reload();
    } catch {
      setError("Не получилось сохранить — попробуйте ещё раз.");
    }
  }

  async function remove(id: string) {
    setConfirm(null);
    try {
      await deleteMyDocument(id);
      await reload();
    } catch {
      setError("Не получилось удалить документ — попробуйте ещё раз.");
    }
  }

  const used = new Map(SAMPLE_KINDS.map((kind) => [kind, new Set(samplesOf(docs ?? [], kind).map((d) => d.id))]));
  const groups = DOC_KIND_KEYS.map((kind) => [kind, (docs ?? []).filter((d) => d.kinds.includes(kind))] as const).filter(
    ([, list]) => list.length > 0
  );

  const count = docs?.length ?? 0;

  return (
    <>
      <PageHeader
        title="Документы компании"
        sub={
          count
            ? `${count} ${plural(count, "документ", "документа", "документов")} · по ним заполняются реквизиты и пишутся новые документы`
            : "Прошлые заявки, анкеты, карточка предприятия — по ним заполняются реквизиты и пишутся новые документы"
        }
        actions={
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={stage !== null}
            aria-label="Добавить документы"
            className="btn max-sm:w-10 max-sm:px-0"
          >
            <PlusIcon />
            <span className="max-sm:hidden">Добавить документы</span>
          </button>
        }
      />
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        className="hidden"
        onChange={(e) => {
          const files = e.currentTarget.files ? [...e.currentTarget.files] : [];
          e.currentTarget.value = "";
          if (files.length) void add(files);
        }}
      />
      <PageBody>
        <div className="grid max-w-[880px] gap-2">
          <p className="max-w-[70ch] px-[var(--pad)] py-1 text-[var(--ink-2)]">
            Загрузите всё, что подавали раньше: заявки целиком или по частям, анкеты, декларации, ценовые предложения, договоры и акты, протоколы. Приложение разложит их по видам — и новые документы будет писать так же, как ваши.
          </p>

          {error && (
            <Note tone="warn" icon={AlertTriangleIcon}>
              {error}
            </Note>
          )}

          {report && (
            <div className="grid gap-2" aria-live="polite">
              {report.added.length > 0 && (
                <Note tone="ok" icon={CheckIcon}>
                  {`Добавил ${report.added.length} ${plural(report.added.length, "документ", "документа", "документов")}: ${countLine(report.added)}.`}
                </Note>
              )}
              {report.sortError && (
                <Note tone="warn" icon={AlertTriangleIcon}>
                  {`Разложить по видам с помощью ИИ не получилось (${report.sortError.replace(/\.$/, "")}), поэтому разложил по названиям файлов. Проверьте виды и поправьте, где нужно.`}
                </Note>
              )}
              {report.filled !== undefined && (
                <Note tone={report.filled ? "ok" : "info"} icon={report.filled ? CheckIcon : undefined}>
                  {report.filled
                    ? `Реквизиты: заполнил ${report.filled} ${plural(report.filled, "поле", "поля", "полей")} из ваших документов — `
                    : "Реквизиты: нового в документах не нашлось — "}
                  <Link href="/me/profile" className="underline underline-offset-4">
                    проверьте
                  </Link>
                  {report.suggestions ? `. Есть расхождения между документами — они показаны в реквизитах подсказками.` : "."}
                </Note>
              )}
              {report.profileError && (
                <Note tone="warn" icon={AlertTriangleIcon}>
                  {`Реквизиты заполнить не получилось: ${report.profileError}`}
                </Note>
              )}
              {report.failed.length > 0 && (
                <Note tone="warn" icon={AlertTriangleIcon}>
                  {`Не получилось прочитать: ${report.failed.map((f) => `${f.name} — ${f.reason}`).join("; ")}.`}
                </Note>
              )}
            </div>
          )}

          {stage && (
            <section className="island px-[var(--pad)]">
              <div className="grid gap-1 py-6" aria-live="polite">
                <p className="t-section animate-pulse">{STAGE_TEXT[stage]}</p>
                <p className="text-[var(--ink-3)]">Сканы и фото распознаются дольше — примерно минута на каждые 10 страниц.</p>
              </div>
            </section>
          )}

          {groups.map(([kind, list], gi) => (
            <Island key={kind} id={`dg-${gi}`} title={DOC_KINDS[kind].group} count={list.length} sub={DOC_KINDS[kind].use}>
              <ul className="divide-y divide-[var(--line)] px-[var(--pad)] pb-1">
                {list.map((doc) => {
                  const key = `${kind}:${doc.id}`;
                  const others = doc.kinds.filter((k) => k !== kind);
                  const unused = used.get(kind) && !used.get(kind)!.has(doc.id);
                  const meta = [
                    `≈ ${pages(doc.text)} ${plural(pages(doc.text), "страница", "страницы", "страниц")}`,
                    `добавлен ${new Date(doc.addedAt).toLocaleDateString("ru-RU")}`,
                    ...(doc.scan ? ["распознан со скана — сверьте цифры"] : []),
                    ...(others.length ? [`в файле также: ${others.map((k) => DOC_KINDS[k].few).join(", ")}`] : []),
                    ...(unused ? ["не используется: образцов уже достаточно"] : []),
                  ].join(" · ");
                  return (
                    <li key={doc.id} className="grid gap-2 py-3">
                      <div className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-2.5">
                        <span
                          className={`grid size-7 place-items-center rounded-md ${
                            doc.scan ? "bg-[var(--warn-tint)] text-[var(--warn)]" : "bg-[var(--paper-2)] text-[var(--ink-3)]"
                          }`}
                        >
                          <FileTextIcon className="size-4" />
                        </span>
                        <div className="grid min-w-0 gap-1">
                          <span className="t-strong break-words">{doc.name}</span>
                          {doc.about && <span className="text-[var(--ink-2)]">{doc.about}</span>}
                          <span className="t-caption text-[var(--ink-3)]">{meta}</span>
                        </div>
                      </div>
                      {editing === key ? (
                        <KindEditor doc={doc} onSave={(kinds) => void saveKinds(doc, kinds)} onCancel={() => setEditing(null)} />
                      ) : confirm === key ? (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-[38px] max-sm:pl-0">
                          <span>{others.length ? "Удалить файл целиком, из всех групп?" : "Удалить документ?"}</span>
                          <button type="button" onClick={() => void remove(doc.id)} className="btn btn-danger btn-xs">
                            Удалить
                          </button>
                          <button type="button" onClick={() => setConfirm(null)} className="btn btn-line btn-xs">
                            Отмена
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-x-5 gap-y-1 pl-[38px] max-sm:pl-0">
                          <button
                            type="button"
                            onClick={() => {
                              setConfirm(null);
                              setEditing(key);
                            }}
                            className="link"
                          >
                            Изменить вид
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(null);
                              setConfirm(key);
                            }}
                            className="link link-quiet link-del"
                          >
                            Удалить
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Island>
          ))}

          {!stage && (
            <section className="island p-2">
              <FileDrop
                hint="Перетащите сюда свои документы — PDF, Word, сканы и фото. Можно сразу все."
                button={count ? "Добавить документы" : "Загрузить документы"}
                onFiles={(files) => void add(files)}
              />
            </section>
          )}
        </div>
      </PageBody>
    </>
  );
}
