import { useState } from 'react';
import {
  FileText,
  Download,
  UserCheck,
  Check,
  ShieldCheck,
  Clock,
  AlertTriangle,
  Eye,
  Bell,
  Lock,
  CreditCard,
  RefreshCw,
  Archive,
  Loader2,
  Wallet,
} from '../lib/icons';
import { Button, Card, Badge, Modal, AIDisclaimer, HelpTip, Soon, Tooltip, IconButton, cx } from './ui';
import { GENERATIONS, PRICE_APP, PRICE_EXPERT, exportFormats, requiredDocs, tender, rub, company } from '../lib/data';
import { completeness, docStatus, expertConclusion, openGaps, type AppState } from '../lib/app-state';
import { FinalCheck } from './StepReview';

type Patch = (p: Partial<AppState> | ((a: AppState) => Partial<AppState>)) => void;

const value = (fixes: AppState['fixes'], id: string, empty = '—') => fixes[id] ?? empty;

function DocumentBody({ id, fixes }: { id: string; fixes: AppState['fixes'] }) {
  const P = ({ children }: { children: React.ReactNode }) => (
    <p className="text-[13px] leading-relaxed text-foreground">{children}</p>
  );
  const H = ({ children }: { children: React.ReactNode }) => <p className="text-sm font-semibold">{children}</p>;
  const field = (key: string) => company.fields.find((f) => f.key === key)?.value ?? '';

  const bodies: Record<string, React.ReactNode> = {
    goods: (
      <>
        <H>Предложение участника в отношении объекта закупки</H>
        <P>Закупка №{tender.id}: {tender.title}.</P>
        <P>
          Поз. 1. Моноблок 23,8" — Intel Core i5, ОЗУ 16 ГБ, SSD 512 ГБ. Поз. 2. Ноутбук 15,6" — Intel Core i5, ОЗУ
          16 ГБ, накопитель <b>{value(fixes, 'poz2-storage')}</b>. Поз. 3. МФУ лазерное А4 — скорость печати{' '}
          <b>{value(fixes, 'poz3-speed')}</b> стр/мин. Поз. 4. ИБП — выходная мощность <b>{value(fixes, 'poz4-power')}</b>.
        </P>
        <P>Страна происхождения: {value(fixes, 'country', 'не подтверждена')}.</P>
      </>
    ),
    declaration: (
      <>
        <H>Декларация о соответствии участника закупки требованиям</H>
        <P>
          {company.name} декларирует соответствие требованиям, установленным пунктами 3–5, 7–11 части 1 статьи 31
          Федерального закона № 44-ФЗ.
        </P>
      </>
    ),
    account: (
      <>
        <H>Реквизиты счёта для оплаты по контракту</H>
        <P>
          {field('bank')}, БИК {field('bik')}, расчётный счёт {field('account')}.
        </P>
      </>
    ),
    cert: (
      <>
        <H>Сертификат соответствия на МФУ (поз. 3)</H>
        <P>Приложенный файл: {value(fixes, 'cert-poz3', 'не приложен')}.</P>
      </>
    ),
    registry: (
      <>
        <H>Номера реестровых записей товара</H>
        <P>Поз. 1, 2 — номера из прайса поставщика. Поз. 3, 4 — {value(fixes, 'registry', 'не указаны')}.</P>
      </>
    ),
  };

  return <div className="space-y-3">{bodies[id] ?? <P>Предпросмотр недоступен.</P>}</div>;
}

const fileName = (title: string, ext: string) =>
  `${title
    .replace(/[^а-яё\s]/gi, '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .slice(0, 4)
    .join('_')}.${ext.toLowerCase()}`;

