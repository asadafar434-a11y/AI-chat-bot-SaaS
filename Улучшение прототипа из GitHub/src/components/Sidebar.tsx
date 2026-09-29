import { Briefcase, User, Plus, Sun, Moon, Search, History, Sparkles, Bell } from '../lib/icons';
import { company } from '../lib/data';
import { Button } from './ui';

export type View = 'tenders' | 'search' | 'history' | 'profile' | 'workflow';

const nav: { id: View; label: string; icon: typeof Briefcase }[] = [
  { id: 'tenders', label: 'Мои закупки', icon: Briefcase },
  { id: 'search', label: 'Поиск закупок', icon: Search },
  { id: 'history', label: 'История заявок', icon: History },
  { id: 'profile', label: 'Профиль компании', icon: User },
];

export function Sidebar({
  view,
  onNavigate,
  onNewTender,
  onOpenChat,
  dark,
  setDark,
  specialistStatus = 'idle',
}: {
  view: View;
  onNavigate: (v: View) => void;
  onNewTender: () => void;
  onOpenChat: () => void;
  dark: boolean;
  setDark: (v: boolean) => void;
  specialistStatus?: 'idle' | 'sent' | 'replied';
}) {
  const hasNotif = specialistStatus !== 'idle';
  const notifLabel =
    specialistStatus === 'replied' ? 'Специалист ответил' : 'На проверке у специалиста';

  return (
    <aside className="flex shrink-0 flex-col gap-5 rounded-2xl border border-border bg-card p-4 shadow-sm lg:h-full lg:w-[248px] lg:overflow-y-auto">
      {/* Logo */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            style={{ background: 'linear-gradient(145deg, #312e81 0%, #4338ca 55%, #6366f1 100%)' }}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl shadow-md ring-1 ring-white/10"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-5"
              aria-hidden="true"
            >
              <path d="M12 3v18" />
              <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
              <path d="m5 7-2.5 7c.83.6 1.75.93 2.5.93S6.67 14.6 7.5 14L5 7Z" />
              <path d="m19 7-2.5 7c.83.6 1.75.93 2.5.93s1.67-.33 2.5-.93L19 7Z" />
              <path d="M8 21h8" />
            </svg>
          </div>
          <div className="leading-none">
            <p className="text-sm font-semibold tracking-tight">Тендерный юрист</p>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              AI · 44-ФЗ / 223-ФЗ
            </p>
          </div>
        </div>
        <button
          onClick={() => setDark(!dark)}
          className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:hidden"
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>

      <Button onClick={onNewTender} className="w-full">
        <Plus className="size-4" /> Новая закупка
      </Button>

      <nav className="flex gap-1 lg:flex-col">
        {nav.map((n) => {
          const Icon = n.icon;
          const active = view === n.id;
          return (
            <button
              key={n.id}
              onClick={() => onNavigate(n.id)}
              className={`flex flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors lg:flex-none ${
                active
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
              }`}
            >
              <Icon className="size-4 shrink-0" />
              {n.label}
            </button>
          );
        })}
      </nav>

      <button
        onClick={onOpenChat}
        className="flex items-center gap-2.5 rounded-md border border-border bg-secondary/50 px-3 py-2.5 text-left transition-colors hover:bg-secondary"
      >
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Sparkles className="size-3.5" />
        </div>
        <div className="min-w-0 leading-tight">
          <p className="text-[13px] font-medium">Спросить ИИ</p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">помощь по заявке</p>
        </div>
      </button>

      <div className="mt-auto hidden lg:flex lg:flex-col lg:gap-2">
        {hasNotif && (
          <div
            className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 ${
              specialistStatus === 'replied'
                ? 'border-success/40 bg-success/8'
                : 'border-warn/40 bg-warn-surface/30'
            }`}
          >
            <Bell
              className={`mt-0.5 size-3.5 shrink-0 ${
                specialistStatus === 'replied' ? 'text-success' : 'text-warn-foreground'
              }`}
            />
            <div className="min-w-0">
              <p
                className={`text-[12px] font-medium ${
                  specialistStatus === 'replied' ? 'text-success' : 'text-warn-foreground'
                }`}
              >
                {notifLabel}
              </p>
              {specialistStatus === 'replied' && (
                <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                  Проверка завершена · 500 ₽
                </p>
              )}
            </div>
          </div>
        )}

        <button
          onClick={() => onNavigate('profile')}
          className="relative flex w-full items-center gap-2.5 rounded-md border border-border p-2.5 text-left transition-colors hover:bg-secondary"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
            ТС
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium">{company.name}</p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              ИНН {company.fields.find((f) => f.key === 'inn')?.value}
            </p>
          </div>
          {hasNotif && (
            <span
              className={`absolute right-2.5 top-2.5 size-2 rounded-full ${
                specialistStatus === 'replied' ? 'bg-success' : 'bg-warn'
              }`}
            />
          )}
        </button>

        <button
          onClick={() => setDark(!dark)}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          {dark ? 'Светлая тема' : 'Тёмная тема'}
        </button>
      </div>
    </aside>
  );
}
