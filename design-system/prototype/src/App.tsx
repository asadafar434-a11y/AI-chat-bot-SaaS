import { useCallback, useEffect, useState } from 'react';
import { Check, Upload, ScanSearch, Calculator, ShieldAlert, PackageCheck, ArrowLeft, Clock, Bell } from './lib/icons';
import { Sidebar, type View, type Notice } from './components/Sidebar';
import { TendersDashboard } from './components/TendersDashboard';
import { TenderSearch } from './components/TenderSearch';
import { BidHistory } from './components/BidHistory';
import { Profile } from './components/Profile';
import { StepUpload } from './components/StepUpload';
import { StepAnalysis } from './components/StepAnalysis';
import { StepPricing } from './components/StepPricing';
import { StepReview } from './components/StepReview';
import { StepPackage } from './components/StepPackage';
import { ChatAssistant, type ExpertNote } from './components/ChatAssistant';
import { Badge, Toast, Tooltip } from './components/ui';
import { myTenders, foundTenders, gaps, procedureMeta, type Gap, type TenderStatus } from './lib/data';
import { expertConclusion, expertRemarks, fieldCounts, freshApp, type AppState } from './lib/app-state';

const steps = [
  { label: 'Загрузка', icon: Upload, hint: 'Документы закупки с площадки' },
  { label: 'Анализ', icon: ScanSearch, hint: 'Что подать и что уже готово' },
  { label: 'Цена', icon: Calculator, hint: 'До какой цены снижаться' },
  { label: 'Проверка', icon: ShieldAlert, hint: 'Что дописать, подтвердить и риск отклонения' },
  { label: 'Пакет', icon: PackageCheck, hint: 'Скачать документы и отправить специалисту' },
];

export type { Fixes } from './lib/app-state';

// На каком шаге открывать закупку в зависимости от её статуса,
// чтобы не упираться в загрузку по уже готовым заявкам.
const stepByStatus: Record<TenderStatus, number> = {
  draft: 0,
  progress: 1,
  ready: 3,
  submitted: 4,
};

// Заполненные поля для закупок, которые уже готовы или поданы.
const SAMPLE_VALUES: Record<string, string> = { registry: 'Товар иностранный — Китай' };
function sampleValue(g: Gap) {
  if (g.kind === 'upload') return 'Сертификат_соответствия_МФУ.pdf';
  if (g.kind === 'choice') return g.choices!.find((c) => c.ok)!.label;
  if (g.kind === 'confirm') return g.found!;
  return SAMPLE_VALUES[g.id] ?? (g.placeholder ?? 'указано').replace(/^например:\s*/, '');
}

function initialApps(): Record<string, AppState> {
  const out: Record<string, AppState> = {};
  for (const t of myTenders) {
    if (t.status === 'ready' || t.status === 'submitted') {
      out[t.id] = { ...freshApp(), fixes: Object.fromEntries(gaps.map((g) => [g.id, sampleValue(g)])), paid: true, discount: 8 };
    }
  }
  return out;
}

const titleOf = (id: string) =>
  myTenders.find((t) => t.id === id)?.title ?? foundTenders.find((t) => t.id === id)?.title ?? 'Новая закупка';

