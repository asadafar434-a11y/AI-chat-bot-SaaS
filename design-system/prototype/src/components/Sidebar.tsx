import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BarChart2, Bell, Briefcase, Building2, Calculator, ChevronRight, Clock, Cog, History, MoreHorizontal, Moon, Plus, Search, Sun, Wallet, X } from '../lib/icons';
import { useAccount } from '../lib/account';
import { Button, Soon, Tooltip, IconButton, cx, useDialogFocus } from './ui';
import { BrandMark } from './BrandMark';
import { AiSwitch } from './AiSwitch';

export type View = 'tenders' | 'analytics' | 'calculator' | 'search' | 'history' | 'profile' | 'settings' | 'tariffs' | 'workflow';

// Уведомление о проверке специалистом по одной заявке.
export type Notice = { id: string; title: string; status: 'sent' | 'replied'; read: boolean };

const nav: { id: View; label: string; icon: typeof Briefcase; soon?: string }[] = [
  { id: 'tenders', label: 'Мои закупки', icon: Briefcase },
  { id: 'analytics', label: 'Аналитика', icon: BarChart2 },
  { id: 'calculator', label: 'Калькулятор', icon: Calculator },
  { id: 'search', label: 'Поиск закупок', icon: Search },
  { id: 'history', label: 'История заявок', icon: History },
  { id: 'tariffs', label: 'Тарифы', icon: Wallet },
  { id: 'settings', label: 'Настройки', icon: Cog },
];

type Props = {
  view: View;
  onNavigate: (v: View) => void;
  onNewTender: () => void;
  dark: boolean;
  setDark: (v: boolean) => void;
  notices: Notice[];
  onOpenNotice: (id: string) => void;
  credits: number;
  // Название и ИНН — из «Профиля компании»; пока не заполнены — пустые.
  company: { name: string; inn: string };
};

// Компьютер — боковая панель; телефон и планшет — шапка и нижняя панель навигации, как в приложениях: что не помещается — в «Ещё».
export function Sidebar(props: Props) {
  return (
    <>
      <header className="flex items-center justify-between gap-2 rounded-2xl border border-border bg-card px-3 py-2.5 lg:hidden">
        <Logo />
        <IconButton label="Новая закупка" onClick={props.onNewTender} side="bottom" align="end" className="size-9 border border-border">
          <Plus className="size-4" />
        </IconButton>
      </header>

      <MobileNav {...props} />

      {/* Компьютер: боковая панель */}
      <aside className="hidden shrink-0 flex-col gap-5 rounded-2xl border border-border bg-card p-4 lg:flex lg:h-full lg:w-[248px] lg:overflow-y-auto [&>*]:shrink-0">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <Logo />
            <ThemeButton dark={props.dark} setDark={props.setDark} />
          </div>
          <AiSwitch className="w-full justify-center" />
        </div>
        <Body {...props} />
      </aside>
    </>
  );
}

// Нижняя панель: места шириной не меньше SLOT пикселей; все пункты не помещаются — последнее место «Ещё» с остальными.
const SLOT = 68;
const bar: { id: View; label: string; icon: typeof Briefcase }[] = [
  { id: 'tenders', label: 'Закупки', icon: Briefcase },
  { id: 'analytics', label: 'Аналитика', icon: BarChart2 },
  { id: 'calculator', label: 'Калькулятор', icon: Calculator },
  { id: 'search', label: 'Поиск', icon: Search },
  { id: 'history', label: 'История', icon: History },
  { id: 'tariffs', label: 'Тарифы', icon: Wallet },
  { id: 'settings', label: 'Настройки', icon: Cog },
  { id: 'profile', label: 'Профиль', icon: Building2 },
];

