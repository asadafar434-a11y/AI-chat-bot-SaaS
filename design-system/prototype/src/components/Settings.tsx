import { useEffect, useRef, useState, type FormEvent } from 'react';
import { changePassword } from '@/lib/auth-client';
import { exportBackup, localOnlyCounts, migrateLocalToServer, restoreBackup } from '@/lib/backup';
import { parseBackup } from '@/lib/backup-format';
import { plural } from '@/lib/plural';
import { saveFile } from '@/lib/save-file';
import { serverReadsEnabled } from '@/lib/server-reads';
import { useAiEnabled } from '../lib/use-ai-mode';
import { wipeAll } from '@/lib/wipe';
import { useAccount } from '../lib/account';
import { Download, Loader2, LogOut, Moon, Sun, Trash2, Upload } from '../lib/icons';
import { Notice, type Tone } from './Notice';
import { PasswordInput } from './PasswordInput';
import { Button, Card, cx } from './ui';

// «Настройки»: аккаунт (почта, смена пароля, выход), внешний вид (тема) и данные (копия файлом, удаление). Всё, что относится к человеку и его
// данным, а не к реквизитам компании: реквизиты, база доказательств и образцы остаются в «Профиле компании».

type Outcome = { tone: Tone; text: string };

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

const inputClass =
  'h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground';

export function Settings({ dark, setDark }: { dark: boolean; setDark: (v: boolean) => void }) {
  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Настройки</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">Аккаунт, внешний вид и ваши данные. Реквизиты компании — в «Профиле компании» (карточка внизу меню).</p>
      </div>
      <AccountCard />
      <AppearanceCard dark={dark} setDark={setDark} />
      <AiCard />
      <DataCards />
    </div>
  );
}

// ── Аккаунт ────────────────────────────────────────────────────────────────────────────────────

function AccountCard() {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Outcome | null>(null);
  // Входа нет (закупки хранятся только в браузере) — аккаунта и пароля тоже нет.
  if (!account) return null;

  const mismatch = again.length > 0 && next !== again;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || !current || !next || next !== again) return;
    setBusy(true);
    setNote(null);
    changePassword(current, next).then(
      () => {
        setNote({ tone: 'ok', text: 'Пароль изменён. На других компьютерах и в других браузерах нужно будет войти заново.' });
        setCurrent('');
        setNext('');
        setAgain('');
        setOpen(false);
      },
      (error: Error) => setNote({ tone: 'warn', text: error.message }),
    ).finally(() => setBusy(false));
  };

  return (
    <Card className="space-y-3 p-5">
      <div>
        <span className="text-sm font-medium">Аккаунт</span>
        <p className="mt-0.5 text-[12px] text-muted-foreground">Вход по почте и паролю: закупки хранятся на сервере и видны после входа с любого компьютера.</p>
      </div>
      <dl className="grid gap-1 text-[13px] sm:grid-cols-[120px_1fr]">
        <dt className="text-muted-foreground">Почта</dt>
        <dd className="break-all font-mono">{account.email ?? '—'}</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          Сменить пароль
        </Button>
        <Button variant="secondary" onClick={account.logout}>
          <LogOut className="size-4" /> Выйти
        </Button>
      </div>
      {open && (
        <form onSubmit={submit} className="max-w-sm space-y-3 border-t border-border pt-3">
          <div>
            <label htmlFor="pw-current" className="mb-1 block text-[13px] font-medium">
              Текущий пароль
            </label>
            <PasswordInput id="pw-current" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="pw-next" className="mb-1 block text-[13px] font-medium">
              Новый пароль
            </label>
            <PasswordInput id="pw-next" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
            <p className="mt-1 text-[12px] text-muted-foreground">Не короче 8 знаков.</p>
          </div>
          <div>
            <label htmlFor="pw-again" className="mb-1 block text-[13px] font-medium">
              Новый пароль ещё раз
            </label>
            <PasswordInput id="pw-again" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} className={inputClass} />
          </div>
          {mismatch && (
            <p role="alert" className="text-[13px] text-danger">
              Пароли не совпадают.
            </p>
          )}
          <Button type="submit" disabled={busy || !current || !next || next !== again}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Сохранить пароль
          </Button>
        </form>
      )}
      <div aria-live="polite" className="empty:hidden">
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
      </div>
    </Card>
  );
}

