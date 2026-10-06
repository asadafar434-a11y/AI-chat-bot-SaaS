import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Briefcase, User, Plus, Sun, Moon, Search, History, Bell, Clock, ChevronRight, Menu, X, Wallet } from '../lib/icons';
import { Button, Soon, Tooltip, IconButton, cx, useDialogFocus } from './ui';
import { BrandMark } from './BrandMark';
import { BotMark } from './BotMark';

export type View = 'tenders' | 'search' | 'history' | 'profile' | 'tariffs' | 'workflow';

// Уведомление о проверке специалистом по одной заявке.
export type Notice = { id: string; title: string; status: 'sent' | 'replied'; read: boolean };

const nav: { id: View; label: string; icon: typeof Briefcase; soon?: string }[] = [
  { id: 'tenders', label: 'Мои закупки', icon: Briefcase },
  { id: 'search', label: 'Поиск закупок', icon: Search },
  { id: 'history', label: 'История заявок', icon: History, soon: 'Итоги торгов с площадок — в разработке. Сейчас на экране пример.' },
  { id: 'profile', label: 'Профиль компании', icon: User },
  { id: 'tariffs', label: 'Тарифы', icon: Wallet },
];

type Props = {
  view: View;
  onNavigate: (v: View) => void;
  onNewTender: () => void;
  onOpenChat: () => void;
  dark: boolean;
  setDark: (v: boolean) => void;
  notices: Notice[];
  onOpenNotice: (id: string) => void;
  credits: number;
  // Название и ИНН — из «Профиля компании»; пока не заполнены — пустые.
  company: { name: string; inn: string };
};

// Компьютер — боковая панель; телефон — шапка с бургером и выезжающее меню с тем же содержимым.
export function Sidebar(props: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBox = useRef<HTMLDivElement>(null);
  const unread = props.notices.some((n) => n.status === 'replied' && !n.read);
  useDialogFocus(menuBox, menuOpen);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    // Под открытым меню страница не прокручивается.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [menuOpen]);

  // Любое действие в меню закрывает его.
  const close =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) => {
      setMenuOpen(false);
      fn(...args);
    };
  const inMenu: Props = {
    ...props,
    onNavigate: close(props.onNavigate),
    onNewTender: close(props.onNewTender),
    onOpenChat: close(props.onOpenChat),
    onOpenNotice: close(props.onOpenNotice),
  };

  return (
    <>
      {/* Телефон: шапка с бургером */}
      <header className="flex items-center justify-between gap-2 rounded-2xl border border-border bg-card px-3 py-2.5 shadow-sm lg:hidden">
        <Logo />
        <div className="flex items-center gap-1.5">
          <IconButton label="Новая закупка" onClick={props.onNewTender} side="bottom" align="end" className="size-9 border border-border">
            <Plus className="size-4" />
          </IconButton>
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Меню"
            aria-expanded={menuOpen}
            className="relative flex size-9 items-center justify-center rounded-md border border-border text-foreground transition-colors hover:bg-secondary"
          >
            <Menu className="size-5" />
            {unread && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-danger ring-2 ring-card" />}
          </button>
        </div>
      </header>

      {menuOpen &&
        createPortal(
          <div ref={menuBox} tabIndex={-1} className="fixed inset-0 z-50 outline-none lg:hidden" role="dialog" aria-modal="true" aria-label="Меню">
            <div className="animate-tip absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setMenuOpen(false)} />
            <div className="animate-slide-in absolute inset-y-0 left-0 flex w-[min(320px,86vw)] flex-col gap-5 overflow-y-auto border-r border-border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] shadow-2xl">
              <div className="flex items-center justify-between">
                <Logo />
                <IconButton label="Закрыть меню" onClick={() => setMenuOpen(false)} side="bottom" align="end">
                  <X className="size-5" />
                </IconButton>
              </div>
              <Body {...inMenu} />
            </div>
          </div>,
          document.body,
        )}

      {/* Компьютер: боковая панель */}
      <aside className="hidden shrink-0 flex-col gap-5 rounded-2xl border border-border bg-card p-4 shadow-sm lg:flex lg:h-full lg:w-[248px] lg:overflow-y-auto">
        <Logo />
        <Body {...props} />
      </aside>
    </>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <BrandMark className="size-9 shrink-0" />
      <div className="leading-none">
        <p className="text-sm font-semibold tracking-tight">Тендерный юрист</p>
        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">AI · 44-ФЗ / 223-ФЗ</p>
      </div>
    </div>
  );
}

