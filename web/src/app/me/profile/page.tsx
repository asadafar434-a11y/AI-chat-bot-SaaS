"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BackupIsland } from "@/components/backup-island";
import { Hint } from "@/components/hint";
import { BankIcon, CheckIcon, DocumentIcon, PlusIcon, UploadIcon, WarningIcon } from "@/components/icons";
import { Badge } from "@/components/badge";
import { Island } from "@/components/island";
import { Note } from "@/components/note";
import { PageBody, PageHeader } from "@/components/page-header";
import { WipeIsland } from "@/components/wipe-island";
import {
  fillProfileFromDocuments,
  getProfile,
  getProfileMeta,
  listMyDocuments,
  saveProfile,
  type MyDocument,
  type ProfileMeta,
} from "@/lib/me-store";
import { DOC_KINDS, REQUISITE_KINDS, type FoundField } from "@/lib/my-docs";
import { plural } from "@/lib/plural";
import { filledCount, PROFILE_GROUPS, PROFILE_KEYS, type Profile, type ProfileKey } from "@/lib/profile";
import { profileProblems } from "@/lib/requisites-check";

type SaveState = "idle" | "saving" | "saved" | "failed";
type FillNote = { tone: "ok" | "info" | "warn"; text: string };

const LABELS = Object.fromEntries(PROFILE_GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f.label]))) as Record<ProfileKey, string>;

