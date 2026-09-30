import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { hasConsent, saveConsent } from '@/lib/consent';
import { BrandMark } from '../components/BrandMark';
import { Button, Card, Checkbox } from '../components/ui';

// Согласие дали в другой вкладке — эта узнает об этом из события storage.
const subscribe = (onChange: () => void) => {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
};

// Правовые документы открываются в новой вкладке: отмеченное на этой странице не пропадёт. Сами страницы — в приложении
// из папки web (сервер их отдаёт по тем же адресам).
const legal = (href: string, text: string) => (
  <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">
    {text}
  </a>
);

// Перед началом работы — два согласия: на обработку персональных данных и на передачу их за рубеж (модели ИИ).
// Без них сервис не читает документы. Та же проверка, что в приложении на Next (web/src/components/consent-gate.tsx);
// что именно согласовано и какой редакции — lib/consent.ts.
export function ConsentGate({ children }: { children: ReactNode }) {
  const stored = useSyncExternalStore(subscribe, () => hasConsent(), () => false);
  const [accepted, setAccepted] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [transfer, setTransfer] = useState(false);

  if (accepted || stored) return <>{children}</>;

  function submit(e: FormEvent) {
    e.preventDefault();
    saveConsent();
    setAccepted(true);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background p-4 text-foreground">
      <form onSubmit={submit} className="w-full max-w-[420px]">
        <Card className="animate-fade-up space-y-4 p-6">
          <div className="flex items-center gap-2.5">
            <BrandMark className="size-8" />
            <span className="text-sm font-bold tracking-tight">Тендерный юрист</span>
          </div>
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">Перед началом</h1>
            <p className="text-sm text-muted-foreground">
              Сервис читает документы закупки с помощью ИИ. В документах и реквизитах бывают персональные данные, поэтому нужны
              два согласия.
            </p>
          </div>
          <div className="space-y-3 text-[13px] leading-snug text-muted-foreground">
            <Checkbox checked={processing} onChange={setProcessing}>
              Даю {legal('/consent', 'согласие на обработку персональных данных')}
            </Checkbox>
            <Checkbox checked={transfer} onChange={setTransfer}>
              Даю {legal('/consent-transfer', 'согласие на передачу данных за рубеж')} — модели ИИ в США, без этого сервис не
              прочитает документы
            </Checkbox>
          </div>
          <Button type="submit" className="h-10 w-full" disabled={!processing || !transfer}>
            Продолжить
          </Button>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Продолжая, вы принимаете {legal('/terms', 'условия использования')}. Как сервис обращается с данными — в{' '}
            {legal('/privacy', 'политике')}. Владелец сервиса — на странице {legal('/contacts', '«Контакты»')}.
          </p>
        </Card>
      </form>
    </main>
  );
}