export default function App() {
  const [view, setView] = useState<View>('tenders');
  const [activeTender, setActiveTender] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [apps, setApps] = useState<Record<string, AppState>>(initialApps);
  const [dark, setDark] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Заявка, по которой только что ответил специалист, — для всплывающего уведомления.
  const [toast, setToast] = useState<string | null>(null);
  // Слепая зона, к которой перейти на шаге «Проверка» — из замечания специалиста или из «Анализа».
  const [focusGap, setFocusGap] = useState<string | null>(null);

  const key = activeTender ?? 'new';
  const app = apps[key] ?? freshApp();

  const patchApp = useCallback(
    (k: string, p: Partial<AppState> | ((a: AppState) => Partial<AppState>)) =>
      setApps((prev) => {
        const cur = prev[k] ?? freshApp();
        return { ...prev, [k]: { ...cur, ...(typeof p === 'function' ? p(cur) : p) } };
      }),
    [],
  );
  const patch = (p: Partial<AppState> | ((a: AppState) => Partial<AppState>)) => patchApp(key, p);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  // Ответ специалиста прочитан, когда открыт шаг «Пакет» этой заявки.
  useEffect(() => {
    if (view === 'workflow' && step === 4 && app.specialist?.status === 'replied' && !app.specialist.read) {
      patchApp(key, (a) => ({ specialist: { ...a.specialist!, read: true } }));
    }
  }, [view, step, key, app.specialist, patchApp]);

  const go = (n: number) => setStep(Math.max(0, Math.min(steps.length - 1, n)));
  const setFix = (id: string, value: string) =>
    patch((a) => {
      const next = { ...a.fixes };
      if (value) next[id] = value;
      else delete next[id];
      return { fixes: next };
    });

  const openTender = (id: string, at?: number) => {
    const t = myTenders.find((x) => x.id === id);
    setActiveTender(id);
    setStep(at ?? (t ? stepByStatus[t.status] : 0));
    setFocusGap(null);
    setView('workflow');
  };
  const newTender = () => {
    setActiveTender(null);
    setApps((prev) => ({ ...prev, new: freshApp() }));
    setStep(0);
    setFocusGap(null);
    setView('workflow');
  };
  const goToGap = (id: string) => {
    setFocusGap(id);
    go(3);
  };

  // Проверка специалистом: ответ в прототипе приходит через 6 секунд — в жизни до 2 часов.
  const sendToExpert = () => {
    const k = key;
    patchApp(k, (a) => ({ paid: true, specialist: { status: 'sent', read: false, remarks: expertRemarks(a.fixes) } }));
    window.setTimeout(() => {
      patchApp(k, (a) => (a.specialist ? { specialist: { ...a.specialist, status: 'replied', read: false } } : {}));
      setToast(k);
    }, 6000);
  };
  const openReply = (id: string) => {
    setToast(null);
    setChatOpen(false);
    setActiveTender(id === 'new' ? null : id);
    setStep(4);
    setFocusGap(null);
    setView('workflow');
  };

  const notices: Notice[] = Object.entries(apps)
    .filter(([, a]) => a.specialist)
    .map(([id, a]) => ({ id, title: titleOf(id), status: a.specialist!.status, read: a.specialist!.read }));
  const expertNotes: ExpertNote[] = Object.entries(apps)
    .filter(([, a]) => a.specialist?.status === 'replied')
    .map(([id, a]) => ({
      id,
      title: titleOf(id),
      text: [...a.specialist!.remarks.map((r) => `• ${r.text}`), expertConclusion(a.specialist!.remarks)].join('\n'),
    }));

  const tender = myTenders.find((t) => t.id === activeTender) ?? foundTenders.find((t) => t.id === activeTender);
  const progressOf = (id: string) => Math.round(fieldCounts((apps[id] ?? freshApp()).fixes).share * 100);

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
          notices={notices}
          onOpenNotice={openReply}
        />

        <main className="min-w-0 flex-1 lg:overflow-y-auto">
          <div className="mx-auto max-w-4xl py-2 lg:py-4">
            {view === 'tenders' && (
              <TendersDashboard onOpen={(id) => openTender(id)} onNew={newTender} apps={apps} progressOf={progressOf} />
            )}
            {view === 'search' && <TenderSearch onAdd={(id) => openTender(id)} />}
            {view === 'history' && <BidHistory />}
            {view === 'profile' && <Profile />}
            {view === 'workflow' && (
              <div className="space-y-6">
                {/* Workflow header + stepper island */}
                <div className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <button
                        onClick={() => setView('tenders')}
                        className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                      >
                        <ArrowLeft className="size-3" /> Мои закупки
                      </button>
                      {tender ? (
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Tooltip content={procedureMeta[tender.procedure].hint}>
                              <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground">
                                {procedureMeta[tender.procedure].label}
                              </span>
                            </Tooltip>
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
                    {app.specialist && (
                      <ExpertChip
                        status={app.specialist.status}
                        unread={!app.specialist.read}
                        onOpen={() => go(4)}
                      />
                    )}
                  </div>

                  {/* Horizontal stepper */}
                  <ol className="flex items-center gap-1.5 overflow-x-auto pb-1">
                    {steps.map((s, i) => {
                      const state = i < step ? 'done' : i === step ? 'active' : 'todo';
                      const Icon = s.icon;
                      return (
                        <li key={s.label} className="flex shrink-0 items-center gap-1.5">
                          <Tooltip
                            content={i > step ? `${s.hint}. Откроется после шага «${steps[step].label}».` : s.hint}
                            side="bottom"
                            align={i === 0 ? 'start' : i === steps.length - 1 ? 'end' : 'center'}
                          >
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
                          </Tooltip>
                          {i < steps.length - 1 && <span className="h-px w-4 shrink-0 bg-border" />}
                        </li>
                      );
                    })}
                  </ol>
                </div>

                {/* Step content */}
                <div>
                  {step === 0 && <StepUpload preloaded={!!tender && myTenders.some((t) => t.id === tender.id)} onNext={() => go(1)} />}
                  {step === 1 && (
                    <StepAnalysis fixes={app.fixes} onNext={() => go(2)} onBack={() => go(0)} onFixGap={goToGap} />
                  )}
                  {step === 2 && (
                    <StepPricing
                      discount={app.discount}
                      setDiscount={(discount) => patch({ discount })}
                      onNext={() => go(3)}
                      onBack={() => go(1)}
                    />
                  )}
                  {step === 3 && (
                    <StepReview
                      app={app}
                      setFix={setFix}
                      patch={patch}
                      focusGap={focusGap}
                      onFocused={() => setFocusGap(null)}
                      onNext={() => go(4)}
                      onBack={() => go(2)}
                    />
                  )}
                  {step === 4 && (
                    <StepPackage
                      app={app}
                      patch={patch}
                      onBack={() => go(3)}
                      onFixGap={goToGap}
                      onSendToExpert={sendToExpert}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      <ChatAssistant open={chatOpen} setOpen={setChatOpen} notes={expertNotes} onOpenNote={openReply} />

      {toast && (
        <Toast
          title="Специалист ответил"
          text={`${titleOf(toast)}: заключение и замечания — в шаге «Пакет».`}
          action="Открыть ответ"
          onAction={() => openReply(toast)}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

// Статус проверки специалистом в шапке закупки: отправлено — ждём, ответил — открыть ответ.
function ExpertChip({ status, unread, onOpen }: { status: 'sent' | 'replied'; unread: boolean; onOpen: () => void }) {
  if (status === 'sent') {
    return (
      <Tooltip content="Юрист вручную сверяет пакет с извещением. Ответ придёт в течение 2 часов — уведомим." align="end">
        <Badge tone="warn">
          <Clock className="size-3" /> У специалиста · ответ до 2 ч
        </Badge>
      </Tooltip>
    );
  }
  return (
    <button
      onClick={onOpen}
      className="relative inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-1 text-[12px] font-medium text-success transition-colors hover:bg-success/15"
    >
      <Bell className="size-3.5" /> Ответ специалиста
      {unread && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-danger ring-2 ring-card" />}
    </button>
  );
}