// Разделы страницы — как в прототипе: три карточки вместо пяти групп. Поля и их порядок те же (lib/profile.ts).
const SECTIONS = [
  { title: "Организация", hint: "Подставляется в заявку, декларацию СМП и контракт", groups: ["Участник", "Налоги", "Адреса"] },
  { title: "Банковские реквизиты", hint: "Используются для обеспечения заявки и оплаты", groups: ["Банк"] },
  { title: "Руководитель и контакты", hint: "Для подписи и связи с заказчиком", groups: ["Руководитель и контакты"] },
];

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
        <WarningIcon className="size-4 shrink-0" />
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
// Их можно не вписывать руками: они заполняются из анкет и карточки предприятия в «Образцах и реквизитах».
export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [meta, setMeta] = useState<ProfileMeta>({ sources: {}, suggestions: [] });
  const [docs, setDocs] = useState<MyDocument[]>([]);
  const [save, setSave] = useState<SaveState>("idle");
  const [loadError, setLoadError] = useState(false);
  const [filling, setFilling] = useState(false);
  const [fillNote, setFillNote] = useState<FillNote | null>(null);
  // Подсказка о формате не появляется, пока поле в фокусе: недописанный номер — ещё не ошибка.
  const [focused, setFocused] = useState<ProfileKey | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Реквизиты и документы перечитываются и после загрузки копии: из неё могли прийти и те, и другие.
  function read() {
    Promise.all([getProfile(), getProfileMeta()]).then(
      ([p, m]) => {
        setProfile(p);
        setMeta(m);
      },
      () => setLoadError(true)
    );
    listMyDocuments().then(setDocs, () => setDocs([]));
  }

  useEffect(() => {
    read();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Ссылка из справки ведёт к копии данных внизу. Реквизиты появляются после загрузки и сдвигают её — докручиваем.
  const loaded = profile !== null;
  useEffect(() => {
    if (loaded && window.location.hash === "#backup") document.getElementById("backup")?.scrollIntoView({ block: "start" });
  }, [loaded]);

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

  const problems = profile ? profileProblems(profile) : {};

  const saveText =
    save === "saving" ? "Сохраняю…" : save === "saved" ? "Сохранено" : save === "failed" ? "Не сохранилось — попробуйте ещё раз" : "";

  return (
    <>
      <PageHeader
        title="Профиль компании"
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
                «Образцы и реквизиты»
              </Link>{" "}
              — реквизиты заполнятся сами.
            </p>
          )}

          {profile && (
            <>
              <section className="island flex flex-wrap items-center gap-4 p-[var(--pad)]">
                <span aria-hidden className="grid size-12 flex-none place-items-center rounded-[var(--r-card)] bg-primary text-[var(--on-brand)]">
                  <BankIcon className="size-6" />
                </span>
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <p className="t-title truncate">{profile.shortName.trim() || profile.fullName.trim() || "Название компании не указано"}</p>
                  <p className="font-mono text-[12px] text-[var(--ink-3)]">
                    {profile.inn.trim() ? `ИНН ${profile.inn.trim()}` : "ИНН не указан"}
                    {profile.kpp.trim() ? ` · КПП ${profile.kpp.trim()}` : ""}
                  </p>
                </div>
                {profile.smeCategory.trim() && (
                  <span title="Категория субъекта МСП — из профиля. Нужна для закупок только у малого бизнеса.">
                    <Badge tone="ok" text={profile.smeCategory.trim()} icon="check" />
                  </span>
                )}
              </section>
              <p className="island bg-[var(--paper-2)] p-[var(--pad)] text-[var(--ink-2)]">
                <b className="font-semibold text-foreground">Как это работает: </b>
                когда ИИ составляет документы заявки, он берёт эти реквизиты и вставляет их в нужные поля — на шаге «Проверка» у
                каждого поля видно, что оно взято из профиля. Изменятся данные (например, новый расчётный счёт) — обновите их
                здесь один раз, и все будущие заявки подхватят новое значение.
              </p>
            </>
          )}

          {fillNote && (
            <Note tone={fillNote.tone} icon={fillNote.tone === "ok" ? CheckIcon : fillNote.tone === "warn" ? WarningIcon : undefined}>
              {fillNote.text}
            </Note>
          )}
          {save === "failed" && (
            <Note tone="warn" icon={WarningIcon} className="sm:hidden">
              Не получилось сохранить — попробуйте ещё раз.
            </Note>
          )}
          {loadError && (
            <Note tone="warn" icon={WarningIcon}>
              Браузер не дал открыть сохранённые реквизиты. Обновите страницу.
            </Note>
          )}

          {meta.suggestions.length > 0 && <Suggestions items={meta.suggestions} onAccept={accept} onDismiss={dismiss} />}

          {profile &&
            SECTIONS.map((section, gi) => (
              <Island key={section.title} id={`pg-${gi}`} title={section.title} sub={section.hint}>
                <div className="grid px-[var(--pad)] pb-3 pt-1">
                  {PROFILE_GROUPS.filter((g) => section.groups.includes(g.title)).flatMap((g) => g.fields).map((field) => {
                    const hint = focused === field.key ? undefined : problems[field.key];
                    return (
                      <div
                        key={field.key}
                        className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-x-4 gap-y-1 py-1.5 max-sm:grid-cols-1"
                      >
                        <div className="flex items-center gap-0.5">
                          <label htmlFor={`pf-${field.key}`} className="text-[var(--ink-2)]">
                            {field.label}
                          </label>
                          {field.help && <Hint label={field.label}>{field.help}</Hint>}
                        </div>
                        <input
                          id={`pf-${field.key}`}
                          value={profile[field.key]}
                          onChange={(e) => change(field.key, e.target.value)}
                          onFocus={() => setFocused(field.key)}
                          onBlur={() => setFocused(null)}
                          placeholder={field.example}
                          autoComplete="off"
                          aria-invalid={hint ? true : undefined}
                          aria-describedby={hint ? `pf-${field.key}-hint` : undefined}
                          className="field"
                        />
                        {hint && (
                          <span id={`pf-${field.key}-hint`} className="t-caption col-start-2 text-[var(--warn)] max-sm:col-start-1">
                            {hint}
                          </span>
                        )}
                        {meta.sources[field.key] && (
                          <span className="t-caption col-start-2 text-[var(--ink-3)] max-sm:col-start-1">
                            из «{meta.sources[field.key]}»
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Island>
            ))}

          {profile && (
            <Island
              id="pg-samples"
              title="Образцы и документы"
              count={docs.length || undefined}
              sub="Прошлые заявки, прайсы, исполненные контракты. По ним ИИ пишет новые документы так же, как ваши."
              action={
                <Link href="/me/documents" className="btn btn-line btn-xs">
                  <PlusIcon />
                  Добавить
                </Link>
              }
            >
              {docs.length === 0 ? (
                <p className="px-[var(--pad)] pb-3 pt-1 text-[var(--ink-3)]">Документов пока нет — загрузите прошлые заявки и карточку предприятия.</p>
              ) : (
                <ul className="grid px-[var(--pad)] pb-3 pt-1">
                  {docs.slice(0, 6).map((d) => (
                    <li key={d.id} className="flex items-start gap-3 py-2">
                      <DocumentIcon className="mt-0.5 size-4 flex-none text-[var(--ink-3)]" />
                      <span className="grid min-w-0 flex-1">
                        <span className="t-label truncate">{d.name}</span>
                        {d.about && <span className="t-caption truncate text-[var(--ink-3)]">{d.about}</span>}
                      </span>
                      <Badge tone="calm" text={DOC_KINDS[d.kinds[0]].few} />
                    </li>
                  ))}
                </ul>
              )}
              {docs.length > 6 && (
                <p className="px-[var(--pad)] pb-3">
                  <Link href="/me/documents" className="link t-caption">
                    Все документы ({docs.length})
                  </Link>
                </p>
              )}
            </Island>
          )}

          <BackupIsland onRestored={read} />
          <WipeIsland />
        </div>
      </PageBody>
    </>
  );
}
