"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangleIcon, CheckIcon, UploadIcon } from "lucide-react";
import { Island } from "@/components/island";
import { Note } from "@/components/note";
import { PageBody, PageHeader } from "@/components/page-header";
import {
  fillProfileFromDocuments,
  getProfile,
  getProfileMeta,
  listMyDocuments,
  saveProfile,
  type MyDocument,
  type ProfileMeta,
} from "@/lib/me-store";
import { REQUISITE_KINDS, type FoundField } from "@/lib/my-docs";
import { plural } from "@/lib/plural";
import { filledCount, PROFILE_GROUPS, PROFILE_KEYS, type Profile, type ProfileKey } from "@/lib/profile";

type SaveState = "idle" | "saving" | "saved" | "failed";
type FillNote = { tone: "ok" | "info" | "warn"; text: string };

const LABELS = Object.fromEntries(PROFILE_GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f.label]))) as Record<ProfileKey, string>;

// Банковские реквизиты подставляются только вместе: счёт одного банка с БИК другого — ошибка в заявке.
const BANK_KEYS: ProfileKey[] = ["account", "bankName", "bik", "corrAccount"];

function groupSuggestions(items: FoundField[]): FoundField[][] {
  const groups: FoundField[][] = [];
  for (const item of items) {
    const bank = BANK_KEYS.includes(item.key);
    const group = bank
      ? groups.find((g) => BANK_KEYS.includes(g[0].key) && g[0].source === item.source && !g.some((i) => i.key === item.key))
      : undefined;
    if (group) group.push(item);
    else groups.push([item]);
  }
  return groups.map((g) => [...g].sort((a, b) => BANK_KEYS.indexOf(a.key) - BANK_KEYS.indexOf(b.key)));
}

