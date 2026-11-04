import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
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
import { EMPTY_CARD, profileStrength, type CompanyCard } from '@/lib/company-card';
import { getCompanyCard, saveCompanyCard } from '@/lib/company-card-store';
import { listFacts } from '@/lib/evidence-store';
import { errorMessage } from '@/lib/http-error';
import { DOC_KIND_KEYS, DOC_KINDS, PART_SAMPLE_KIND, REQUISITE_KINDS, type DocKind, type FoundField } from '@/lib/my-docs';
import { plural } from '@/lib/plural';
import { EMPTY_PROFILE, filledCount, PROFILE_GROUPS, PROFILE_KEYS, type Profile as ProfileData, type ProfileKey } from '@/lib/profile';
import { ACCEPTED_FILES, readDocuments, type FailedFile } from '@/lib/read-documents';
import { profileProblems } from '@/lib/requisites-check';
import {
  AlertTriangle,
  Building2,
  FileText,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
} from '../lib/icons';
import { CertificatesPanel, ExperiencePanel, IndustriesPanel, LicensesPanel, ProfileBar, ProfileHero, ProfileSteps } from './CompanyProfile';
import { EvidenceBase } from './EvidenceBase';
import { Notice, type Tone } from './Notice';
import { Badge, Button, Card, Chip, HelpTip, IconButton, TabPanel, Tooltip, cx, fieldClass } from './ui';
import { ScreenHeader } from './ScreenHeader';

type TabKey = 'profile' | 'experience' | 'industries' | 'licenses' | 'certificates' | 'evidence' | 'docs';
const TAB_LABELS: Record<TabKey, string> = {
  profile: 'Реквизиты',
  experience: 'Опыт и финансы',
  industries: 'Специализация',
  licenses: 'Лицензии',
  certificates: 'Сертификаты',
  evidence: 'База доказательств',
  docs: 'Образцы и документы',
};

// «Профиль компании»: реквизиты для анкеты, декларации и цены, база доказательств (лицензии, договоры, сотрудники, оборудование,
// финансы — с источником и сроком), образцы прошлых заявок. Вид — прототипа,
// данные — настоящие, из браузера (IndexedDB). Реквизиты сохраняются сами, пока их вписывают: «Отмена» возвращает то, что
// было до правки, а потерять набранное из-за закрытой вкладки нельзя.

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';
type Stage = 'reading' | 'sorting' | 'profile';
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