// Содержимое панели — одно и то же на компьютере и в меню телефона.
function Body({ view, onNavigate, onNewTender, onOpenChat, dark, setDark, notices, onOpenNotice, credits, company }: Props) {
  // Сначала непрочитанные ответы, потом ожидающие проверки, прочитанные — в конце.
  const sorted = [...notices].sort((a, b) => rank(a) - rank(b));
  const unread = notices.some((n) => n.status === 'replied' && !n.read);

  return (
    <>
      <Button onClick={onNewTender} className="w-full">
        <Plus className="size-4" /> Новая закупка
      </Button>

      <nav className="flex flex-col gap-1">
        {nav.map((n) => {
          const Icon = n.icon;
          const active = view === n.id;
          const item = (
            <button
              onClick={() => onNavigate(n.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
                active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
              }`}
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{n.label}</span>
              {n.soon && <Soon className="ml-auto" />}
              {n.id === 'tariffs' && credits > 0 && (
                <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">{credits}</span>
              )}
            </button>
          );
          return n.soon ? (
            <Tooltip key={n.id} content={n.soon} side="bottom" className="w-full">
              {item}
            </Tooltip>
          ) : (
            <div key={n.id}>{item}</div>
          );
        })}
      </nav>

      <button
        onClick={onOpenChat}
        className="flex items-center gap-2.5 rounded-md border border-border bg-secondary/50 px-3 py-2.5 text-left transition-colors hover:bg-secondary"
      >
        <BotMark className="size-8 shrink-0" />
        <div className="min-w-0 leading-tight">
          <p className="text-[13px] font-medium">Спросить ИИ</p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">помощь по заявке</p>
        </div>
      </button>

      <div className="mt-auto flex flex-col gap-2">
        {sorted.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="px-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Проверка специалистом</p>
            {sorted.map((n) => (
              <NoticeRow key={n.id} notice={n} onOpen={onOpenNotice} />
            ))}
          </div>
        )}

        <button
          onClick={() => onNavigate('profile')}
          className="relative flex w-full items-center gap-2.5 rounded-md border border-border p-2.5 text-left transition-colors hover:bg-secondary"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
            {(company.name.replace(/[^\p{L}]/gu, '').slice(0, 2) || '—').toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium">{company.name || 'Моя компания'}</p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              {company.inn ? `ИНН ${company.inn}` : 'Заполните профиль'}
              {credits > 0 && ` · заявок на балансе: ${credits}`}
            </p>
          </div>
          {unread && <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-danger" />}
        </button>

        <button
          onClick={() => setDark(!dark)}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          {dark ? 'Светлая тема' : 'Тёмная тема'}
        </button>
      </div>
    </>
  );
}

const rank = (n: Notice) => (n.status === 'replied' && !n.read ? 0 : n.status === 'sent' ? 1 : 2);

function NoticeRow({ notice, onOpen }: { notice: Notice; onOpen: (id: string) => void }) {
  const replied = notice.status === 'replied';
  return (
    <button
      onClick={() => onOpen(notice.id)}
      className={cx(
        'relative flex w-full items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors',
        replied ? 'border-success/40 bg-success/10 hover:bg-success/15' : 'border-warn/40 bg-warn-surface/40 hover:bg-warn-surface/60',
      )}
    >
      {replied ? (
        <Bell className="mt-0.5 size-3.5 shrink-0 text-success" />
      ) : (
        <Clock className="mt-0.5 size-3.5 shrink-0 text-warn-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <p className={cx('text-[12px] font-medium', replied ? 'text-success' : 'text-warn-foreground')}>
          {replied ? 'Специалист ответил' : 'На проверке у специалиста'}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{notice.title}</p>
      </div>
      {replied && !notice.read && <span className="absolute right-2 top-2 size-2 rounded-full bg-danger" />}
      <ChevronRight className="mt-0.5 size-3.5 shrink-0 self-center text-muted-foreground" />
    </button>
  );
}
