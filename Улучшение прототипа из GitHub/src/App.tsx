import { useEffect, useState } from 'react';
import { Check, Upload, ScanSearch, Calculator, ShieldAlert, PackageCheck, ArrowLeft } from './lib/icons';
import { Sidebar, type View } from './components/Sidebar';
import { TendersDashboard } from './components/TendersDashboard';
import { TenderSearch } from './components/TenderSearch';
import { BidHistory } from './components/BidHistory';
import { Profile } from './components/Profile';
import { StepUpload } from './components/StepUpload';
import { StepAnalysis } from './components/StepAnalysis';
import { StepPricing } from './components/StepPricing';
import { StepReview } from './components/StepReview';
import { StepPackage } from './components/StepPackage';
import { ChatAssistant } from './components/ChatAssistant';
import { myTenders, gaps, procedureMeta, type TenderStatus } from './lib/data';

const steps = [
  { label: 'Загрузка', icon: Upload },
  { label: 'Анализ', icon: ScanSearch },
  { label: 'Цена', icon: Calculator },
  { label: 'Проверка', icon: ShieldAlert },
  { label: 'Пакет', icon: PackageCheck },
];

// Значения исправлений слепых зон: id → введённое значение / имя файла / выбор.
export type Fixes = Record<string, string>;

// На каком шаге открывать закупку в зависимости от её статуса,
// чтобы не упираться в загрузку по уже готовым заявкам.
const stepByStatus: Record<TenderStatus, number> = {
  draft: 0,
  progress: 1,
  ready: 3,
  submitted: 4,
};

// Заполненные «слепые зоны» для закупок, которые уже готовы / поданы.
function resolvedFixes(): Fixes {
  const f: Fixes = {};
  for (const g of gaps) {
    if (g.kind === 'upload') f[g.id] = 'Сертификат_соответствия_МФУ.pdf';
    else if (g.kind === 'choice') f[g.id] = g.choices!.find((c) => c !== 'Ещё не оформлено')!;
    else f[g.id] = (g.placeholder ?? 'указано').replace(/^например:\s*/, '');
  }
  return f;
}

export default function App() {
  const [view, setView] = useState<View>('tenders');
  const [activeTender, setActiveTender] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [fixes, setFixes] = useState<Fixes>({});
  const [dark, setDark] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [specialistStatus, setSpecialistStatus] = useState<'idle' | 'sent' | 'replied'>('idle');

  const handleSpecialistSent = () => {
    setSpecialistStatus('sent');
    // Simulate specialist reply after 6 seconds
    setTimeout(() => setSpecialistStatus('replied'), 6000);
  };

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const go = (n: number) => setStep(Math.max(0, Math.min(steps.length - 1, n)));
  const setFix = (id: string, value: string) =>
    setFixes((prev) => {
      const next = { ...prev };
      if (value) next[id] = value;
      else delete next[id];
      return next;
    });

  const openTender = (id: string) => {
    const t = myTenders.find((x) => x.id === id);
    setActiveTender(id);
    if (!t) {
      setStep(0);
      setFixes({});
    } else {
      setStep(stepByStatus[t.status]);
      setFixes(t.status === 'ready' || t.status === 'submitted' ? resolvedFixes() : {});
    }
    setView('workflow');
  };
  const newTender = () => {
    setActiveTender(null);
    setStep(0);
    setFixes({});
    setView('workflow');
  };

  const tender = myTenders.find((t) => t.id === activeTender);

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
          specialistStatus={specialistStatus}
        />

        <main className="min-w-0 flex-1 lg:overflow-y-auto">
          <div className="mx-auto max-w-4xl py-2 lg:py-4">
            {view === 'tenders' && <TendersDashboard onOpen={openTender} onNew={newTender} />}
            {view === 'search' && <TenderSearch onAdd={openTender} />}
            {view === 'history' && <BidHistory />}
            {view === 'profile' && <Profile />}
            {view === 'workflow' && (
              <div className="space-y-6">
                {/* Workflow header + stepper island */}
                <div className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
                  <div>
                    <button
                      onClick={() => setView('tenders')}
                      className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                    >
                      <ArrowLeft className="size-3" /> Мои закупки
                    </button>
                    {tender ? (
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground">
                            {procedureMeta[tender.procedure].label}
                          </span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {tender.law} · №{tender.id}
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm font-medium">{tender.title}</p>
                        <p className="mt-1 text-[12px] text-muted-foreground">
                          {procedureMeta[tender.procedure].hint}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm font-medium">Новая закупка</p>
                    )}
                  </div>

                  {/* Horizontal stepper */}
                  <ol className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  {steps.map((s, i) => {
                    const state = i < step ? 'done' : i === step ? 'active' : 'todo';
                    const Icon = s.icon;
                    return (
                      <li key={s.label} className="flex shrink-0 items-center gap-1.5">
                        <button
                          onClick={() => i <= step && go(i)}
                          disabled={i > step}
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
                        {i < steps.length - 1 && <span className="h-px w-4 shrink-0 bg-border" />}
                      </li>
                    );
                  })}
                  </ol>
                </div>

                {/* Step content */}
                <div>
                  {step === 0 && <StepUpload preloaded={!!tender} onNext={() => go(1)} />}
                  {step === 1 && <StepAnalysis onNext={() => go(2)} onBack={() => go(0)} />}
                  {step === 2 && <StepPricing onNext={() => go(3)} onBack={() => go(1)} />}
                  {step === 3 && (
                    <StepReview fixes={fixes} setFix={setFix} onNext={() => go(4)} onBack={() => go(2)} />
                  )}
                  {step === 4 && (
                    <StepPackage
                      fixes={fixes}
                      onBack={() => go(3)}
                      onReview={() => go(3)}
                      specialistStatus={specialistStatus}
                      onSpecialistSent={handleSpecialistSent}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      <ChatAssistant open={chatOpen} setOpen={setChatOpen} />
    </div>
  );
}
