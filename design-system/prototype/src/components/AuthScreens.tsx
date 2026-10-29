import { useState, type FormEvent, type ReactNode } from 'react';
import { BrandMark } from './BrandMark';
import { Button, Card, fieldClass } from './ui';
import { Notice } from './Notice';
import { PasswordInput } from './PasswordInput';
import { Loader2 } from '../lib/icons';

// Экраны входа: войти по почте и паролю; «забыли пароль» — выслать ссылку на почту; задать пароль по ссылке-приглашению; сменить пароль по
// ссылке сброса. Только вид — запросы к серверу делает обёртка (real/auth.tsx). Пароль вводится в поле с глазиком (PasswordInput): по умолчанию
// скрыт, показывается по нажатию; сообщения об ошибках приходят от сервера понятным текстом (неверный пароль, слишком короткий пароль, ссылка устарела).

const inputClass = fieldClass();

function Shell({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-4 text-foreground">
      <div className="w-full max-w-[420px]">
        <Card className="animate-fade-up space-y-4 p-6">
          <div className="flex items-center gap-2.5">
            <BrandMark className="size-8" />
            <span className="text-sm font-bold tracking-tight">Тендекс</span>
          </div>
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">{lead}</p>
          </div>
          {children}
        </Card>
      </div>
    </main>
  );
}

function ErrorLine({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">
      {text}
    </p>
  ) : null;
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[12px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function LoginScreen({
  onSubmit,
  busy,
  error,
  notice,
  onForgot,
}: {
  onSubmit: (email: string, password: string) => void;
  /** «Забыли пароль?» — перейти к экрану, где почту отправляют на ссылку. */
  onForgot: () => void;
  busy: boolean;
  error: string | null;
  /** Спокойное сообщение над формой, например «Пароль задан — войдите». */
  notice?: string | null;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) onSubmit(email, password);
  };
  return (
    <Shell title="Вход" lead="Закупки хранятся на сервере и видны после входа с любого компьютера.">
      <form onSubmit={submit} className="space-y-3.5">
        {notice && <p className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-[13px] text-success">{notice}</p>}
        <ErrorLine text={error} />
        <Field id="auth-email" label="Почта">
          <input id="auth-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </Field>
        <Field id="auth-password" label="Пароль">
          <PasswordInput id="auth-password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
        </Field>
        <div className="-mt-1.5 flex justify-end">
          <button type="button" onClick={onForgot} className="rounded text-[13px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline">
            Забыли пароль?
          </button>
        </div>
        <Button type="submit" className="h-10 w-full" disabled={busy || !email.trim() || !password}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          Войти
        </Button>
        <p className="text-[12px] leading-snug text-muted-foreground">
          Аккаунт создаёт владелец сервиса и присылает ссылку, по которой вы задаёте пароль.
        </p>
      </form>
    </Shell>
  );
}

/** Задать пароль (invite) или сменить его (reset) по одноразовой ссылке. */
export function SetPasswordScreen({
  mode,
  onSubmit,
  onCancel,
  busy,
  error,
}: {
  mode: 'invite' | 'reset';
  onSubmit: (password: string) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const mismatch = again.length > 0 && password !== again;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy && password && password === again) onSubmit(password);
  };
  return (
    <Shell
      title={mode === 'invite' ? 'Задайте пароль' : 'Новый пароль'}
      lead={mode === 'invite' ? 'По этой ссылке пароль задаётся один раз. Потом вы входите по почте и этому паролю.' : 'После смены пароля нужно будет войти заново.'}
    >
      <form onSubmit={submit} className="space-y-3.5">
        <ErrorLine text={error} />
        <Field id="auth-new" label="Пароль" hint="Не короче 8 знаков.">
          <PasswordInput id="auth-new" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
        </Field>
        <Field id="auth-again" label="Пароль ещё раз">
          <PasswordInput id="auth-again" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} className={inputClass} />
        </Field>
        {mismatch && <p role="alert" className="text-[13px] text-danger">Пароли не совпадают.</p>}
        <div className="flex gap-2">
          <Button type="submit" className="h-10 flex-1" disabled={busy || !password || password !== again}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {mode === 'invite' ? 'Задать пароль' : 'Сменить пароль'}
          </Button>
          <Button type="button" variant="secondary" className="h-10" onClick={onCancel}>
            К входу
          </Button>
        </div>
      </form>
    </Shell>
  );
}

/**
 * «Забыли пароль»: человек вводит почту и получает письмо со ссылкой. Экран не говорит, есть ли такой аккаунт (так задумано сервером);
 * говорит только, отправляются ли на этом сервере письма вообще: нет — прямо об этом, чтобы человек не ждал письма, которого не будет.
 */
export function ForgotScreen({
  onSubmit,
  onBack,
  onAgain,
  busy,
  error,
  result,
}: {
  onSubmit: (email: string) => void;
  onBack: () => void;
  /** «Ввести другую почту» после ответа. */
  onAgain: () => void;
  busy: boolean;
  error: string | null;
  result: { mail: boolean } | null;
}) {
  const [email, setEmail] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy && email.trim()) onSubmit(email.trim());
  };
  if (result) {
    return (
      <Shell title={result.mail ? 'Проверьте почту' : 'Письмо не уйдёт'} lead={result.mail ? 'Ссылка для нового пароля отправлена.' : 'Отправка писем на этом сервере не настроена.'}>
        <div className="space-y-3.5">
          {result.mail ? (
            <Notice tone="ok">
              Если аккаунт с адресом {email.trim()} есть, на него ушло письмо со ссылкой. Она действует 1 час и срабатывает один раз. Не пришло — загляните в «Спам»
              или введите другую почту.
            </Notice>
          ) : (
            <Notice tone="warn">Письма на этом сервере пока не отправляются, поэтому ссылка не придёт. Новую ссылку для входа может выдать владелец сервиса.</Notice>
          )}
          <div className="flex gap-2">
            <Button type="button" className="h-10 flex-1" onClick={onBack}>
              К входу
            </Button>
            {result.mail && (
              <Button type="button" variant="secondary" className="h-10" onClick={onAgain}>
                Другая почта
              </Button>
            )}
          </div>
        </div>
      </Shell>
    );
  }
  return (
    <Shell title="Забыли пароль?" lead="Введите почту, с которой входите, — пришлём ссылку, по которой можно задать новый пароль.">
      <form onSubmit={submit} className="space-y-3.5">
        <ErrorLine text={error} />
        <Field id="auth-forgot-email" label="Почта">
          <input id="auth-forgot-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" className="h-10 flex-1" disabled={busy || !email.trim()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Отправить ссылку
          </Button>
          <Button type="button" variant="secondary" className="h-10" onClick={onBack}>
            К входу
          </Button>
        </div>
      </form>
    </Shell>
  );
}

/** Пока проверяем, вошёл ли человек, и когда сервер не ответил. */
export function AuthWait({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <Shell title={error ? 'Нет связи с сервером' : 'Загрузка'} lead={error ?? 'Проверяем вход…'}>
      {error ? (
        <Button className="h-10 w-full" onClick={onRetry}>
          Повторить
        </Button>
      ) : (
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      )}
    </Shell>
  );
}
