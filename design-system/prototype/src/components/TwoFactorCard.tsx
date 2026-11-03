import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { disableTwoFactor, enableTwoFactor, fetchTwoFactorStatus, renewRecoveryCodes, startTwoFactor } from '@/lib/auth-client';
import { saveFile } from '@/lib/save-file';
import { useAccount } from '../lib/account';
import { Copy, Download, Loader2, ShieldCheck } from '../lib/icons';
import { Notice } from './Notice';
import { PasswordInput } from './PasswordInput';
import { QrCode } from './QrCode';
import { Badge, Button, Card, fieldClass } from './ui';

// «Настройки» → «Аккаунт» → двухфакторный вход. Кроме пароля при входе спрашивается шестизначный код из приложения-аутентификатора на телефоне
// (Google Authenticator, Яндекс Ключ, Authy, 1Password). Порядок включения: «Включить» → отсканировать QR (или ввести ключ) → ввести первый код →
// сохранить запасные коды (показываются один раз). Выключить можно только с паролем и кодом. Весь вид ниже — по состояниям; запросы — auth-client.

const inputClass = fieldClass();

type View =
  | { name: 'loading' }
  | { name: 'error'; message: string }
  | { name: 'off' }
  | { name: 'setup'; secret: string; uri: string }
  | { name: 'codes'; codes: string[]; renewed: boolean }
  | { name: 'on'; left: number }
  | { name: 'renew'; left: number }
  | { name: 'disable'; left: number };

/** Ключ для ручного ввода: группами по четыре знака, как его показывают приложения. */
export const spacedSecret = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