// Другие значения из документов: например, старый расчётный счёт в анкете позапрошлого года.
function Suggestions({ items, onAccept, onDismiss }: {
  items: FoundField[];
  onAccept: (group: FoundField[]) => void;
  onDismiss: (group: FoundField[]) => void;
}) {
  return (
    <section className="note grid gap-2.5 bg-[var(--warn-tint)] px-3 py-3">
      <p className="t-strong flex items-center gap-2 text-[var(--warn)]">
        <AlertTriangleIcon className="size-4 shrink-0" />
        В ваших документах есть другие значения — проверьте, какое верное
      </p>
      <ul className="grid gap-3">
        {groupSuggestions(items).map((group, i) => (
          <li key={i} className="grid gap-2 break-words">
            <span>
              {group.length > 1 ? (
                <>
                  <b className="font-semibold">Банковские реквизиты:</b> {group.map((item) => item.value).join(", ")}
                </>
              ) : (
                <>
                  <b className="font-semibold">{LABELS[group[0].key]}:</b> {group[0].value}
                </>
              )}{" "}
              <span className="text-[var(--ink-3)]">— из «{group[0].source}»</span>
            </span>
            <span className="flex flex-wrap gap-x-5 gap-y-1">
              <button type="button" onClick={() => onAccept(group)} className="link">
                {group.length > 1 ? "Подставить все" : "Подставить"}
              </button>
              <button type="button" onClick={() => onDismiss(group)} className="link link-quiet">
                Оставить как есть
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Реквизиты сохраняются сами, пока их вписывают: отдельной кнопки нет, чтобы ничего не потерять.
// Их можно не вписывать руками: они заполняются из анкет и карточки предприятия в «Документах компании».
export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [meta, setMeta] = useState<ProfileMeta>({ sources: {}, suggestions: [] });
  const [docs, setDocs] = useState<MyDocument[]>([]);
  const [save, setSave] = useState<SaveState>("idle");
  const [loadError, setLoadError] = useState(false);
  const [filling, setFilling] = useState(false);
  const [fillNote, setFillNote] = useState<FillNote | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Promise.all([getProfile(), getProfileMeta()]).then(
      ([p, m]) => {
        setProfile(p);
        setMeta(m);
      },
      () => setLoadError(true)
    );
    listMyDocuments().then(setDocs, () => setDocs([]));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function persist(nextProfile: Profile, nextMeta: ProfileMeta) {
    setProfile(nextProfile);
    setMeta(nextMeta);
    setSave("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      saveProfile(nextProfile, nextMeta).then(
        () => setSave("saved"),
        () => setSave("failed")
      );
    }, 400);
  }

  // Поле, исправленное руками, больше не считается взятым из документа: новые документы его не перезапишут.
  function change(key: ProfileKey, value: string) {
    if (!profile) return;
    const sources = { ...meta.sources };
    delete sources[key];
    persist({ ...profile, [key]: value }, { ...meta, sources });
  }

  function accept(group: FoundField[]) {
    if (!profile) return;
    persist(
      { ...profile, ...Object.fromEntries(group.map((item) => [item.key, item.value])) },
      {
        sources: { ...meta.sources, ...Object.fromEntries(group.map((item) => [item.key, item.source])) },
        suggestions: meta.suggestions.filter((s) => !group.includes(s)),
      }
    );
  }

  const dismiss = (group: FoundField[]) =>
    profile && persist(profile, { ...meta, suggestions: meta.suggestions.filter((s) => !group.includes(s)) });

  const sourceDocs = docs.filter((d) => d.kinds.some((k) => REQUISITE_KINDS.includes(k)));

  async function fillFromDocuments() {
    if (!profile) return;
    setFilling(true);
    setFillNote(null);
    try {
      // Сначала сохраняем то, что вписано в последние полсекунды, — иначе заполнение из документов это затрёт.
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        await saveProfile(profile, meta);
      }
      const { filled } = await fillProfileFromDocuments(docs);
      const [p, m] = await Promise.all([getProfile(), getProfileMeta()]);
      setProfile(p);
      setMeta(m);
      setSave("saved");
      setFillNote(
        filled.length
          ? { tone: "ok", text: `Заполнил ${filled.length} ${plural(filled.length, "поле", "поля", "полей")} из ваших документов — под ними написано, откуда. Проверьте.` }
          : { tone: "info", text: "Нового в документах не нашлось: всё, что там есть, уже вписано." }
      );
    } catch (e) {
      setFillNote({ tone: "warn", text: (e as Error).message });
    } finally {
      setFilling(false);
    }
  }

  const saveText =
    save === "saving" ? "Сохраняю…" : save === "saved" ? "Сохранено" : save === "failed" ? "Не сохранилось — попробуйте ещё раз" : "";

  return (
    <>
      <PageHeader
        title="Реквизиты"
        sub={`Данные компании для анкеты, декларации и цены · заполнено ${profile ? filledCount(profile) : 0} из ${PROFILE_KEYS.length}`}
        actions={
          <>
            <span
              aria-live="polite"
              className={`t-caption whitespace-nowrap max-sm:hidden ${save === "failed" ? "t-tag text-[var(--warn)]" : "text-[var(--ink-3)]"}`}
            >
              {saveText}
            </span>
            {sourceDocs.length > 0 && (
              <button
                type="button"
                onClick={() => void fillFromDocuments()}
                disabled={filling || !profile}
                aria-label="Заполнить из моих документов"
                className="btn btn-line max-sm:w-10 max-sm:px-0"
              >
                <UploadIcon />
                <span className="max-sm:hidden">{filling ? "Ищу реквизиты в документах…" : "Заполнить из документов"}</span>
              </button>
            )}
          </>
        }
      />
      <PageBody>
        <div className="grid max-w-[880px] gap-2">
          <p className="max-w-[70ch] px-[var(--pad)] py-1 text-[var(--ink-2)]">
            Впишите один раз — дальше они сами попадут в анкету, декларацию, предложение о цене и подпись. В техническое предложение реквизиты не попадают никогда: его подают анонимно.
          </p>
          {sourceDocs.length === 0 && (
            <p className="max-w-[70ch] px-[var(--pad)] pb-1 text-[var(--ink-2)]">
              Можно не вписывать руками: загрузите анкету или карточку предприятия в{" "}
              <Link href="/me/documents" className="link">
                «Документы компании»
              </Link>{" "}
              — реквизиты заполнятся сами.
            </p>
          )}

          {fillNote && (
            <Note tone={fillNote.tone} icon={fillNote.tone === "ok" ? CheckIcon : fillNote.tone === "warn" ? AlertTriangleIcon : undefined}>
              {fillNote.text}
            </Note>
          )}
          {save === "failed" && (
            <Note tone="warn" icon={AlertTriangleIcon} className="sm:hidden">
              Не получилось сохранить — попробуйте ещё раз.
            </Note>
          )}
          {loadError && (
            <Note tone="warn" icon={AlertTriangleIcon}>
              Браузер не дал открыть сохранённые реквизиты. Обновите страницу.
            </Note>
          )}

          {meta.suggestions.length > 0 && <Suggestions items={meta.suggestions} onAccept={accept} onDismiss={dismiss} />}

          {profile &&
            PROFILE_GROUPS.map((group, gi) => (
              <Island key={group.title} id={`pg-${gi}`} title={group.title}>
                <div className="grid px-[var(--pad)] pb-3 pt-1">
                  {group.fields.map((field) => (
                    <div
                      key={field.key}
                      className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-x-4 gap-y-1 py-1.5 max-sm:grid-cols-1"
                    >
                      <label htmlFor={`pf-${field.key}`} className="text-[var(--ink-2)]">
                        {field.label}
                      </label>
                      <input
                        id={`pf-${field.key}`}
                        value={profile[field.key]}
                        onChange={(e) => change(field.key, e.target.value)}
                        placeholder={field.example}
                        autoComplete="off"
                        className="field"
                      />
                      {meta.sources[field.key] && (
                        <span className="t-caption col-start-2 text-[var(--ink-3)] max-sm:col-start-1">
                          из «{meta.sources[field.key]}»
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </Island>
            ))}
        </div>
      </PageBody>
    </>
  );
}
