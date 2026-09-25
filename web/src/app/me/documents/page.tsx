"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangleIcon, CheckIcon, FileTextIcon } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { BackLink } from "@/components/back-link";
import { FileDrop } from "@/components/file-drop";
import { Note } from "@/components/note";
import { PageTitle } from "@/components/page-title";
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
import { readDocuments, type FailedFile } from "@/lib/read-documents";

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
  `min-h-9 rounded-[var(--r-pill)] px-3.5 text-[14.5px] font-semibold ${on ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent"}`;

function KindEditor({ doc, onSave, onCancel }: { doc: MyDocument; onSave: (kinds: DocKind[]) => void; onCancel: () => void }) {
  const [kinds, setKinds] = useState<DocKind[]>(doc.kinds);
  const toggle = (kind: DocKind) => setKinds(kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind]);
  return (
    <div className="grid gap-3 pl-8">
      <p className="text-[14.5px] font-semibold">Что в этом файле? Можно выбрать несколько.</p>
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
          className="min-h-9 rounded-[var(--r-ctl)] bg-primary px-4 font-semibold text-primary-foreground hover:opacity-90"
        >
          Готово
        </button>
        <button type="button" onClick={onCancel} className="min-h-9 rounded-[var(--r-ctl)] bg-muted px-4 font-semibold hover:bg-accent">
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

// «Мои документы» — всё, что участник подавал раньше, и документы его компании. Приложение раскладывает
// их по видам: по ТП пишутся новые ТП, по анкетам — анкеты, из анкет и карточки заполняются реквизиты.
export default function MyDocumentsPage() {
  const [docs, setDocs] = useState<MyDocument[] | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Файл может лежать в нескольких группах сразу, поэтому правка и удаление открываются для пары «группа — файл».
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

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
      window.scrollTo(0, 0);
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

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-[680px] px-4 pb-10">
        <BackLink href="/me">Мои данные</BackLink>
        <PageTitle className="mt-4">Мои документы</PageTitle>
        <p className="mt-3 max-w-[52ch] text-[17px] leading-[26px] text-[var(--ink-2)]">
          Загрузите всё, что подавали раньше: заявки целиком или по частям, анкеты, декларации, ценовые предложения, договоры и акты, протоколы. Приложение разложит их по видам — и новые документы будет писать так же, как ваши.
        </p>

        {error && (
          <Note tone="warn" icon={AlertTriangleIcon} className="mt-5">
            {error}
          </Note>
        )}

        {report && (
          <div className="mt-5 grid gap-2" aria-live="polite">
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

        {groups.map(([kind, list]) => (
          <section key={kind} className="mt-7">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              {DOC_KINDS[kind].group} — {list.length}
            </h2>
            <p className="mb-2.5 mt-1 text-[14.5px] leading-[21px] text-muted-foreground">{DOC_KINDS[kind].use}</p>
            <ul className="overflow-hidden rounded-[var(--r-surface)] bg-card">
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
                  <li key={doc.id} className="grid gap-2 border-t border-border px-5 py-4 first:border-t-0">
                    <div className="flex items-start gap-3">
                      <FileTextIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                      <div className="grid min-w-0 flex-1 gap-0.5">
                        <span className="break-words font-semibold">{doc.name}</span>
                        {doc.about && <span className="text-[15px] leading-[22px] text-[var(--ink-2)]">{doc.about}</span>}
                        <span className="text-[14px] leading-[20px] text-muted-foreground">{meta}</span>
                      </div>
                    </div>
                    {editing === key ? (
                      <KindEditor doc={doc} onSave={(kinds) => void saveKinds(doc, kinds)} onCancel={() => setEditing(null)} />
                    ) : confirm === key ? (
                      <div className="flex flex-wrap items-center gap-2 pl-8">
                        <span className="text-[14.5px]">{others.length ? "Удалить файл целиком, из всех групп?" : "Удалить документ?"}</span>
                        <button
                          type="button"
                          onClick={() => void remove(doc.id)}
                          className="min-h-9 rounded-[var(--r-ctl)] bg-[color-mix(in_oklab,var(--destructive)_14%,transparent)] px-4 font-semibold text-destructive"
                        >
                          Удалить
                        </button>
                        <button type="button" onClick={() => setConfirm(null)} className="min-h-9 rounded-[var(--r-ctl)] bg-muted px-4 font-semibold">
                          Отмена
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-x-5 gap-y-1 pl-8 text-[14px] font-medium">
                        <button
                          type="button"
                          onClick={() => {
                            setConfirm(null);
                            setEditing(key);
                          }}
                          className="text-primary underline underline-offset-4"
                        >
                          Изменить вид
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(null);
                            setConfirm(key);
                          }}
                          className="text-muted-foreground underline underline-offset-4 hover:text-destructive"
                        >
                          Удалить
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {stage ? (
          <div className="mt-8 grid gap-2" aria-live="polite">
            <p className="animate-pulse text-lg font-semibold">{STAGE_TEXT[stage]}</p>
            <p className="text-[15px] text-muted-foreground">Сканы и фото распознаются дольше — примерно минута на каждые 10 страниц.</p>
          </div>
        ) : (
          <FileDrop
            hint="Перетащите сюда свои документы — PDF, Word, сканы и фото. Можно сразу все."
            button={docs && docs.length ? "Добавить документы" : "Загрузить документы"}
            onFiles={(files) => void add(files)}
          />
        )}
      </main>
    </div>
  );
}