export function StepPackage({
  app,
  patch,
  onBack,
  onFixGap,
  onSendToExpert,
  credits,
  onUseCredit,
  onTariffs,
}: {
  app: AppState;
  patch: Patch;
  onBack: () => void;
  onFixGap: (gapId: string) => void;
  onSendToExpert: () => void;
  // Заявок на балансе из купленного пакета и переход к тарифам.
  credits: number;
  onUseCredit: () => void;
  onTariffs: () => void;
}) {
  const fixes = app.fixes;
  const [format, setFormat] = useState('DOCX');
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<{ id: string; title: string } | null>(null);
  const [redo, setRedo] = useState<'idle' | 'confirm' | 'running'>('idle');
  const [payBoth, setPayBoth] = useState(false);
  const specialist = app.specialist;

  const final = completeness(fixes);
  const openCount = openGaps(fixes).length;
  const files = requiredDocs.filter((d) => d.file);

  const download = (ids: string[]) => app.paid && setDownloaded((p) => ({ ...p, ...Object.fromEntries(ids.map((id) => [id, true])) }));

  // Новая версия документов. После третьей — только с подтверждением: генерация — самое дорогое действие ИИ.
  const regenerate = (confirmed = false) => {
    if (app.generation >= GENERATIONS && !confirmed) {
      setRedo('confirm');
      return;
    }
    setRedo('running');
    window.setTimeout(() => {
      patch((a) => ({ generation: a.generation + 1 }));
      setRedo('idle');
    }, 1000);
  };

  return (
    <div className="animate-fade-up space-y-5">
      <div>
        <div className="flex items-center gap-2">
          {final.ready ? <ShieldCheck className="size-5 text-success" /> : <AlertTriangle className="size-5 text-warn" />}
          <h1 className="text-2xl font-semibold tracking-tight">{final.ready ? 'Пакет документов готов' : 'Пакет почти готов'}</h1>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Скачайте документы по отдельности или всем пакетом, а при желании — отправьте на проверку живому специалисту.
        </p>
      </div>

      {openCount > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-warn/40 bg-warn-surface/30 p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
            <div>
              <p className="text-sm font-medium">Осталось незакрытых пунктов: {openCount}</p>
              <p className="text-[13px] text-muted-foreground">
                Скачать можно и так, но риск отклонения выше. В файлах незаполненное — жёлтым.
              </p>
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => onFixGap(openGaps(fixes)[0].id)}>
            Вернуться к проверке
          </Button>
        </Card>
      )}

      <FinalCheck final={final} />

      {/* Оплата заявки */}
      {!app.paid ? (
        <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary">
              <CreditCard className="size-4" />
            </span>
            <div>
              <p className="text-sm font-medium">Заявка под ключ · {rub(PRICE_APP)}</p>
              <p className="text-[13px] text-muted-foreground">
                Скачивание откроется после оплаты. Предпросмотр — бесплатно. Правки и проверки полей внутри заявки — без
                доплат.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {credits > 0 ? (
              <Button onClick={onUseCredit}>
                <Wallet className="size-4" /> Списать заявку из пакета · осталось {credits}
              </Button>
            ) : (
              <>
                <Button onClick={() => patch({ paid: true })}>
                  <CreditCard className="size-4" /> Оплатить {rub(PRICE_APP)}
                </Button>
                <Button variant="ghost" size="sm" onClick={onTariffs}>
                  Пакет 5 или 10 заявок — дешевле
                </Button>
              </>
            )}
          </div>
        </Card>
      ) : (
        <p className="flex items-center gap-2 text-[13px] text-success">
          <Check className="size-4" /> {app.fromPackage ? 'Заявка оплачена из пакета' : `Заявка оплачена · ${rub(PRICE_APP)}`}
          <span className="text-muted-foreground">· в прототипе без реальных денег</span>
        </p>
      )}

      {/* Формат */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Формат:</span>
        {exportFormats.map((f) => (
          <Tooltip key={f.ext} content={f.soon ? `${f.label} — скоро.` : f.label} side="bottom">
            <button
              onClick={() => !f.soon && setFormat(f.ext)}
              disabled={f.soon}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                format === f.ext
                  ? 'border-foreground bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              {f.ext}
              {f.soon && <Soon />}
            </button>
          </Tooltip>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* Состав пакета */}
        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <span className="text-sm font-medium">Состав пакета · {files.length} док.</span>
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">версия документов {app.generation}</p>
            </div>
            <Tooltip content={app.paid ? `Все документы в ${format} одним архивом.` : 'Откроется после оплаты заявки.'} align="end">
              <Button size="sm" disabled={!app.paid} onClick={() => download(files.map((d) => d.id))}>
                {app.paid ? <Archive className="size-3.5" /> : <Lock className="size-3.5" />} Всё архивом · ZIP
              </Button>
            </Tooltip>
          </div>
          <div>
            {files.map((d) => {
              const status = docStatus(d, fixes);
              return (
                <div key={d.id} className="group flex items-center gap-3 border-b border-border px-4 py-3 last:border-0">
                  <button
                    onClick={() => setPreview({ id: d.id, title: d.title })}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <FileText className={cx('size-4 shrink-0', status === 'ok' ? 'text-muted-foreground' : 'text-warn')} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium group-hover:underline">{d.title}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {d.id === 'cert'
                          ? (fixes['cert-poz3'] ?? 'не приложен — загрузите на шаге «Проверка»')
                          : fileName(d.title, format)}
                        {status !== 'ok' && d.id !== 'cert' && <span className="text-warn-foreground"> · есть жёлтые места</span>}
                      </p>
                    </div>
                  </button>
                  <IconButton label="Предпросмотр" onClick={() => setPreview({ id: d.id, title: d.title })}>
                    <Eye className="size-4" />
                  </IconButton>
                  {downloaded[d.id] ? (
                    <Badge tone="success">
                      <Check className="size-2.5" /> скачано
                    </Badge>
                  ) : (
                    <IconButton
                      label={app.paid ? `Скачать ${format}` : 'Откроется после оплаты'}
                      align="end"
                      onClick={() => download([d.id])}
                      className={cx(!app.paid && 'cursor-not-allowed opacity-50')}
                    >
                      {app.paid ? <Download className="size-4" /> : <Lock className="size-4" />}
                    </IconButton>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* Проверка специалистом */}
        <Card className="flex flex-col p-5">
          <div className="flex items-center gap-2">
            <UserCheck className="size-4" />
            <span className="text-sm font-medium">Проверка специалистом</span>
            <HelpTip content="Живой тендерный юрист вручную сверит пакет с извещением и даст письменное заключение." align="end" />
          </div>
          <p className="mt-2 text-[13px] leading-snug text-muted-foreground">
            Пакет проверил ИИ. Тендерный юрист вручную сверит документы с извещением и даст заключение перед подачей.
          </p>
          <ul className="mt-3 space-y-1.5 text-[13px]">
            {['Ручная сверка с извещением', 'То, чего не видит ИИ: сроки, подписи, формы', 'Заключение за 2 часа'].map((t) => (
              <li key={t} className="flex items-center gap-2 text-muted-foreground">
                <Check className="size-3.5 text-success" /> {t}
              </li>
            ))}
          </ul>

          <div className="mt-auto pt-4">
            {specialist?.status === 'replied' ? (
              <div className="space-y-2.5 rounded-md border border-success/30 bg-success/10 p-3 text-[13px]">
                <p className="flex items-center gap-1.5 font-medium text-success">
                  <Bell className="size-3.5" /> Специалист проверил пакет
                </p>
                <ul className="space-y-1.5 text-[12px]">
                  {specialist.remarks.map((r) => (
                    <li key={r.text} className="flex items-start gap-2">
                      <span
                        className={cx(
                          'mt-0.5 shrink-0 font-semibold',
                          r.tone === 'ok' ? 'text-success' : r.tone === 'danger' ? 'text-danger' : 'text-warn-foreground',
                        )}
                      >
                        {r.tone === 'ok' ? '✓' : r.tone === 'danger' ? '✗' : '!'}
                      </span>
                      <span className="min-w-0 flex-1 text-muted-foreground">{r.text}</span>
                      {r.gapId && r.tone !== 'ok' && (
                        <button onClick={() => onFixGap(r.gapId!)} className="shrink-0 font-medium text-foreground underline underline-offset-2">
                          Исправить
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="text-[12px] font-medium text-foreground">{expertConclusion(specialist.remarks)}</p>
              </div>
            ) : specialist?.status === 'sent' ? (
              <div className="rounded-md border border-warn/30 bg-warn-surface/30 p-3 text-[13px]">
                <p className="flex items-center gap-1.5 font-medium text-warn-foreground">
                  <Clock className="size-3.5" /> Отправлено на проверку
                </p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Ответ придёт в течение 2 часов — уведомим здесь, в шапке закупки, в списке закупок и в чате. В прототипе —
                  через 6 секунд.
                </p>
              </div>
            ) : payBoth ? (
              <div className="space-y-2.5 rounded-md border border-border bg-secondary/40 p-3 text-[13px]">
                {credits > 0 ? (
                  <p>
                    Проверка — к оплаченной заявке: спишем 1 заявку из пакета (осталось {credits}) и{' '}
                    <b className="font-mono">{rub(PRICE_EXPERT)}</b> за проверку.
                  </p>
                ) : (
                  <p>
                    Проверка — к оплаченной заявке: {rub(PRICE_APP)} + {rub(PRICE_EXPERT)} ={' '}
                    <b className="font-mono">{rub(PRICE_APP + PRICE_EXPERT)}</b>.
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="accent"
                    size="sm"
                    onClick={() => {
                      if (credits > 0) onUseCredit();
                      onSendToExpert();
                    }}
                  >
                    Оплатить {rub(credits > 0 ? PRICE_EXPERT : PRICE_APP + PRICE_EXPERT)}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setPayBoth(false)}>
                    Отмена
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-xs text-muted-foreground">Разовая услуга</span>
                  <span className="font-mono text-xl font-semibold">{rub(PRICE_EXPERT)}</span>
                </div>
                <Button variant="accent" className="h-10 w-full" onClick={() => (app.paid ? onSendToExpert() : setPayBoth(true))}>
                  <UserCheck className="size-4" /> Отправить специалисту · {rub(PRICE_EXPERT)}
                </Button>
              </>
            )}
          </div>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack}>
          ← Назад
        </Button>
        <AIDisclaimer className="text-right" />
      </div>

      <Modal
        open={!!preview}
        onClose={() => {
          setPreview(null);
          setRedo('idle');
        }}
        title={preview?.title}
        subtitle={`${tender.customer} · закупка №${tender.id} · версия ${app.generation}`}
        footer={
          redo === 'confirm' ? (
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
              <p className="flex-1 text-[12px] text-muted-foreground">
                Заявка уже была успешно сформирована. Для повторной генерации измените данные или подтвердите
                необходимость новой генерации.
              </p>
              <div className="flex shrink-0 gap-2">
                <Button variant="secondary" size="sm" onClick={() => setRedo('idle')}>
                  Отмена
                </Button>
                <Button size="sm" onClick={() => regenerate(true)}>
                  Подтвердить
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Tooltip
                content={`ИИ составит документы заново. Первые ${GENERATIONS} версии — сразу, дальше — с подтверждением.`}
                align="start"
              >
                <Button variant="ghost" size="sm" disabled={redo === 'running'} onClick={() => regenerate()}>
                  {redo === 'running' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                  Составить заново
                </Button>
              </Tooltip>
              <Button variant="secondary" size="sm" onClick={() => setPreview(null)}>
                Закрыть
              </Button>
              <Tooltip content={app.paid ? `Скачать ${format}` : 'Откроется после оплаты заявки.'} align="end">
                <Button
                  size="sm"
                  disabled={!app.paid}
                  onClick={() => {
                    if (preview) download([preview.id]);
                    setPreview(null);
                  }}
                >
                  {app.paid ? <Download className="size-3.5" /> : <Lock className="size-3.5" />} Скачать {format}
                </Button>
              </Tooltip>
            </>
          )
        }
      >
        <div className="bg-secondary/30 p-6">
          <div className="mx-auto max-w-lg rounded-md border border-border bg-card p-8 shadow-sm">
            <div className="mb-5 border-b border-border pb-4 text-center">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Электронная подача · {tender.law}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">{tender.customer}</p>
            </div>
            {redo === 'running' ? (
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> ИИ составляет документ заново…
              </p>
            ) : (
              preview && <DocumentBody id={preview.id} fixes={fixes} />
            )}
            <div className="mt-6 flex items-center justify-between border-t border-border pt-4 text-[11px] text-muted-foreground">
              <span>{company.name}</span>
              <span className="font-mono">подпись — на площадке</span>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