// Другие значения из документов: например, старый расчётный счёт в анкете позапрошлого года.
function Suggestions({ items, onAccept, onDismiss }: { items: FoundField[]; onAccept: (g: FoundField[]) => void; onDismiss: (g: FoundField[]) => void }) {
  return (
    <Card className="space-y-3 border-warn/40 bg-warn-surface/30 p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-warn-foreground">
        <AlertTriangle className="size-4 shrink-0" /> В ваших документах есть другие значения — проверьте, какое верное
      </p>
      <ul className="space-y-3">
        {groupSuggestions(items).map((group, i) => (
          <li key={i} className="space-y-1.5 break-words text-ui">
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
      <p className="text-ui font-medium">Что в этом файле? Можно выбрать несколько.</p>
      <div className="flex flex-wrap gap-2">
        {DOC_KIND_KEYS.map((kind) => (
          <Chip key={kind} label={DOC_KINDS[kind].group} on={kinds.includes(kind)} onClick={() => toggle(kind)} />
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
  const tabId = useId();
  const [tab, setTab] = useState<TabKey>('profile');
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [meta, setMeta] = useState<ProfileMeta>({ sources: {}, suggestions: [] });
  const [docs, setDocs] = useState<MyDocument[]>([]);
  const [save, setSave] = useState<SaveState>('idle');
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [snapshot, setSnapshot] = useState<{ profile: ProfileData; meta: ProfileMeta } | null>(null);
  const [card, setCard] = useState<CompanyCard>(EMPTY_CARD);
  const [factCount, setFactCount] = useState(0);
  const cardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestCard = useRef<CompanyCard | null>(null);
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
    getCompanyCard().then(setCard, () => undefined);
    listFacts().then((f) => setFactCount(f.length), () => setFactCount(0));
  }

  useEffect(() => {
    read();
    return () => {
      // Ушли со страницы, не дождавшись сохранения, — дописываем его сейчас.
      if (timer.current && latest.current) {
        clearTimeout(timer.current);
        void saveProfile(latest.current.profile, latest.current.meta);
      }
      if (cardTimer.current && latestCard.current) {
        clearTimeout(cardTimer.current);
        void saveCompanyCard(latestCard.current);
      }
    };
  }, []);

  // Карточка компании сохраняется сама, как реквизиты: через паузу после правки, а уходя со страницы — сразу.
  function changeCard(next: CompanyCard) {
    latestCard.current = next;
    setCard(next);
    setSave('saving');
    if (cardTimer.current) clearTimeout(cardTimer.current);
    cardTimer.current = setTimeout(() => {
      cardTimer.current = null;
      latestCard.current = null;
      saveCompanyCard(next).then(
        () => setSave('saved'),
        () => setSave('failed'),
      );
    }, 400);
  }

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

  const problems = profile ? profileProblems(profile) : {};
  const used = new Map(SAMPLE_KINDS.map((kind) => [kind, new Set(samplesOf(docs, kind).map((d) => d.id))]));
  const strength = profileStrength(profile ?? EMPTY_PROFILE, card);
  const barTabs: TabKey[] = ['profile', 'experience', 'industries', 'licenses', 'certificates'];
  const saveText = save === 'saving' ? 'Сохраняю…' : save === 'saved' ? 'Сохранено' : save === 'failed' ? 'Не сохранилось — попробуйте ещё раз' : '';

  return (
    <div className="animate-fade-up space-y-4">
      <ScreenHeader icon="company" title="Профиль компании" hint="Реквизиты для заявок, база доказательств компании и образцы прошлых документов. Копия данных и удаление — в «Настройках»." />

      {loadError && <Notice tone="warn">Браузер не дал открыть сохранённые реквизиты. Обновите страницу.</Notice>}

      <ProfileHero strength={strength} facts={factCount} onOpen={(key) => setTab(key as TabKey)} />

      <ProfileSteps
        idPrefix={tabId}
        active={tab}
        onChange={(key) => setTab(key as TabKey)}
        strength={strength}
        extras={[
          { key: 'evidence', label: TAB_LABELS.evidence, badge: factCount > 0 ? <Badge>{factCount}</Badge> : undefined },
          { key: 'docs', label: TAB_LABELS.docs, badge: docs.length > 0 ? <Badge>{docs.length}</Badge> : undefined },
        ]}
      />

      <TabPanel idPrefix={tabId} tabKey="profile" active={tab}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {/* Подсказка нужна, пока реквизиты не заполнены целиком — дальше она только занимает место. */}
            {!(profile && filledCount(profile) >= PROFILE_KEYS.length) && (
              <p className="max-w-2xl text-sm text-muted-foreground">Заполните один раз — реквизиты сами подставятся в каждую заявку. В техническое предложение они не попадают: его подают анонимно.</p>
            )}
            <p className="mt-1 text-caption tabular-nums text-muted-foreground">
              заполнено {profile ? filledCount(profile) : 0} из {PROFILE_KEYS.length}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {sourceDocs.length > 0 && (
              <Tooltip content="ИИ найдёт реквизиты в ваших анкетах и карточке предприятия и впишет пустые поля." align="end">
                <Button variant="ai" busy={filling} onClick={() => void fillFromDocuments()} disabled={filling || !profile}>
                  {filling ? 'Ищу реквизиты…' : 'Заполнить из документов'}
                </Button>
              </Tooltip>
            )}
            {!editing && (
              <Button onClick={startEdit} disabled={!profile}>
                <Pencil className="size-4" /> Редактировать профиль
              </Button>
            )}
          </div>
        </div>

        {fillNote && <Notice tone={fillNote.tone}>{fillNote.text}</Notice>}
        {save === 'failed' && <Notice tone="warn">Не получилось сохранить реквизиты — не закрывайте страницу и попробуйте ещё раз.</Notice>}

        {profile && (
          <>
            {/* Company header card */}
            <Card className="flex flex-wrap items-center gap-4 p-5">
              <div className="flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Building2 className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="break-words text-base font-semibold">{profile.shortName.trim() || profile.fullName.trim() || 'Название компании не указано'}</p>
                <p className="text-caption tabular-nums text-muted-foreground">
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

            {meta.suggestions.length > 0 && <Suggestions items={meta.suggestions} onAccept={accept} onDismiss={dismiss} />}

            {/* Fields by group */}
            <div className="space-y-4">
              {SECTIONS.map((section) => (
                <Card key={section.title} className="overflow-hidden">
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <span className="text-sm font-medium">{section.title}</span>
                    <span className="hidden text-micro text-muted-foreground sm:block">{section.hint}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-px bg-border lg:grid-cols-2">
                    {PROFILE_GROUPS.filter((g) => section.groups.includes(g.title))
                      .flatMap((g) => g.fields)
                      .map((field) => {
                        const value = profile[field.key];
                        const hint = focused === field.key ? undefined : problems[field.key];
                        return (
                          <div key={field.key} className="min-w-0 space-y-1 bg-card px-4 py-3 last:odd:lg:col-span-2">
                            <span className="flex items-start gap-1 text-caption font-medium text-muted-foreground">
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
                                  className={fieldClass()}
                                />
                              ) : (
                                <span className={cx('break-words text-ui tabular-nums', !value.trim() && 'text-muted-foreground')}>{value.trim() || '—'}</span>
                              )}
                              {hint && <p id={`pf-${field.key}-hint`} className="mt-1 text-caption text-warn-foreground">{hint}</p>}
                              {meta.sources[field.key] && <p className="mt-1 text-micro text-muted-foreground">из «{meta.sources[field.key]}»</p>}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}
      </TabPanel>

      <TabPanel idPrefix={tabId} tabKey="experience" active={tab}>
        <ExperiencePanel card={card} onChange={changeCard} />
      </TabPanel>

      <TabPanel idPrefix={tabId} tabKey="industries" active={tab}>
        <IndustriesPanel card={card} onChange={changeCard} />
      </TabPanel>

      <TabPanel idPrefix={tabId} tabKey="licenses" active={tab}>
        <LicensesPanel card={card} onChange={changeCard} factCount={factCount} onOpenEvidence={() => setTab('evidence')} />
      </TabPanel>

      <TabPanel idPrefix={tabId} tabKey="certificates" active={tab}>
        <CertificatesPanel card={card} onChange={changeCard} factCount={factCount} onOpenEvidence={() => setTab('evidence')} />
      </TabPanel>

      <TabPanel idPrefix={tabId} tabKey="evidence" active={tab}>
        {/* База доказательств: факты о компании с источником и сроком; что требуют закупки и чего не хватает */}
        {profile && <EvidenceBase profile={profile} sources={meta.sources} docs={docs} />}
      </TabPanel>

      <TabPanel idPrefix={tabId} tabKey="docs" active={tab}>
        {/* Образцы и документы компании */}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <span className="text-sm font-medium">
                Образцы и документы{docs.length > 0 && <span className="ml-1.5 font-mono text-micro text-muted-foreground">{docs.length}</span>}
              </span>
              <p className="mt-0.5 text-caption text-muted-foreground">
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
              <p className="mt-1 text-caption text-muted-foreground">Сканы и фото распознаются дольше — примерно минута на каждые 10 страниц.</p>
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
                      {d.about && <p className="mt-0.5 text-caption text-muted-foreground">{d.about}</p>}
                      <p className="mt-0.5 font-mono text-micro text-muted-foreground">{meta}</p>
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
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-7 text-ui">
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
                <span className="max-w-[60ch] text-caption text-muted-foreground">
                  {docs.length === 0 && 'Документов пока нет — загрузите прошлые заявки и карточку предприятия. '}
                  Перетащите сюда свои документы — PDF, Word, Excel, ZIP, сканы и фото. Можно сразу все.
                </span>
              </button>
            </div>
          )}
        </Card>
      </TabPanel>

      {barTabs.includes(tab) && (
        <ProfileBar
          status={saveText ? { text: saveText, failed: save === 'failed' } : null}
          editing={editing && tab === 'profile'}
          onCancel={cancelEdit}
          onSave={finishEdit}
        />
      )}
    </div>
  );
}