// ── ИИ ─────────────────────────────────────────────────────────────────────────────────────────

// Режим «ИИ включён / выключен» (lib/ai-mode.ts): выключено — программа не обращается к языковым моделям, расчёты и аналитика работают как обычно.
function AiCard() {
  const [on, set] = useAiEnabled();
  const options: { label: string; value: boolean }[] = [
    { label: 'Включён', value: true },
    { label: 'Выключен', value: false },
  ];
  return (
    <Card className="space-y-3 p-5">
      <div>
        <span className="text-sm font-medium">ИИ</span>
        <p className="mt-0.5 text-[12px] text-muted-foreground">Выключен — программа не обращается к языковым моделям. Быстро переключить можно в шапке меню.</p>
      </div>
      <div role="group" aria-label="Режим ИИ" className="inline-flex gap-1 rounded-md border border-border p-1">
        {options.map(({ label, value }) => (
          <button
            key={label}
            type="button"
            aria-pressed={on === value}
            onClick={() => set(value)}
            className={cx(
              'flex items-center gap-2 rounded px-3 py-1.5 text-[13px] transition-colors',
              on === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <dl className="grid gap-2 text-[12px] sm:grid-cols-2">
        <div>
          <dt className="font-medium">Без ИИ работает</dt>
          <dd className="mt-0.5 text-muted-foreground">аналитика и рейтинг тендера, расчёт цены и рисков, проверки по правилам, реестровые номера, бесплатный поиск в интернете, файлы заявки по готовым полям</dd>
        </div>
        <div>
          <dt className="font-medium">С ИИ дополнительно</dt>
          <dd className="mt-0.5 text-muted-foreground">разбор документов и требований, черновики технического предложения, проверка своей заявки, чат, поиск противоречий, чтение сканов. Каждый платный запрос — только по вашей кнопке</dd>
        </div>
      </dl>
    </Card>
  );
}

// ── Внешний вид ────────────────────────────────────────────────────────────────────────────────

function AppearanceCard({ dark, setDark }: { dark: boolean; setDark: (v: boolean) => void }) {
  const options: { label: string; value: boolean; icon: typeof Sun }[] = [
    { label: 'Светлая', value: false, icon: Sun },
    { label: 'Тёмная', value: true, icon: Moon },
  ];
  return (
    <Card className="space-y-3 p-5">
      <div>
        <span className="text-sm font-medium">Внешний вид</span>
        <p className="mt-0.5 text-[12px] text-muted-foreground">Тема запоминается в этом браузере. Быстро переключить можно значком в шапке меню.</p>
      </div>
      <div role="group" aria-label="Тема" className="inline-flex gap-1 rounded-md border border-border p-1">
        {options.map(({ label, value, icon: Icon }) => (
          <button
            key={label}
            type="button"
            aria-pressed={dark === value}
            onClick={() => setDark(value)}
            className={cx(
              'flex items-center gap-2 rounded px-3 py-1.5 text-[13px] transition-colors',
              dark === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>
    </Card>
  );
}

// ── Данные ─────────────────────────────────────────────────────────────────────────────────────

function DataCards() {
  const onServer = serverReadsEnabled();
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupNote, setBackupNote] = useState<Outcome | null>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const [wipe, setWipe] = useState<'idle' | 'confirm' | 'wiping' | 'blocked' | 'failed'>('idle');
  // Данные, созданные раньше в режиме «в браузере»: лежат только здесь, на сервере их нет. Строка появляется, только когда они есть.
  const [local, setLocal] = useState('');

  useEffect(() => {
    if (!onServer) return;
    let alive = true;
    localOnlyCounts().then(
      (counts) => alive && setLocal(contents(counts)),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [onServer]);

  async function moveToServer() {
    setBackupBusy(true);
    setBackupNote(null);
    try {
      const moved = contents(await migrateLocalToServer());
      setLocal('');
      setBackupNote({ tone: 'ok', text: moved ? `Перенесено на сервер: ${moved}.` : 'Переносить нечего — всё уже на сервере.' });
    } catch {
      setBackupNote({ tone: 'warn', text: 'Не удалось перенести данные на сервер. Повторите через минуту.' });
    } finally {
      setBackupBusy(false);
    }
  }

  async function saveBackup() {
    setBackupBusy(true);
    setBackupNote(null);
    try {
      const { backup, ...counts } = await exportBackup();
      const inside = contents(counts);
      if (!inside) {
        setBackupNote({ tone: 'info', text: onServer ? 'Сохранять пока нечего: нет ни закупок, ни образцов, ни фактов, ни реквизитов.' : 'Сохранять пока нечего: в этом браузере нет ни закупок, ни образцов, ни фактов, ни реквизитов.' });
        return;
      }
      const name = `Тендерный юрист — копия ${new Date(backup.savedAt).toLocaleDateString('ru-RU')}.json`;
      saveFile(new Blob([JSON.stringify(backup)], { type: 'application/json' }), name);
      setBackupNote({ tone: 'ok', text: `Копия сохранена — файл «${name}» в загрузках браузера. В нём ${inside}.` });
    } catch {
      setBackupNote({ tone: 'warn', text: onServer ? 'Не удалось прочитать данные — копия не сохранилась. Обновите страницу и попробуйте ещё раз.' : 'Браузер не дал прочитать данные — копия не сохранилась. Обновите страницу и попробуйте ещё раз.' });
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
      const where = onServer ? 'на сервере' : 'в браузере';
      setBackupNote(
        added
          ? { tone: 'ok', text: `Из копии добавлено: ${added}. То, что уже было ${where}, не тронуто.` }
          : { tone: 'info', text: `Всё из копии уже есть ${where} — ничего не менял.` },
      );
    } catch {
      setBackupNote({ tone: 'warn', text: onServer ? 'Не удалось записать данные из копии. Повторите через минуту.' : 'Браузер не дал записать данные — возможно, на диске кончилось место. Освободите место и загрузите копию ещё раз.' });
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

  return (
    <>
      <Card className="space-y-3 p-5">
        <div>
          <span className="text-sm font-medium">Копия данных</span>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Закупки, документы, реквизиты, образцы и база доказательств</p>
        </div>
        <p className="max-w-[70ch] text-[13px] leading-snug text-muted-foreground">
          {onServer
            ? 'Данные хранятся на сервере и видны после входа с любого компьютера. Копия файлом — запасной вариант: из неё всё вернётся, если что-то удалили по ошибке. '
            : 'Всё это хранится только в этом браузере. Если очистить браузер — пропадёт, а Safari может стереть данные сам, если сервис не открывать неделю. Сохраняйте копию файлом: из неё всё вернётся, и так же данные переносятся на другой компьютер. '}
          В файле реквизиты и тексты документов — храните его так же бережно, как сами документы.
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
        {local && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border px-3 py-2">
            <p className="min-w-0 flex-1 text-[13px] leading-snug">В этом браузере есть то, чего нет на сервере: {local}.</p>
            <Button variant="secondary" size="sm" disabled={backupBusy} onClick={() => void moveToServer()}>
              <Upload className="size-4" /> Перенести на сервер
            </Button>
          </div>
        )}
        <div aria-live="polite" className="empty:hidden">
          {backupNote && <Notice tone={backupNote.tone}>{backupNote.text}</Notice>}
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <div>
          <span className="text-sm font-medium">Удалить все данные</span>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{onServer ? 'На сервере и в этом браузере — всё сразу' : 'Из этого браузера — всё сразу'}</p>
        </div>
        <p className="max-w-[70ch] text-[13px] leading-snug text-muted-foreground">
          {onServer
            ? 'Удалятся все закупки с документами и черновиками, реквизиты, образцы и база доказательств на сервере: владелец удаляет данные всей организации, участник — только свои. Затем очистятся настройки и отметка о согласии в этом браузере. Журнал изменений остаётся. '
            : 'Удалятся все закупки с документами и черновиками, реквизиты, образцы, база доказательств, настройки и отметка о согласии. '}
          Вернуть данные можно будет только из копии — сохраните её выше. То, что уже отправлено ИИ, хранится у Anthropic по её условиям — подробнее в{' '}
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
          {wipe === 'blocked' && <Notice tone="warn">Сервис открыт ещё в другой вкладке — закройте её: удаление закончится, когда она закроется. Потом обновите страницу.</Notice>}
          {wipe === 'failed' && <Notice tone="warn">{onServer ? 'Не удалось удалить данные. Повторите через минуту.' : 'Браузер не дал удалить данные. Удалите их в настройках браузера — «Очистить данные сайта».'}</Notice>}
        </div>
      </Card>
    </>
  );
}
