import { useState, type ReactNode } from 'react';
import {
  addOwn,
  ownItems,
  removeOwn,
  CERTIFICATE_OPTIONS,
  EXPERIENCE_FIELDS,
  INDUSTRY_OPTIONS,
  LICENSE_OPTIONS,
  PERMIT_OPTIONS,
  rublesText,
  toggleItem,
  type ChipSet,
  type CompanyCard,
  type ExperienceKey,
  type Strength,
  type StrengthKey,
} from '@/lib/company-card';
import { Award, Briefcase, Check, ChevronDown, FileText, Plus, Target, X } from '../lib/icons';
import { Button, Card, cx, fieldClass, Soon, StepActions, Tabs } from './ui';

// Экран «Профиль компании» по образцу конкурентов (владелец, 03.11.2026: «такой профиль как у конкурентов и с нашими микс»): шапка «Сила профиля», вкладки-шаги
// с состоянием, плашки выбора и нижняя панель. Наше сверху: реквизиты, база доказательств и образцы остаются, а выбранное в плашках — «заявлено вами»,
// доказательством становится документ в базе (не придуманное программой).

// Шапка: кольцо с процентом, разделы профиля со своей долей (клик — на шаг), следующий шаг и что это даёт. Обещаем только то, что работает; подбор тендеров — «скоро».
const tabOf = (key: StrengthKey) => (key === 'requisites' ? 'profile' : key);

