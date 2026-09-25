"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangleIcon, CheckIcon } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { Note } from "@/components/note";
import { PageTitle } from "@/components/page-title";
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
import { PROFILE_GROUPS, type Profile, type ProfileKey } from "@/lib/profile";

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
    <section className="mt-5 grid gap-3 rounded-[var(--r-card)] bg-[var(--warn-tint)] p-4">
      <p className="flex items-center gap-2 font-semibold text-[var(--warn)]">
        <AlertTriangleIcon className="size-5 shrink-0" />
        В ваших документах есть другие значения — проверьте, какое верное
      </p>
      <ul className="grid gap-3">
        {groupSuggestions(items).map((group, i) => (
          <li key={i} className="grid gap-1.5">
            <span className="text-[15px] leading-[22px]">
              {group.length > 1 ? (
                <>
                  <span className="font-semibold">Банковские реквизиты:</span> {group.map((item) => item.value).join(", ")}
                </>
              ) : (
                <>
                  <span className="font-semibold">{LABELS[group[0].key]}:</span> {group[0].value}
                </>
              )}{" "}
              <span className="text-muted-foreground">— из «{group[0].source}»</span>
            </span>
            <span className="flex flex-wrap gap-x-5 text-[14px] font-medium">
              <button type="button" onClick={() => onAccept(group)} className="text-primary underline underline-offset-4">
                {group.length > 1 ? "Подставить все" : "Подставить"}
              </button>
              <button type="button" onClick={() => onDismiss(group)} className="text-muted-foreground underline underline-offset-4">
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
// Их можно не вписывать руками: они заполняются из анкет и карточки предприятия в «Моих документах».
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

  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto w-full max-w-[680px] px-4 pb-10">
        <BackLink href="/me">Мои данные</BackLink>
        <PageTitle className="mt-4">Реквизиты</PageTitle>
        <p className="mt-3 max-w-[48ch] text-[17px] leading-[26px] text-[var(--ink-2)]">
          Впишите один раз — дальше они сами попадут в анкету, декларацию, предложение о цене и подпись. В техническое предложение реквизиты не попадают никогда: его подают анонимно.
        </p>

        {sourceDocs.length > 0 ? (
          <button
            type="button"
            onClick={() => void fillFromDocuments()}
            disabled={filling || !profile}
            className="mt-4 min-h-11 rounded-[var(--r-ctl)] bg-muted px-5 font-semibold hover:bg-accent disabled:opacity-60"
          >
            {filling ? "Ищу реквизиты в документах…" : "Заполнить из моих документов"}
          </button>
        ) : (
          <p className="mt-4 text-[15px] leading-[22px] text-muted-foreground">
            Можно не вписывать руками: загрузите анкету или карточку предприятия в{" "}
            <Link href="/me/documents" className="font-semibold text-primary underline underline-offset-4">
              «Мои документы»
            </Link>{" "}
            — реквизиты заполнятся сами.
          </p>
        )}

        {fillNote && (
          <Note tone={fillNote.tone} icon={fillNote.tone === "ok" ? CheckIcon : fillNote.tone === "warn" ? AlertTriangleIcon : undefined} className="mt-3">
            {fillNote.text}
          </Note>
        )}

        {loadError && (
          <Note tone="warn" icon={AlertTriangleIcon} className="mt-5">
            Браузер не дал открыть сохранённые реквизиты. Обновите страницу.
          </Note>
        )}

        {meta.suggestions.length > 0 && <Suggestions items={meta.suggestions} onAccept={accept} onDismiss={dismiss} />}

        {profile &&
          PROFILE_GROUPS.map((group) => (
            <section key={group.title} className="mt-7">
              <h2 className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.06em] text-muted-foreground">{group.title}</h2>
              <div className="grid gap-4 rounded-[var(--r-card)] bg-card p-[18px]">
                {group.fields.map((field) => (
                  <label key={field.key} className="grid gap-1.5">
                    <span className="text-[14.5px] font-semibold">{field.label}</span>
                    <input
                      value={profile[field.key]}
                      onChange={(e) => change(field.key, e.target.value)}
                      placeholder={field.example}
                      className="h-11 rounded-[var(--r-ctl)] bg-muted px-3 text-base outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary"
                    />
                    {meta.sources[field.key] && (
                      <span className="text-[13.5px] text-muted-foreground">из «{meta.sources[field.key]}»</span>
                    )}
                  </label>
                ))}
              </div>
            </section>
          ))}

        <p className="sticky bottom-0 mt-4 bg-gradient-to-b from-transparent to-background to-40% pb-[calc(12px+env(safe-area-inset-bottom,0px))] pt-5 text-[14.5px] text-muted-foreground" aria-live="polite">
          {save === "saving" && "Сохраняю…"}
          {save === "saved" && "Сохранено в этом браузере."}
          {save === "failed" && <span className="font-semibold text-[var(--warn)]">Не получилось сохранить — попробуйте ещё раз.</span>}
        </p>
      </main>
    </div>
  );
}
