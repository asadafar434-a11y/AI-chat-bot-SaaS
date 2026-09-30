import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, Upload, ScanSearch, Calculator, ShieldAlert, PackageCheck, ArrowLeft } from './lib/icons';
import { Sidebar, type View } from './components/Sidebar';
import { TendersDashboard } from './components/TendersDashboard';
import { TenderSearch } from './components/TenderSearch';
import { BidHistory } from './components/BidHistory';
import { Profile } from './components/Profile';
import { Tariffs } from './components/Tariffs';
import { ChatAssistant } from './components/ChatAssistant';
import { Badge, Tooltip } from './components/ui';
import { dueLine } from '@/lib/deadline';
import { procedureHint } from '@/lib/dashboard';
import { titleOf } from '@/lib/purchase';
import { deletePurchase, savePurchase } from '@/lib/purchase-store';
import { askPersistentStorage } from '@/lib/backup';
import { openSamplePurchase } from '@/lib/sample-purchase';
import { stepsOf } from '@/lib/steps';
import { usePurchases } from '@/lib/use-purchases';
import { PurchaseAnalysis, useProfile } from './real/analysis';
import { PurchaseProvider, usePurchase } from './real/purchase-provider';
import { toTender } from './real/tenders';
import { ConsentGate } from './real/consent';
import { PurchasePackage } from './real/package';
import { PurchasePricing } from './real/pricing';
import { PurchaseReview } from './real/review';
import { NewPurchaseUpload, PurchaseUpload } from './real/upload';

const steps = [
  { label: 'Загрузка', icon: Upload, hint: 'Документы закупки с площадки' },
  { label: 'Анализ', icon: ScanSearch, hint: 'Что подать и что уже готово' },
  { label: 'Цена', icon: Calculator, hint: 'До какой цены снижаться' },
  { label: 'Проверка', icon: ShieldAlert, hint: 'Что дописать, подтвердить и риск отклонения' },
  { label: 'Пакет', icon: PackageCheck, hint: 'Скачать документы и отправить специалисту' },
];

export default function App() {
  return (
    <ConsentGate>
      <Product />
    </ConsentGate>
  );
}

