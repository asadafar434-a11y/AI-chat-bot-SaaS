import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { exportBackup, restoreBackup } from '@/lib/backup';
import { parseBackup } from '@/lib/backup-format';
import {
  deleteMyDocument,
  fillProfileFromDocuments,
  getProfile,
  getProfileMeta,
  listMyDocuments,
  samplesOf,
  saveMyDocuments,
  saveProfile,
  sortDocuments,
  type MyDocument,
  type ProfileMeta,
} from '@/lib/me-store';
import { errorMessage } from '@/lib/http-error';
import { DOC_KIND_KEYS, DOC_KINDS, PART_SAMPLE_KIND, REQUISITE_KINDS, type DocKind, type FoundField } from '@/lib/my-docs';
import { plural } from '@/lib/plural';
import { filledCount, PROFILE_GROUPS, PROFILE_KEYS, type Profile as ProfileData, type ProfileKey } from '@/lib/profile';
import { ACCEPTED_FILES, readDocuments, type FailedFile } from '@/lib/read-documents';
import { profileProblems } from '@/lib/requisites-check';
import { saveFile } from '@/lib/save-file';
import { wipeAll } from '@/lib/wipe';
import {
  AlertTriangle,
  Building2,
  Check,
  Download,
  FileText,
  Info,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from '../lib/icons';
import { EvidenceBase } from './EvidenceBase';
import { Badge, Button, Card, HelpTip, IconButton, Tooltip, cx } from './ui';

// «Профиль компании»: реквизиты для анкеты, декларации и цены, база доказательств (лицензии, договоры, сотрудники, оборудование,
// финансы — с источником и сроком), образцы прошлых заявок и копия данных. Вид — прототипа,
// данные — настоящие, из браузера (IndexedDB). Реквизиты сохраняются сами, пока их вписывают: «Отмена» возвращает то, что
// было до правки, а потерять набранное из-за закрытой вкладки нельзя.

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';
type Stage = 'reading' | 'sorting' | 'profile';
type Tone = 'ok' | 'info' | 'warn';
type Outcome = { tone: Tone; text: string };

const STAGE_TEXT: Record<Stage, string> = {
  reading: 'Читаю файлы…',
  sorting: 'Раскладываю по видам…',
  profile: 'Заполняю реквизиты…',
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

const LABELS = Object.fromEntries(PROFILE_GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f.label]))) as Record<ProfileKey, string>;

// Разделы — как в прототипе: три карточки. Поля и их порядок те же, что в приложении (lib/profile.ts).
const SECTIONS = [
  { title: 'Организация', hint: 'Подставляется в заявку, декларацию СМП и контракт', groups: ['Участник', 'Налоги', 'Адреса'] },
  { title: 'Банковские реквизиты', hint: 'Используются для обеспечения заявки и оплаты', groups: ['Банк'] },
  { title: 'Руководитель и контакты', hint: 'Для подписи и связи с заказчиком', groups: ['Руководитель и контакты'] },
];

// Банковские реквизиты подставляются только вместе: счёт одного банка с БИК другого — ошибка в заявке.
const BANK_KEYS: ProfileKey[] = ['account', 'bankName', 'bik', 'corrAccount'];

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

// Виды, по которым пишутся части заявки: у них бывает «образцов уже достаточно».
const SAMPLE_KINDS: DocKind[] = ['tp', ...Object.values(PART_SAMPLE_KIND)];
const pages = (text: string) => Math.max(1, Math.round(text.length / 2500));