function MobileNav(props: Props) {
  const { view, onNavigate } = props;
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState(5);
  const barBox = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const unread = props.notices.some((n) => n.status === 'replied' && !n.read);
  useDialogFocus(sheet, open);

  // Сколько мест помещается по ширине — считается при каждом изменении размера (поворот телефона, планшет).
  useEffect(() => {
    const el = barBox.current;
    if (!el) return;
    const measure = () => setSlots(Math.max(3, Math.floor(el.clientWidth / SLOT)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  const all = slots >= bar.length;
  // Окно стало шире, и все пункты поместились в панель — «Ещё» закрывается, пустым оно не остаётся.
  useEffect(() => {
    if (all) setOpen(false);
  }, [all]);
  const shown = all ? bar : bar.slice(0, slots - 1);
  const rest = all ? [] : bar.slice(slots - 1);
  // Закупка открыта — подсвечены «Закупки».
  const current: View = view === 'workflow' ? 'tenders' : view;
  const moreActive = rest.some((r) => r.id === current);

  const tab = (active: boolean) =>
    cx(
      'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 py-1.5 text-[10px] leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      active ? 'font-semibold text-primary' : 'text-muted-foreground hover:text-foreground',
    );

  return (
    <>
      <nav
        ref={barBox}
        aria-label="Разделы"
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch gap-0.5 border-t border-border bg-card/95 px-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur-xl lg:hidden"
      >
        {shown.map((n) => {
          const Icon = n.icon;
          return (
            <button key={n.id} type="button" onClick={() => onNavigate(n.id)} aria-current={current === n.id ? 'page' : undefined} className={tab(current === n.id)}>
              <Icon className="size-5 shrink-0" />
              <span className="max-w-full truncate">{n.label}</span>
            </button>
          );
        })}
        {!all && (
          <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className={tab(moreActive || open)}>
            <MoreHorizontal className="size-5 shrink-0" />
            <span>Ещё</span>
            {unread && <span className="absolute right-1/4 top-1 size-2 rounded-full bg-danger ring-2 ring-card" />}
          </button>
        )}
      </nav>

      {open &&
        createPortal(
          <div ref={sheet} tabIndex={-1} className="fixed inset-0 z-50 outline-none lg:hidden" role="dialog" aria-modal="true" aria-label="Ещё">
            <div className="animate-tip absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
            <div className="animate-fade-up absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col gap-4 overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] [&>*]:shrink-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[15px] font-bold">Ещё</p>
                <IconButton label="Закрыть" onClick={() => setOpen(false)} side="bottom" align="end">
                  <X className="size-5" />
                </IconButton>
              </div>
              <ul className="flex flex-col gap-1">
                {rest.map((n) => {
                  const Icon = n.icon;
                  const active = current === n.id;
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          onNavigate(n.id);
                        }}
                        aria-current={active ? 'page' : undefined}
                        className={cx(
                          'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-colors',
                          active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                        )}
                      >
                        <Icon className="size-5 shrink-0" />
                        {n.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-col gap-2 border-t border-border pt-4">
                <AiSwitch className="w-full justify-center" />
                <Button variant="secondary" onClick={() => props.setDark(!props.dark)} className="w-full">
                  {props.dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                  {props.dark ? 'Светлая тема' : 'Тёмная тема'}
                </Button>
              </div>
              {props.notices.length > 0 && (
                <div className="flex flex-col gap-1.5 border-t border-border pt-4">
                  <p className="px-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Проверка специалистом</p>
                  {[...props.notices]
                    .sort((a, b) => rank(a) - rank(b))
                    .map((n) => (
                      <NoticeRow
                        key={n.id}
                        notice={n}
                        onOpen={(id) => {
                          setOpen(false);
                          props.onOpenNotice(id);
                        }}
                      />
                    ))}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

// Светлая и тёмная тема — значком в шапке меню, рядом с местом уведомлений.
function ThemeButton({ dark, setDark }: { dark: boolean; setDark: (v: boolean) => void }) {
  return (
    <IconButton label={dark ? 'Светлая тема' : 'Тёмная тема'} onClick={() => setDark(!dark)} side="bottom" align="end" className="size-8">
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </IconButton>
  );
}

function Logo() {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <BrandMark className="size-9 shrink-0" />
      <div className="min-w-0 leading-none">
        <p className="whitespace-nowrap text-sm font-semibold tracking-tight">Тендекс</p>
        <p className="mt-1 truncate whitespace-nowrap font-mono text-[10px] uppercase tracking-wider text-muted-foreground">AI · 44-ФЗ / 223-ФЗ</p>
      </div>
    </div>
  );
}

// Содержимое панели — одно и то же на компьютере и в меню телефона.
function Body({ view, onNavigate, onNewTender, notices, onOpenNotice, credits, company }: Props) {
  // Вошедший пользователь — когда закупки хранятся на сервере; в режиме «в браузере» входа нет и блока тоже.
  const account = useAccount();
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

      <div className="mt-auto flex flex-col gap-2">
        {sorted.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="px-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Проверка специалистом</p>
            {sorted.map((n) => (
              <NoticeRow key={n.id} notice={n} onOpen={onOpenNotice} />
            ))}
          </div>
        )}

        {/* Компания и вход — одна карточка: сверху компания (ведёт в профиль), снизу кто вошёл. «Выйти» — в «Настройках» (решение владельца 16.10.2026). */}
        <div className="card-hover relative overflow-hidden rounded-md border border-border">
          <button
            onClick={() => onNavigate('profile')}
            aria-current={view === 'profile' ? 'page' : undefined}
            className={cx('relative flex w-full items-center gap-2.5 p-2.5 text-left transition-colors hover:bg-secondary', view === 'profile' && 'bg-secondary')}
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
              {(company.name.replace(/[^\p{L}]/gu, '').slice(0, 2) || '—').toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium">{company.name || 'Моя компания'}</p>
              {(company.inn || credits > 0) && (
                <p className="truncate font-mono text-[10px] text-muted-foreground">
                  {company.inn && `ИНН ${company.inn}`}
                  {credits > 0 && `${company.inn ? ' · ' : ''}заявок на балансе: ${credits}`}
                </p>
              )}
            </div>
            {unread && <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-danger" />}
          </button>
          {account && (
            <div className="border-t border-border bg-secondary/30 px-2.5 py-1.5">
              <p className="truncate font-mono text-[10px] text-muted-foreground" title={account.email ?? undefined}>
                {account.email ?? 'Вы вошли'}
              </p>
            </div>
          )}
        </div>
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
        'card-hover relative flex w-full items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors',
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