const copy = (text: string) => (navigator.clipboard?.writeText ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard')));

export function TwoFactorCard() {
  // Входа нет (закупки только в браузере) — и второго шага нет.
  const account = useAccount();
  if (!account) return null;
  return <TwoFactorSection />;
}

function TwoFactorSection() {
  const [view, setView] = useState<View>({ name: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetchTwoFactorStatus().then(
      (s) => setView(s.enabled ? { name: 'on', left: s.recoveryLeft } : { name: 'off' }),
      (e: Error) => setView({ name: 'error', message: e.message }),
    );
  useEffect(() => {
    void load();
  }, []);

  // Общая обёртка действия: занято, ошибка — над формой, успех — переход на следующий экран.
  const run = <T,>(job: Promise<T>, done: (value: T) => void) => {
    setBusy(true);
    setError(null);
    job.then(done, (e: Error) => setError(e.message)).finally(() => setBusy(false));
  };
  const cancel = () => {
    setError(null);
    void load();
  };

  // Коды показывают сразу после включения и после выпуска новых — в обоих случаях защита уже работает.
  const on = view.name === 'on' || view.name === 'renew' || view.name === 'disable' || view.name === 'codes';
  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-4" /> Двухфакторный вход
          </span>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Кроме пароля — код из приложения на телефоне. Защищает аккаунт, даже если пароль узнали.</p>
        </div>
        {view.name !== 'loading' && view.name !== 'error' && (
          <Badge tone={on ? 'success' : 'neutral'}>{on ? 'Включён' : 'Выключен'}</Badge>
        )}
      </div>

      {view.name === 'loading' && <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Загрузка" />}
      {view.name === 'error' && (
        <div className="space-y-2">
          <Notice tone="warn">{view.message}</Notice>
          <Button variant="secondary" onClick={() => void load()}>
            Повторить
          </Button>
        </div>
      )}
      {view.name === 'off' && (
        <Button
          disabled={busy}
          onClick={() => run(startTwoFactor(), (s) => setView({ name: 'setup', secret: s.secret, uri: s.uri }))}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          Включить
        </Button>
      )}
      {view.name === 'setup' && (
        <TwoFactorSetup
          secret={view.secret}
          uri={view.uri}
          busy={busy}
          error={error}
          onCancel={cancel}
          onConfirm={(code) => run(enableTwoFactor(code), (codes) => setView({ name: 'codes', codes, renewed: false }))}
        />
      )}
      {view.name === 'codes' && <RecoveryCodes codes={view.codes} onDone={() => void load()} />}
      {view.name === 'on' && (
        <TwoFactorOn
          left={view.left}
          onRenew={() => setView({ name: 'renew', left: view.left })}
          onDisable={() => setView({ name: 'disable', left: view.left })}
        />
      )}
      {view.name === 'renew' && (
        <CodeForm
          label="Код из приложения"
          hint="Прежние запасные коды перестанут работать."
          submit="Выпустить новые коды"
          busy={busy}
          error={error}
          onCancel={cancel}
          onSubmit={(code) => run(renewRecoveryCodes(code), (codes) => setView({ name: 'codes', codes, renewed: true }))}
        />
      )}
      {view.name === 'disable' && (
        <CodeForm
          label="Код из приложения или запасной"
          hint="Нужны пароль и код: так защиту не снимет тот, кто просто сел за ваш компьютер."
          submit="Выключить"
          danger
          withPassword
          busy={busy}
          error={error}
          onCancel={cancel}
          onSubmit={(code, password) => run(disableTwoFactor(password ?? '', code), () => void load())}
        />
      )}
    </Card>
  );
}

/** Включено: сколько запасных кодов осталось, обновить их или выключить. */
export function TwoFactorOn({ left, onRenew, onDisable }: { left: number; onRenew: () => void; onDisable: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-[13px]">
        Запасных кодов: <b className="font-mono">{left}</b>
        {left <= 2 && <span className="text-warn-foreground"> — осталось мало, выпустите новые</span>}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onRenew}>
          Новые запасные коды
        </Button>
        <Button variant="secondary" onClick={onDisable}>
          Выключить
        </Button>
      </div>
    </div>
  );
}

/** Шаг включения: QR и ключ для приложения, поле для первого кода. */
export function TwoFactorSetup({
  secret,
  uri,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  secret: string;
  uri: string;
  busy: boolean;
  error: string | null;
  onConfirm: (code: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const ready = code.replace(/\D/g, '').length === 6;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy && ready) onConfirm(code);
  };
  return (
    <form onSubmit={submit} className="space-y-4 border-t border-border pt-3">
      <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
        <QrCode value={uri} />
        <div className="min-w-0 space-y-3">
          <p className="text-[13px]">
            <b>1.</b> Откройте на телефоне приложение-аутентификатор (Google Authenticator, Яндекс Ключ, Authy) и отсканируйте код. Не получается — введите ключ:
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded-md bg-secondary px-2.5 py-1.5 font-mono text-[13px] tracking-wider">{spacedSecret(secret)}</code>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void copy(secret).then(() => setCopied(true), () => setCopied(false))}
            >
              <Copy className="size-4" /> {copied ? 'Скопировано' : 'Скопировать'}
            </Button>
          </div>
          <a href={uri} className="inline-block text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Открыть в приложении на этом телефоне
          </a>
        </div>
      </div>
      <div className="max-w-xs">
        <label htmlFor="tf-code" className="mb-1 block text-[13px] font-medium">
          <b>2.</b> Шесть цифр из приложения
        </label>
        <input
          id="tf-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          placeholder="000 000"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={`${inputClass} font-mono tracking-widest`}
        />
      </div>
      {error && <Notice tone="warn">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !ready}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          Подтвердить и включить
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  );
}

/** Запасные коды: показываются один раз — сохранить, скопировать или скачать файл. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');
  return (
    <div className="space-y-3 border-t border-border pt-3">
      <Notice tone="warn">Сохраните запасные коды сейчас — потом они не показываются. Каждый подходит один раз, если телефон потерян.</Notice>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {codes.map((code) => (
          <li key={code} className="rounded-md bg-secondary px-3 py-1.5 font-mono text-[13px] tracking-wider">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => void copy(text).then(() => setCopied(true), () => setCopied(false))}>
          <Copy className="size-4" /> {copied ? 'Скопировано' : 'Скопировать'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => saveFile(new Blob([`Тендекс — запасные коды двухфакторного входа\nКаждый код работает один раз.\n\n${text}\n`], { type: 'text/plain;charset=utf-8' }), 'tendex-zapasnye-kody.txt')}
        >
          <Download className="size-4" /> Скачать файл
        </Button>
        <Button type="button" onClick={onDone}>
          Коды сохранены
        </Button>
      </div>
    </div>
  );
}

function CodeForm({
  label,
  hint,
  submit,
  danger,
  withPassword,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  label: string;
  hint: ReactNode;
  submit: string;
  danger?: boolean;
  withPassword?: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (code: string, password?: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const ready = code.trim().length >= 6 && (!withPassword || password.length > 0);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && ready) onSubmit(code, password);
      }}
      className="max-w-sm space-y-3 border-t border-border pt-3"
    >
      <p className="text-[12px] text-muted-foreground">{hint}</p>
      {withPassword && (
        <div>
          <label htmlFor="tf-password" className="mb-1 block text-[13px] font-medium">
            Пароль
          </label>
          <PasswordInput id="tf-password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
        </div>
      )}
      <div>
        <label htmlFor="tf-form-code" className="mb-1 block text-[13px] font-medium">
          {label}
        </label>
        <input
          id="tf-form-code"
          autoComplete="one-time-code"
          spellCheck={false}
          maxLength={24}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={`${inputClass} font-mono tracking-widest`}
        />
      </div>
      {error && <Notice tone="warn">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={busy || !ready}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {submit}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