// «1 закупка, 2 образца, 3 факта и реквизиты» — только то, что есть.
function contents({ purchases, samples, facts, profile }: { purchases: number; samples: number; facts: number; profile: boolean }) {
  const parts = [
    purchases > 0 && `${purchases} ${plural(purchases, 'закупка', 'закупки', 'закупок')}`,
    samples > 0 && `${samples} ${plural(samples, 'образец', 'образца', 'образцов')}`,
    facts > 0 && `${facts} ${plural(facts, 'факт', 'факта', 'фактов')} базы доказательств`,
    profile && 'реквизиты',
  ].filter((part): part is string => Boolean(part));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} и ${parts.at(-1)}` : (parts[0] ?? '');
}

function Notice({ tone, children }: { tone: Tone; children: ReactNode }) {
  const Icon = tone === 'ok' ? Check : tone === 'warn' ? AlertTriangle : Info;
  return (
    <p
      role={tone === 'warn' ? 'alert' : 'status'}
      className={cx(
        'flex items-start gap-2 rounded-md px-3 py-2 text-[13px] leading-snug',
        tone === 'ok' && 'bg-success/10 text-success',
        tone === 'warn' && 'bg-warn-surface/50 text-warn-foreground',
        tone === 'info' && 'bg-info/10 text-info',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

// Другие значения из документов: например, старый расчётный счёт в анкете позапрошлого года.
function Suggestions({ items, onAccept, onDismiss }: { items: FoundField[]; onAccept: (g: FoundField[]) => void; onDismiss: (g: FoundField[]) => void }) {
  return (
    <Card className="space-y-3 border-warn/40 bg-warn-surface/30 p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-warn-foreground">
        <AlertTriangle className="size-4 shrink-0" /> В ваших документах есть другие значения — проверьте, какое верное
      </p>
      <ul className="space-y-3">
        {groupSuggestions(items).map((group, i) => (
          <li key={i} className="space-y-1.5 break-words text-[13px]">
            <p>
              {group.length > 1 ? (
                <>
                  <b className="font-semibold">Банковские реквизиты:</b> {group.map((item) => item.value).join(', ')}
                </>
              ) : (
                <>
                  <b className="font-semibold">{LABELS[group[0].key]}:</b> {group[0].value}
                </>
              )}{' '}
              <span className="text-muted-foreground">— из «{group[0].source}»</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => onAccept(group)}>
                {group.length > 1 ? 'Подставить все' : 'Подставить'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onDismiss(group)}>
                Оставить как есть
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// Вид документа меняют, если приложение ошиблось при раскладке: один файл может быть сразу несколькими видами.
function KindEditor({ doc, onSave, onCancel }: { doc: MyDocument; onSave: (kinds: DocKind[]) => void; onCancel: () => void }) {
  const [kinds, setKinds] = useState<DocKind[]>(doc.kinds);
  const toggle = (kind: DocKind) => setKinds(kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind]);
  return (
    <div className="space-y-2.5 pl-7">
      <p className="text-[13px] font-medium">Что в этом файле? Можно выбрать несколько.</p>
      <div className="flex flex-wrap gap-2">
        {DOC_KIND_KEYS.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={kinds.includes(kind)}
            onClick={() => toggle(kind)}
            className={cx(
              'rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
              kinds.includes(kind) ? 'border-foreground bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:bg-secondary',
            )}
          >
            {DOC_KINDS[kind].group}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSave(kinds.length ? DOC_KIND_KEYS.filter((k) => kinds.includes(k)) : ['other'])}>
          Готово
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

export function Profile() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [meta, setMeta] = useState<ProfileMeta>({ sources: {}, suggestions: [] });
  const [docs, setDocs] = useState<MyDocument[]>([]);
  const [save, setSave] = useState<SaveState>('idle');
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [snapshot, setSnapshot] = useState<{ profile: ProfileData; meta: ProfileMeta } | null>(null);
  const [filling, setFilling] = useState(false);
  const [fillNote, setFillNote] = useState<Outcome | null>(null);
  // Подсказка о формате не появляется, пока поле в фокусе: недописанный номер — ещё не ошибка.
  const [focused, setFocused] = useState<ProfileKey | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<{ profile: ProfileData; meta: ProfileMeta } | null>(null);

  // Образцы
  const [stage, setStage] = useState<Stage | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingDoc, setEditingDoc] = useState<string | null>(null);
  const [confirmDoc, setConfirmDoc] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Копия данных и удаление
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupNote, setBackupNote] = useState<Outcome | null>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const [wipe, setWipe] = useState<'idle' | 'confirm' | 'wiping' | 'blocked' | 'failed'>('idle');

  // Реквизиты и документы перечитываются и после загрузки копии: из неё могли прийти и те, и другие.
  function read() {
    Promise.all([getProfile(), getProfileMeta()]).then(
      ([p, m]) => {
        latest.current = { profile: p, meta: m };
        setProfile(p);
        setMeta(m);
      },
      () => setLoadError(true),
    );
    listMyDocuments().then(setDocs, () => setDocs([]));
  }

  useEffect(() => {
    read();
    return () => {
      // Ушли со страницы, не дождавшись сохранения, — дописываем его сейчас.
      if (timer.current && latest.current) {
        clearTimeout(timer.current);
        void saveProfile(latest.current.profile, latest.current.meta);
      }
    };
  }, []);

  function persist(nextProfile: ProfileData, nextMeta: ProfileMeta) {
    latest.current = { profile: nextProfile, meta: nextMeta };
    setProfile(nextProfile);
    setMeta(nextMeta);
    setSave('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      saveProfile(nextProfile, nextMeta).then(
        () => setSave('saved'),
        () => setSave('failed'),
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
      },
    );
  }

  const dismiss = (group: FoundField[]) => profile && persist(profile, { ...meta, suggestions: meta.suggestions.filter((s) => !group.includes(s)) });

  const startEdit = () => {
    if (!profile) return;
    setSnapshot({ profile, meta });
    setEditing(true);
  };
  const cancelEdit = () => {
    if (snapshot) persist(snapshot.profile, snapshot.meta);
    setEditing(false);
    setSnapshot(null);
  };
  const finishEdit = () => {
    setEditing(false);
    setSnapshot(null);
  };

  const sourceDocs = docs.filter((d) => d.kinds.some((k) => REQUISITE_KINDS.includes(k)));

  async function fillFromDocuments() {
    if (!profile) return;
    setFilling(true);
    setFillNote(null);
    try {
      // Сначала сохраняем то, что вписано в последние полсекунды, — иначе заполнение из документов это затрёт.
      if (timer.current && latest.current) {
        clearTimeout(timer.current);
        timer.current = null;
        await saveProfile(latest.current.profile, latest.current.meta);
      }
      const { filled } = await fillProfileFromDocuments(docs);
      const [p, m] = await Promise.all([getProfile(), getProfileMeta()]);
      latest.current = { profile: p, meta: m };
      setProfile(p);
      setMeta(m);
      setSave('saved');
      setFillNote(
        filled.length
          ? { tone: 'ok', text: `Заполнил ${filled.length} ${plural(filled.length, 'поле', 'поля', 'полей')} из ваших документов — под ними написано, откуда. Проверьте.` }
          : { tone: 'info', text: 'Нового в документах не нашлось: всё, что там есть, уже вписано.' },
      );
    } catch (e) {
      setFillNote({ tone: 'warn', text: errorMessage(e) });
    } finally {
      setFilling(false);
    }
  }

  // Загрузка документов: прочитать, разложить по видам, записать, заполнить реквизиты из анкет и карточки.
  async function add(files: File[]) {
    setError(null);
    setReport(null);
    setStage('reading');
    try {
      const { documents, failed } = await readDocuments(files);
      setStage('sorting');
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
        ...(d.map && { map: d.map }),
      }));
      await saveMyDocuments(added);
      const next: Report = { added, failed, sortError };

      if (!sortError && added.some((d) => d.kinds.some((k) => REQUISITE_KINDS.includes(k)))) {
        setStage('profile');
        try {
          const { filled, suggestions } = await fillProfileFromDocuments(await listMyDocuments());
          next.filled = filled.length;
          next.suggestions = suggestions;
        } catch (e) {
          next.profileError = errorMessage(e);
        }
      }
      setReport(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStage(null);
      read();
    }
  }

  async function saveKinds(doc: MyDocument, kinds: DocKind[]) {
    setEditingDoc(null);
    try {
      await saveMyDocuments([{ ...doc, kinds }]);
      read();
    } catch {
      setError('Не получилось сохранить — попробуйте ещё раз.');
    }
  }

  async function removeDoc(id: string) {
    setConfirmDoc(null);
    try {
      await deleteMyDocument(id);
      read();
    } catch {
      setError('Не получилось удалить документ — попробуйте ещё раз.');
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const files = [...e.dataTransfer.files];
    if (files.length && stage === null) void add(files);
  };

  // Данные живут только в этом браузере: копия файлом — единственный способ вернуть их, если браузер их стёр,
  // и перенести на другой компьютер.
  async function saveBackup() {
    setBackupBusy(true);
    setBackupNote(null);
    try {
      const { backup, ...counts } = await exportBackup();
      const inside = contents(counts);
      if (!inside) {
        setBackupNote({ tone: 'info', text: 'Сохранять пока нечего: в этом браузере нет ни закупок, ни образцов, ни фактов, ни реквизитов.' });
        return;
      }
      const name = `Тендерный юрист — копия ${new Date(backup.savedAt).toLocaleDateString('ru-RU')}.json`;
      saveFile(new Blob([JSON.stringify(backup)], { type: 'application/json' }), name);
      setBackupNote({ tone: 'ok', text: `Копия сохранена — файл «${name}» в загрузках браузера. В нём ${inside}.` });
    } catch {
      setBackupNote({ tone: 'warn', text: 'Браузер не дал прочитать данные — копия не сохранилась. Обновите страницу и попробуйте ещё раз.' });
    } finally {
      setBackupBusy(false);
    }
  }

  async function loadBackup(file: File) {
    setBackupBusy(true);
    setBackupNote(null);
    try {
      let raw: unknown = null;
      try {
        raw = JSON.parse(await file.text());
      } catch {
        // Не JSON — parseBackup скажет, что это не копия.
      }
      const parsed = parseBackup(raw);
      if (!parsed.ok) {
        setBackupNote({ tone: 'warn', text: parsed.reason });
        return;
      }
      const added = contents(await restoreBackup(parsed.dump));
      setBackupNote(
        added
          ? { tone: 'ok', text: `Из копии добавлено: ${added}. То, что уже было в браузере, не тронуто.` }
          : { tone: 'info', text: 'Всё из копии уже есть в этом браузере — ничего не менял.' },
      );
      read();
    } catch {
      setBackupNote({ tone: 'warn', text: 'Браузер не дал записать данные — возможно, на диске кончилось место. Освободите место и загрузите копию ещё раз.' });
    } finally {
      setBackupBusy(false);
    }
  }

  async function wipeAllData() {
    setWipe('wiping');
    try {
      if ((await wipeAll()) === 'blocked') {
        setWipe('blocked');
        return;
      }
      // Приложение открывается заново, с чистого листа: с вопроса о согласии. Нужна полная перезагрузка — она сбрасывает
      // открытые соединения с базами и всё, что приложение держит в памяти.
      window.location.assign('/');
    } catch {
      setWipe('failed');
    }
  }

  const problems = profile ? profileProblems(profile) : {};
  const used = new Map(SAMPLE_KINDS.map((kind) => [kind, new Set(samplesOf(docs, kind).map((d) => d.id))]));
  const saveText = save === 'saving' ? 'Сохраняю…' : save === 'saved' ? 'Сохранено' : save === 'failed' ? 'Не сохранилось — попробуйте ещё раз' : '';

  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Профиль компании</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            Заполните реквизиты один раз — ИИ будет автоматически подставлять их в каждую заявку, декларацию и контракт. Не придётся
            вводить одни и те же данные для каждой закупки. В техническое предложение реквизиты не попадают никогда: его подают анонимно.
          </p>
          <p className="mt-1 font-mono text-[12px] text-muted-foreground">
            заполнено {profile ? filledCount(profile) : 0} из {PROFILE_KEYS.length}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {saveText && (
            <span aria-live="polite" className={cx('inline-flex items-center gap-1.5 text-xs', save === 'failed' ? 'text-warn-foreground' : 'text-success')}>
              {save === 'saved' && <Check className="size-3.5" />} {saveText}
            </span>
          )}
          {sourceDocs.length > 0 && (
            <Tooltip content="ИИ найдёт реквизиты в ваших анкетах и карточке предприятия и впишет пустые поля." align="end">
              <Button variant="secondary" onClick={() => void fillFromDocuments()} disabled={filling || !profile}>
                {filling ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {filling ? 'Ищу реквизиты…' : 'Заполнить из документов'}
              </Button>
            </Tooltip>
          )}
          {editing ? (
            <>
              <Button variant="secondary" onClick={cancelEdit}>
                Отмена
              </Button>
              <Button onClick={finishEdit}>
                <Check className="size-4" /> Сохранить изменения
              </Button>
            </>
          ) : (
            <Button onClick={startEdit} disabled={!profile}>
              <Pencil className="size-4" /> Редактировать профиль
            </Button>
          )}
        </div>
      </div>

      {fillNote && <Notice tone={fillNote.tone}>{fillNote.text}</Notice>}
      {loadError && <Notice tone="warn">Браузер не дал открыть сохранённые реквизиты. Обновите страницу.</Notice>}
      {save === 'failed' && <Notice tone="warn">Не получилось сохранить реквизиты — не закрывайте страницу и попробуйте ещё раз.</Notice>}

      {profile && (
        <>
          {/* Company header card */}
          <Card className="flex flex-wrap items-center gap-4 p-5">
            <div className="flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Building2 className="size-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold">{profile.shortName.trim() || profile.fullName.trim() || 'Название компании не указано'}</p>
              <p className="font-mono text-[12px] text-muted-foreground">
                {profile.inn.trim() ? `ИНН ${profile.inn.trim()}` : 'ИНН не указан'}
                {profile.kpp.trim() ? ` · КПП ${profile.kpp.trim()}` : ''}
              </p>
            </div>
            {profile.smeCategory.trim() && (
              <Tooltip content="Категория субъекта МСП — из профиля. Нужна для закупок только у малого бизнеса." align="end">
                <Badge tone="success">
                  <ShieldCheck className="size-3" /> {profile.smeCategory.trim()}
                </Badge>
              </Tooltip>
            )}
          </Card>

          {/* How it works */}
          <Card className="flex gap-3 bg-secondary/40 p-4">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-[13px] leading-snug text-muted-foreground">
              <span className="font-medium text-foreground">Как это работает: </span>
              когда ИИ составляет документы заявки, он берёт эти реквизиты и вставляет их в нужные поля автоматически — у каждого поля
              на шаге «Проверка» видно, что оно взято из профиля. Если данные изменятся (например, новый расчётный счёт) — обновите их
              здесь один раз, и все будущие заявки подхватят новое значение.
            </p>
          </Card>

          {meta.suggestions.length > 0 && <Suggestions items={meta.suggestions} onAccept={accept} onDismiss={dismiss} />}

          {/* Fields by group */}
          <div className="space-y-4">
            {SECTIONS.map((section) => (
              <Card key={section.title} className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <span className="text-sm font-medium">{section.title}</span>
                  <span className="hidden font-mono text-[11px] text-muted-foreground sm:block">{section.hint}</span>
                </div>
                <div className="divide-y divide-border">
                  {PROFILE_GROUPS.filter((g) => section.groups.includes(g.title))
                    .flatMap((g) => g.fields)
                    .map((field) => {
                      const value = profile[field.key];
                      const hint = focused === field.key ? undefined : problems[field.key];
                      return (
                        <div key={field.key} className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[220px_1fr] sm:items-start sm:gap-4">
                          <span className="flex items-start gap-1 text-[13px] text-muted-foreground">
                            <label htmlFor={`pf-${field.key}`}>{field.label}</label>
                            {field.help && <HelpTip content={field.help} />}
                          </span>
                          <div className="min-w-0">
                            {editing ? (
                              <input
                                id={`pf-${field.key}`}
                                value={value}
                                onChange={(e) => change(field.key, e.target.value)}
                                onFocus={() => setFocused(field.key)}
                                onBlur={() => setFocused(null)}
                                placeholder={field.example}
                                autoComplete="off"
                                aria-invalid={hint ? true : undefined}
                                aria-describedby={hint ? `pf-${field.key}-hint` : undefined}
                                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground focus:ring-2 focus:ring-ring/20"
                              />
                            ) : (
                              <span className={cx('break-words font-mono text-[13px] tabular-nums', !value.trim() && 'text-muted-foreground')}>{value.trim() || '—'}</span>
                            )}
                            {hint && <p id={`pf-${field.key}-hint`} className="mt-1 text-[12px] text-warn-foreground">{hint}</p>}
                            {meta.sources[field.key] && <p className="mt-1 text-[11px] text-muted-foreground">из «{meta.sources[field.key]}»</p>}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </Card>
            ))}
          </div>

          {/* База доказательств: факты о компании с источником и сроком; что требуют закупки и чего не хватает */}
          <EvidenceBase profile={profile} sources={meta.sources} docs={docs} />
        </>
      )}

      {/* Образцы и документы компании */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <span className="text-sm font-medium">
              Образцы и документы{docs.length > 0 && <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{docs.length}</span>}
            </span>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Прошлые заявки, анкеты, карточка предприятия, исполненные договоры. По ним ИИ пишет новые документы так же, как ваши, и заполняет реквизиты.
            </p>
          </div>
          <Button size="sm" variant="secondary" disabled={stage !== null} onClick={() => fileInput.current?.click()}>
            <Plus className="size-3.5" /> Добавить
          </Button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPTED_FILES}
            className="hidden"
            onChange={(e) => {
              const files = e.currentTarget.files ? [...e.currentTarget.files] : [];
              e.currentTarget.value = '';
              if (files.length) void add(files);
            }}
          />
        </div>

        <div className="space-y-2 px-4 pt-3 empty:hidden" aria-live="polite">
          {error && <Notice tone="warn">{error}</Notice>}
          {report && (
            <>
              {report.added.length > 0 && (
                <Notice tone="ok">
                  Добавил {report.added.length} {plural(report.added.length, 'документ', 'документа', 'документов')}:{' '}
                  {DOC_KIND_KEYS.map((kind) => [kind, report.added.filter((d) => d.kinds.includes(kind)).length] as const)
                    .filter(([, n]) => n > 0)
                    .map(([kind, n]) => `${DOC_KINDS[kind].few} — ${n}`)
                    .join(', ')}
                  .
                </Notice>
              )}
              {report.sortError && (
                <Notice tone="warn">Разложил по названиям файлов, без ИИ. Проверьте виды и поправьте, где нужно. {report.sortError}</Notice>
              )}
              {report.filled !== undefined && (
                <Notice tone={report.filled ? 'ok' : 'info'}>
                  {report.filled
                    ? `Реквизиты: заполнил ${report.filled} ${plural(report.filled, 'поле', 'поля', 'полей')} из ваших документов — проверьте их выше.`
                    : 'Реквизиты: нового в документах не нашлось.'}
                  {report.suggestions ? ' Есть расхождения между документами — они показаны подсказками в реквизитах.' : ''}
                </Notice>
              )}
              {report.profileError && <Notice tone="warn">Реквизиты заполнить не получилось: {report.profileError}</Notice>}
              {report.failed.length > 0 && (
                <Notice tone="warn">Не получилось прочитать: {report.failed.map((f) => `${f.name} — ${f.reason}`).join('; ')}.</Notice>
              )}
            </>
          )}
        </div>

        {stage && (
          <div className="px-4 py-6" aria-live="polite">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="size-4 animate-spin" /> {STAGE_TEXT[stage]}
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">Сканы и фото распознаются дольше — примерно минута на каждые 10 страниц.</p>
          </div>
        )}

        <div className="divide-y divide-border">
          {docs.map((d) => {
            const first = d.kinds[0];
            const others = d.kinds.filter((k) => k !== first);
            const unused = used.get(first) && !used.get(first)!.has(d.id);
            const meta = [
              `≈ ${pages(d.text)} ${plural(pages(d.text), 'страница', 'страницы', 'страниц')}`,
              `добавлен ${new Date(d.addedAt).toLocaleDateString('ru-RU')}`,
              ...(d.scan ? ['распознан со скана — сверьте цифры'] : []),
              ...(unused ? ['не используется: образцов уже достаточно'] : []),
            ].join(' · ');
            return (
              <div key={d.id} className="space-y-2 px-4 py-3">
                <div className="flex items-start gap-3">
                  <FileText className={cx('mt-0.5 size-4 shrink-0', d.scan ? 'text-warn' : 'text-muted-foreground')} />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium">{d.name}</p>
                    {d.about && <p className="mt-0.5 text-[12px] text-muted-foreground">{d.about}</p>}
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{meta}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    <Badge>{DOC_KINDS[first].few}</Badge>
                    {others.map((k) => (
                      <Badge key={k}>{DOC_KINDS[k].few}</Badge>
                    ))}
                    <IconButton
                      label="Изменить вид"
                      onClick={() => {
                        setConfirmDoc(null);
                        setEditingDoc(editingDoc === d.id ? null : d.id);
                      }}
                    >
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton
                      label="Удалить"
                      tone="danger"
                      align="end"
                      onClick={() => {
                        setEditingDoc(null);
                        setConfirmDoc(confirmDoc === d.id ? null : d.id);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </div>
                {editingDoc === d.id && <KindEditor doc={d} onSave={(kinds) => void saveKinds(d, kinds)} onCancel={() => setEditingDoc(null)} />}
                {confirmDoc === d.id && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-7 text-[13px]">
                    <span>{others.length ? 'Удалить файл целиком, из всех групп?' : 'Удалить документ?'}</span>
                    <Button size="sm" variant="danger" onClick={() => void removeDoc(d.id)}>
                      Удалить
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setConfirmDoc(null)}>
                      Отмена
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!stage && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            className="p-3"
          >
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className={cx(
                'flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center transition-colors',
                drag ? 'border-foreground bg-secondary' : 'border-border hover:bg-secondary/50',
              )}
            >
              <Upload className="size-5 text-muted-foreground" />
              <span className="text-sm font-medium">{docs.length ? 'Добавить документы' : 'Загрузить документы'}</span>
              <span className="max-w-[60ch] text-[12px] text-muted-foreground">
                {docs.length === 0 && 'Документов пока нет — загрузите прошлые заявки и карточку предприятия. '}
                Перетащите сюда свои документы — PDF, Word, Excel, ZIP, сканы и фото. Можно сразу все.
              </span>
            </button>
          </div>
        )}
      </Card>

      {/* Копия данных */}
      <Card className="space-y-3 p-5">
        <div>
          <span className="text-sm font-medium">Копия данных</span>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Закупки, документы, реквизиты, образцы и база доказательств</p>
        </div>
        <p className="max-w-[70ch] text-[13px] leading-snug text-muted-foreground">
          Всё это хранится только в этом браузере. Если очистить браузер — пропадёт, а Safari может стереть данные сам, если сервис не
          открывать неделю. Сохраняйте копию файлом: из неё всё вернётся, и так же данные переносятся на другой компьютер. В файле
          реквизиты и тексты документов — храните его так же бережно, как сами документы.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={backupBusy} onClick={() => void saveBackup()}>
            <Download className="size-4" /> Сохранить копию
          </Button>
          <Button variant="secondary" disabled={backupBusy} onClick={() => backupInput.current?.click()}>
            <Upload className="size-4" /> Загрузить копию
          </Button>
          <input
            ref={backupInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (file) void loadBackup(file);
            }}
          />
        </div>
        <div aria-live="polite" className="empty:hidden">
          {backupNote && <Notice tone={backupNote.tone}>{backupNote.text}</Notice>}
        </div>
      </Card>

      {/* Удалить все данные */}
      <Card className="space-y-3 p-5">
        <div>
          <span className="text-sm font-medium">Удалить все данные</span>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Из этого браузера — всё сразу</p>
        </div>
        <p className="max-w-[70ch] text-[13px] leading-snug text-muted-foreground">
          Удалятся все закупки с документами и черновиками, реквизиты, образцы, база доказательств, настройки и отметка о согласии. Вернуть их можно будет
          только из копии — сохраните её выше. На сервере данные не хранятся; то, что уже отправлено ИИ, хранится у Anthropic по её
          условиям — подробнее в{' '}
          <a href="/privacy" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">
            политике
          </a>
          .
        </p>
        {wipe === 'confirm' || wipe === 'wiping' ? (
          <div className="space-y-2.5">
            <p className="text-[13px] font-medium">Удалить всё? Вернуть данные можно будет только из копии.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" size="sm" disabled={wipe === 'wiping'} onClick={() => void wipeAllData()}>
                {wipe === 'wiping' ? 'Удаляю…' : 'Удалить всё'}
              </Button>
              {/* Фокус — на безопасном ответе: случайный Enter ничего не удалит. */}
              <Button variant="secondary" size="sm" autoFocus disabled={wipe === 'wiping'} onClick={() => setWipe('idle')}>
                Отмена
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => setWipe('confirm')}>
            <Trash2 className="size-3.5" /> Удалить все мои данные
          </Button>
        )}
        <div aria-live="polite" className="empty:hidden">
          {wipe === 'blocked' && <Notice tone="warn">Сервис открыт ещё в другой вкладке — закройте её: удаление закончится, когда она закроется. Потом обновите эту страницу.</Notice>}
          {wipe === 'failed' && <Notice tone="warn">Браузер не дал удалить данные. Удалите их в настройках браузера — «Очистить данные сайта».</Notice>}
        </div>
      </Card>
    </div>
  );
}