export function ProfileHero({ strength, facts, onOpen, defaultOpen = false }: { strength: Strength; facts: number; onOpen: (key: string) => void; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const req = strength.parts.find((p) => p.key === 'requisites')!;
  const done = strength.percent >= 100;
  const next = strength.parts.find((p) => !p.done);
  const benefits: {
    title: string;
    ok: boolean;
    soon?: boolean;
    tab?: string;
  }[] = [
    { title: 'Заявка заполняется сама', ok: req.share >= 0.7, tab: 'profile' },
    { title: 'Проверка по базе доказательств', ok: facts > 0, tab: 'evidence' },
    { title: 'Подбор тендеров по специализации', ok: false, soon: true },
  ];
  const R = 42;
  const C = 2 * Math.PI * R;
  const bodyId = 'profile-strength-body';
  return (
    <Card className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
          className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span role="progressbar" aria-label="Сила профиля" aria-valuemin={0} aria-valuemax={100} aria-valuenow={strength.percent} className="relative size-11 shrink-0">
            <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
              <circle cx="50" cy="50" r={R} fill="none" strokeWidth="11" className="stroke-muted" />
              <circle
                cx="50"
                cy="50"
                r={R}
                fill="none"
                strokeWidth="11"
                strokeLinecap="round"
                className="stroke-primary transition-all duration-500"
                strokeDasharray={C}
                strokeDashoffset={C * (1 - strength.percent / 100)}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center font-mono text-[11px] font-bold tabular-nums">{strength.percent}%</span>
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-bold leading-tight">{done ? 'Профиль заполнен' : 'Сила профиля'}</span>
            <span className="block text-[12px] leading-snug text-muted-foreground">Полнота данных, а не оценка шансов на победу</span>
          </span>
          <ChevronDown className={cx('ml-auto size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
          <span className="sr-only">{open ? 'Свернуть' : 'Развернуть'}</span>
        </button>
        {next && (
          <Button size="sm" onClick={() => onOpen(tabOf(next.key))}>
            Дальше: {next.label}
          </Button>
        )}
      </div>
      {open && (
        <div id={bodyId} className="mt-3 border-t border-border pt-3">
          <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {strength.parts.map((p) => (
              <li key={p.key} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onOpen(tabOf(p.key))}
                  className="group block w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="flex min-w-0 items-center gap-1.5 font-medium">
                      {p.done && <Check className="size-3.5 shrink-0 text-success" />}
                      <span className="truncate">{p.label}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[12px] text-muted-foreground">до {p.weight}%</span>
                  </span>
                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted">
                    <span className={cx('block h-full rounded-full transition-all duration-500', p.done ? 'bg-success' : 'bg-primary')} style={{ width: `${Math.round(p.share * 100)}%` }} />
                  </span>
                  <span className="mt-1 block text-[12px] text-muted-foreground">{p.detail}</span>
                </button>
              </li>
            ))}
          </ul>
          <ul className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
            {benefits.map((b) => (
              <li key={b.title}>
                {b.tab && !b.soon ? (
                  <button
                    type="button"
                    onClick={() => onOpen(b.tab!)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[12px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span aria-hidden className={cx('size-2 rounded-full', b.ok ? 'bg-success' : 'bg-muted-foreground/40')} />
                    {b.title}
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-1 text-[12px] text-muted-foreground">
                    <span aria-hidden className="size-2 rounded-full bg-muted-foreground/40" />
                    {b.title}
                    <span className="text-[10px] font-medium uppercase tracking-wide">скоро</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// Вкладки профиля — общий Tabs, как на остальных экранах: пять шагов с точкой «заполнено / нет» и две наши вкладки. Реквизиты называются в коде profile.
export function ProfileSteps({
  idPrefix,
  active,
  onChange,
  strength,
  extras,
}: {
  idPrefix: string;
  active: string;
  onChange: (key: string) => void;
  strength: Strength;
  extras: { key: string; label: string; badge?: ReactNode }[];
}) {
  const items = [
    ...strength.parts.map((p) => ({
      key: tabOf(p.key),
      label: p.label,
      badge: <span aria-label={p.done ? 'заполнено' : 'не заполнено'} className={cx('size-2 rounded-full', p.done ? 'bg-success' : 'bg-muted-foreground/40')} />,
    })),
    ...extras,
  ];
  return <Tabs idPrefix={idPrefix} items={items} active={active} onChange={onChange} />;
}

// Плашка-переключатель: нажата — залита голубым «Тендекса». У своего пункта справа крестик «Удалить»: нажатие на саму плашку только снимает выбор, пункт остаётся.
function Chip({ label, on, onClick, onRemove }: { label: string; on: boolean; onClick: () => void; onRemove?: () => void }) {
  const look = on ? 'border-primary bg-primary font-medium text-primary-foreground' : 'border-border bg-background hover:border-foreground/40 hover:bg-secondary';
  const ring = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  if (!onRemove) {
    return (
      <button type="button" aria-pressed={on} onClick={onClick} className={cx('inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition-colors', look, ring)}>
        {on && <Check className="size-3.5" />}
        {label}
      </button>
    );
  }
  return (
    <span className={cx('inline-flex min-h-8 items-center rounded-full border text-[13px] transition-colors', look)}>
      <button type="button" aria-pressed={on} onClick={onClick} className={cx('inline-flex min-h-7 items-center gap-1.5 rounded-full pl-3.5 pr-2', ring)}>
        {on && <Check className="size-3.5" />}
        {label}
      </button>
      <button
        type="button"
        aria-label={`Удалить «${label}»`}
        title="Удалить"
        onClick={onRemove}
        className={cx('mr-1 flex size-6 shrink-0 items-center justify-center rounded-full', on ? 'hover:bg-white/20' : 'text-muted-foreground hover:bg-secondary hover:text-foreground', ring)}
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}

// Набор плашек: готовые варианты, свои пункты (снять выбор — нажатием, удалить — крестиком) и поле «Добавить своё».
function ChipGroup({
  title,
  options,
  group,
  card,
  onChange,
  addLabel,
}: {
  title?: string;
  options: string[];
  group: ChipSet;
  card: CompanyCard;
  onChange: (next: CompanyCard) => void;
  addLabel: string;
}) {
  const [text, setText] = useState('');
  const value = card[group];
  const own = ownItems(card, group, options);
  const add = () => {
    onChange(addOwn(card, group, text));
    setText('');
  };
  return (
    <div className="space-y-3">
      {title && <p className="text-[13px] font-medium text-muted-foreground">{title}</p>}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <Chip key={o} label={o} on={value.includes(o)} onClick={() => onChange({ ...card, [group]: toggleItem(value, o) })} />
        ))}
        {own.map((o) => (
          <Chip key={`own:${o}`} label={o} on={value.includes(o)} onClick={() => onChange({ ...card, [group]: toggleItem(value, o) })} onRemove={() => onChange(removeOwn(card, group, o))} />
        ))}
      </div>
      <div className="flex max-w-xl items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          aria-label={addLabel}
          placeholder={addLabel}
          maxLength={120}
          autoComplete="off"
          className={fieldClass('md', 'flex-1')}
        />
        <Button type="button" variant="secondary" aria-label="Добавить" disabled={!text.trim()} onClick={add}>
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function PanelCard({ icon, title, note, children }: { icon: ReactNode; title: string; note: string; children: ReactNode }) {
  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-bold">
          <span className="text-primary">{icon}</span>
          {title}
        </h2>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground">{note}</span>
      </div>
      {children}
    </Card>
  );
}

// «Заявлено вами»: выбор в плашках — слова участника. Что есть в базе доказательств с документом — рядом, чтобы видеть разрыв.
function EvidenceNote({ facts, onOpen, what }: { facts: number; onOpen: () => void; what: string }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-secondary/60 px-3 py-2 text-[12px] text-muted-foreground">
      <span>
        Выбранное — ваши слова. Подтверждает его документ в базе доказательств
        {facts > 0 ? ` (сейчас там ${facts} ${what})` : ''}.
      </span>
      <button type="button" onClick={onOpen} className="min-h-7 font-medium text-foreground underline underline-offset-4">
        Открыть базу доказательств
      </button>
    </p>
  );
}

type PanelProps = {
  card: CompanyCard;
  onChange: (next: CompanyCard) => void;
  factCount: number;
  onOpenEvidence: () => void;
};

export function ExperiencePanel({ card, onChange }: Pick<PanelProps, 'card' | 'onChange'>) {
  const set = (key: ExperienceKey, raw: string) =>
    onChange({
      ...card,
      experience: {
        ...card.experience,
        [key]: raw.replace(/\D/g, '').slice(0, 15),
      },
    });
  return (
    <PanelCard icon={<Briefcase className="size-4" />} title="Опыт и финансы" note="ваши данные">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {EXPERIENCE_FIELDS.map((f) => {
          const money = f.key === 'turnover' || f.key === 'maxContract';
          const value = card.experience[f.key];
          return (
            <div key={f.key} className="min-w-0 space-y-1.5">
              <label htmlFor={`exp-${f.key}`} className="text-[13px] text-muted-foreground">
                {f.label}
              </label>
              <input
                id={`exp-${f.key}`}
                value={value}
                onChange={(e) => set(f.key, e.target.value)}
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                className={cx(fieldClass('md'), 'font-mono tabular-nums')}
              />
              {money && value && <p className="font-mono text-[12px] text-muted-foreground">{rublesText(value)}</p>}
            </div>
          );
        })}
      </div>
      <p className="text-[12px] text-muted-foreground">Эти цифры помогают сверить, по силам ли вам закупка по размеру контракта и оборота. Подтверждением они не служат.</p>
    </PanelCard>
  );
}

export function IndustriesPanel({ card, onChange }: Pick<PanelProps, 'card' | 'onChange'>) {
  return (
    <PanelCard icon={<Target className="size-4" />} title="Специализация" note="выберите отрасли">
      <ChipGroup options={INDUSTRY_OPTIONS} group="industries" card={card} onChange={onChange} addLabel="Добавить свою отрасль…" />
      <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
        Подбор тендеров по отраслям <Soon />
      </p>
    </PanelCard>
  );
}

export function LicensesPanel({ card, onChange, factCount, onOpenEvidence }: PanelProps) {
  return (
    <PanelCard icon={<FileText className="size-4" />} title="Лицензии и допуски" note="заявлено вами">
      <ChipGroup title="Лицензии" options={LICENSE_OPTIONS} group="licenses" card={card} onChange={(next) => onChange({ ...next, noLicenses: false })} addLabel="Добавить свою лицензию…" />
      <ChipGroup title="Допуски по работам" options={PERMIT_OPTIONS} group="permits" card={card} onChange={(next) => onChange({ ...next, noLicenses: false })} addLabel="Добавить свой допуск…" />
      <NoneToggle
        label="Лицензий и допусков у компании нет"
        on={card.noLicenses}
        disabled={card.licenses.length + card.permits.length > 0}
        onChange={(noLicenses) => onChange({ ...card, noLicenses })}
      />
      <EvidenceNote facts={factCount} onOpen={onOpenEvidence} what="фактов о лицензиях и допусках и других" />
    </PanelCard>
  );
}

export function CertificatesPanel({ card, onChange, factCount, onOpenEvidence }: PanelProps) {
  return (
    <PanelCard icon={<Award className="size-4" />} title="Сертификаты" note="заявлено вами">
      <ChipGroup options={CERTIFICATE_OPTIONS} group="certificates" card={card} onChange={(next) => onChange({ ...next, noCertificates: false })} addLabel="Добавить свой сертификат…" />
      <NoneToggle label="Сертификатов у компании нет" on={card.noCertificates} disabled={card.certificates.length > 0} onChange={(noCertificates) => onChange({ ...card, noCertificates })} />
      <EvidenceNote facts={factCount} onOpen={onOpenEvidence} what="фактов о сертификатах и других" />
    </PanelCard>
  );
}

function NoneToggle({ label, on, disabled, onChange }: { label: string; on: boolean; disabled: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="inline-flex min-h-8 items-center gap-2 rounded-lg text-[13px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className={cx('flex size-4 items-center justify-center rounded-sm border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background')}>
        {on && <Check className="size-3" />}
      </span>
      {label}
    </button>
  );
}

// Нижняя панель: сила профиля и состояние сохранения; при правке реквизитов — «Отмена» и «Сохранить».
// Плавающая полоса — только когда есть что нажать (правка реквизитов) или сказать (не сохранилось); процент и так виден в шапке.
export function ProfileBar({
  status,
  editing,
  onCancel,
  onSave,
}: {
  status: { text: string; failed: boolean } | null;
  editing: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  if (!editing && !status?.failed) return null;
  return (
    <StepActions className="justify-between">
      <p className="min-w-0 text-[13px] text-muted-foreground">
        {status && (
          <span aria-live="polite" className={cx('inline-flex items-center gap-1', status.failed ? 'text-warn-foreground' : 'text-success')}>
            {!status.failed && <Check className="size-3.5" />} {status.text}
          </span>
        )}
      </p>
      {editing && (
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onCancel}>
            <X className="size-4" /> Отмена
          </Button>
          <Button onClick={onSave}>
            <Check className="size-4" /> Сохранить изменения
          </Button>
        </div>
      )}
    </StepActions>
  );
}
