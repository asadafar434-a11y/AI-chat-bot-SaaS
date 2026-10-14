import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { acceptInvitation, authRouteOf, fetchSession, loginWithPassword, logout, requestPasswordReset, resetPassword, type AuthRoute, type AuthUser } from '@/lib/auth-client';
import { errorMessage } from '@/lib/http-error';
import { serverReadsEnabled } from '@/lib/server-reads';
import { AccountContext, type Account } from '../lib/account';
import { AuthWait, ForgotScreen, LoginScreen, SetPasswordScreen } from '../components/AuthScreens';

// Вход. Когда закупки хранятся на сервере (PRODUCT_STORAGE=server), без входа их не видно: экран сначала спрашивает у сервера, кто вошёл.
// Нет входа — форма «почта и пароль»; ссылка от владельца (#/invite/… или #/reset/…) — экран «задайте пароль». Когда закупки только в
// браузере, входа нет и экран работает как раньше.

export function AuthGate({ children }: { children: ReactNode }) {
  return serverReadsEnabled() ? <ServerAuthGate>{children}</ServerAuthGate> : <>{children}</>;
}

type Session = { state: 'checking' } | { state: 'error'; message: string } | { state: 'out' } | { state: 'in'; user: AuthUser };

function ServerAuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ state: 'checking' });
  const [route, setRoute] = useState<AuthRoute | null>(() => authRouteOf(window.location.hash));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // «Забыли пароль»: экран ввода почты и ответ сервера (отправляются ли письма).
  const [forgot, setForgot] = useState(false);
  const [resetSent, setResetSent] = useState<{ mail: boolean } | null>(null);

  const check = useCallback(async () => {
    try {
      const user = await fetchSession();
      setSession(user ? { state: 'in', user } : { state: 'out' });
    } catch (e) {
      // Сервер не ответил — это не «вы вышли»: уже вошедшего не выкидываем, а новому покажем «повторить».
      setSession((prev) => (prev.state === 'in' ? prev : { state: 'error', message: errorMessage(e, 'Сервер не ответил.') }));
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  // Вернулись на вкладку — проверяем, не истёк ли вход (например, вышли с другого компьютера).
  useEffect(() => {
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [check]);

  // Ссылку с токеном убираем из адреса сразу: токен одноразовый, и в истории браузера ему делать нечего.
  const leaveRoute = useCallback(() => {
    setRoute(null);
    setError(null);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`);
  }, []);

  const accountOf = useMemo<Account | null>(
    () =>
      session.state === 'in'
        ? {
            email: session.user.email,
            logout: () => {
              void logout().then(() => {
                setNotice(null);
                setSession({ state: 'out' });
              });
            },
          }
        : null,
    [session],
  );

  // Ссылка-приглашение при уже выполненном входе не нужна: убираем её из адреса.
  const signedIn = session.state === 'in';
  useEffect(() => {
    if (signedIn && route) leaveRoute();
  }, [signedIn, route, leaveRoute]);

  if (session.state === 'checking' || session.state === 'error') {
    return <AuthWait error={session.state === 'error' ? session.message : null} onRetry={() => void check()} />;
  }
  if (session.state === 'in') {
    return <AccountContext.Provider value={accountOf}>{children}</AccountContext.Provider>;
  }

  if (route) {
    return (
      <SetPasswordScreen
        mode={route.kind}
        busy={busy}
        error={error}
        onCancel={leaveRoute}
        onSubmit={(password) => {
          setBusy(true);
          setError(null);
          const done = route.kind === 'invite' ? acceptInvitation(route.token, password) : resetPassword(route.token, password);
          done.then(
            () => {
              setNotice(route.kind === 'invite' ? 'Пароль задан. Войдите по почте и этому паролю.' : 'Пароль изменён. Войдите по новому паролю.');
              leaveRoute();
            },
            (e: Error) => setError(e.message),
          ).finally(() => setBusy(false));
        }}
      />
    );
  }

  if (forgot) {
    const back = () => {
      setForgot(false);
      setResetSent(null);
      setError(null);
    };
    return (
      <ForgotScreen
        busy={busy}
        error={error}
        result={resetSent}
        onBack={back}
        onAgain={() => setResetSent(null)}
        onSubmit={(email) => {
          setBusy(true);
          setError(null);
          requestPasswordReset(email).then(setResetSent, (e: Error) => setError(e.message)).finally(() => setBusy(false));
        }}
      />
    );
  }

  return (
    <LoginScreen
      busy={busy}
      onForgot={() => {
        setError(null);
        setNotice(null);
        setForgot(true);
      }}
      error={error}
      notice={notice}
      onSubmit={(email, password) => {
        setBusy(true);
        setError(null);
        loginWithPassword(email, password).then(
          async () => {
            setNotice(null);
            await check();
          },
          (e: Error) => setError(e.message),
        ).finally(() => setBusy(false));
      }}
    />
  );
}