function Product() {
  const [view, setView] = useState<View>('tenders');
  // null — новая закупка, документы ещё не загружены.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [dark, setDark] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const { purchases } = usePurchases();
  const profile = useProfile();

  const tenders = useMemo(() => (purchases ?? []).map(toTender), [purchases]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  // Просим браузер не стирать данные сайта при нехватке места; не разрешит — остаётся копия файлом в «Профиле компании».
  useEffect(() => {
    void askPersistentStorage();
  }, []);

  // Открывая закупку, сразу ведём на первый шаг, где ещё есть работа.
  const openTender = (id: string, first?: number) => {
    const p = purchases?.find((x) => x.id === id);
    const at = first ?? (p ? stepsOf(p).findIndex((s) => s.state !== 'done') : 0);
    setActiveId(id);
    setStep(at < 0 ? 4 : at);
    setView('workflow');
  };
  // Пример один на браузер. Только что созданного ещё нет в списке — сразу ведём на «Анализ».
  const openSample = async () => {
    const id = await openSamplePurchase();
    openTender(id, purchases?.some((x) => x.id === id) ? undefined : 1);
  };
  const newTender = () => {
    setActiveId(null);
    setStep(0);
    setView('workflow');
  };
  const toTenders = useCallback(() => setView('tenders'), []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col gap-3 p-3 lg:h-screen lg:flex-row lg:gap-4 lg:p-4">
        <Sidebar
          view={view}
          onNavigate={setView}
          onNewTender={newTender}
          onOpenChat={() => setChatOpen(true)}
          dark={dark}
          setDark={setDark}
          notices={[]}
          onOpenNotice={() => {}}
          credits={0}
          company={{ name: profile.shortName.trim() || profile.fullName.trim(), inn: profile.inn.trim() }}
        />

        <main className="min-w-0 flex-1 lg:overflow-y-auto">
          <div className="mx-auto max-w-4xl py-2 lg:py-4">
            {view === 'tenders' && (
              <TendersDashboard
                tenders={tenders}
                onOpen={(id) => openTender(id)}
                onNew={newTender}
                onOpenSample={() => void openSample()}
                onDelete={(id) => void deletePurchase(id)}
                onToggleSubmitted={(id) => {
                  const p = purchases?.find((x) => x.id === id);
                  if (p) void savePurchase({ ...p, submitted: !p.submitted });
                }}
              />
            )}
            {view === 'search' && <TenderSearch onAdd={() => {}} />}
            {view === 'history' && <BidHistory />}
            {view === 'profile' && <Profile />}
            {view === 'tariffs' && <Tariffs />}
            {view === 'workflow' &&
              (activeId ? (
                <PurchaseProvider id={activeId} onMissing={toTenders}>
                  <Workflow
                    step={step}
                    setStep={setStep}
                    onBackToList={toTenders}
                    onOpenProfile={() => setView('profile')}
                    onOpenTariffs={() => setView('tariffs')}
                  />
                </PurchaseProvider>
              ) : (
                <Shell step={0} setStep={() => {}} onBackToList={toTenders} header={<p className="text-sm font-medium">Новая закупка</p>} reach={0}>
                  <NewPurchaseUpload
                    onCreated={(id) => {
                      setActiveId(id);
                      setStep(1);
                    }}
                  />
                </Shell>
              ))}
          </div>
        </main>
      </div>

      <ChatAssistant open={chatOpen} setOpen={setChatOpen} notes={[]} onOpenNote={() => {}} />
    </div>
  );
}

// Шапка закупки и шаги — разметка прототипа. header — что в шапке справа от кнопки «Мои закупки».
function Shell({
  step,
  setStep,
  onBackToList,
  header,
  aside,
  reach,
  done = [],
  children,
}: {
  step: number;
  setStep: (n: number) => void;
  onBackToList: () => void;
  header: ReactNode;
  aside?: ReactNode;
  // Дальше какого шага можно перейти.
  reach: number;
  // Пройденные шаги — у них галочка.
  done?: boolean[];
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              onClick={onBackToList}
              className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              <ArrowLeft className="size-3" /> Мои закупки
            </button>
            {header}
          </div>
          {aside}
        </div>

        <ol className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {steps.map((s, i) => {
            const state = i === step ? 'active' : done[i] ? 'done' : 'todo';
            const Icon = s.icon;
            const locked = i > reach;
            return (
              <li key={s.label} className="flex shrink-0 items-center gap-1.5">
                <Tooltip
                  content={locked ? `${s.hint}. Откроется после шага «${steps[reach].label}».` : s.hint}
                  side="bottom"
                  align={i === 0 ? 'start' : i === steps.length - 1 ? 'end' : 'center'}
                >
                  <button
                    onClick={() => !locked && setStep(i)}
                    disabled={locked}
                    className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed ${
                      state === 'active'
                        ? 'bg-secondary text-foreground'
                        : state === 'done'
                          ? 'text-foreground hover:bg-secondary/60'
                          : 'text-muted-foreground'
                    }`}
                  >
                    <span
                      className={`flex size-5 items-center justify-center rounded-full border text-[10px] ${
                        state === 'done'
                          ? 'border-foreground bg-primary text-primary-foreground'
                          : state === 'active'
                            ? 'border-foreground'
                            : 'border-border'
                      }`}
                    >
                      {state === 'done' ? <Check className="size-3" /> : <Icon className="size-3" />}
                    </span>
                    {s.label}
                  </button>
                </Tooltip>
                {i < steps.length - 1 && <span className="h-px w-4 shrink-0 bg-border" />}
              </li>
            );
          })}
        </ol>
      </div>

      <div>{children}</div>
    </div>
  );
}

// Открытая закупка: шапка из её данных и содержимое выбранного шага.
function Workflow({
  step,
  setStep,
  onBackToList,
  onOpenProfile,
  onOpenTariffs,
}: {
  step: number;
  setStep: (n: number) => void;
  onBackToList: () => void;
  onOpenProfile: () => void;
  onOpenTariffs: () => void;
}) {
  const { purchase, saveError } = usePurchase();
  const due = dueLine(purchase.deadline, true);
  const real = stepsOf(purchase);
  const go = (n: number) => setStep(Math.max(0, Math.min(steps.length - 1, n)));

  const way = purchase.kind.split('·').slice(1).join('·').trim();
  // Способ закупки неизвестен (закупку создали без ИИ-анализа) — метку и подсказку не выдумываем.
  const label = way ? way[0].toUpperCase() + way.slice(1) : '';
  const hint = procedureHint(purchase);
  const law = purchase.kind.match(/(?<!\d)(44|223)-ФЗ/)?.[0] ?? '';

  return (
    <Shell
      step={step}
      setStep={go}
      onBackToList={onBackToList}
      reach={4}
      done={real.map((s) => s.state === 'done')}
      header={
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {label && (
              <Tooltip content={hint || label}>
                <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground">{label}</span>
              </Tooltip>
            )}
            {purchase.sample && <Badge>пример</Badge>}
            {law && <span className="font-mono text-[11px] text-muted-foreground">{law}</span>}
          </div>
          <p className="mt-1.5 text-sm font-medium">{titleOf(purchase)}</p>
          {hint && <p className="mt-1 text-[12px] text-muted-foreground">{hint}</p>}
        </div>
      }
      aside={
        due && (
          <Badge tone={due.tone === 'soon' ? 'warn' : 'neutral'}>
            {due.head}
            {due.left ? ` · ${due.left.replace(/ /g, ' ')}` : ''}
          </Badge>
        )
      }
    >
      {saveError && (
        <p className="mb-4 rounded-md bg-warn-surface/40 px-3 py-2 text-[13px] text-warn-foreground">
          Не получилось сохранить изменения в браузере. Не закрывайте страницу и попробуйте ещё раз.
        </p>
      )}
      {step === 0 && <PurchaseUpload onNext={() => go(1)} />}
      {step === 1 && <PurchaseAnalysis onNext={() => go(2)} onBack={() => go(0)} onFix={(at) => go(at === 'review' ? 3 : 4)} />}
      {step === 2 && <PurchasePricing onNext={() => go(3)} onBack={() => go(1)} />}
      {step === 3 && <PurchaseReview onGo={go} onOpenProfile={onOpenProfile} onNext={() => go(4)} onBack={() => go(2)} />}
      {step >= 4 && <PurchasePackage onBack={() => go(3)} onFix={() => go(3)} onTariffs={onOpenTariffs} />}
    </Shell>
  );
}
