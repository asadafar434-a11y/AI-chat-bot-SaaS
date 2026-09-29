import { useState } from 'react';
import {
  FileText,
  Download,
  Package,
  UserCheck,
  Check,
  ShieldCheck,
  Clock,
  AlertTriangle,
  Eye,
  Bell,
} from '../lib/icons';
import { Button, Card, Badge, Modal, AIDisclaimer, HelpTip } from './ui';
import { requiredDocs, exportFormats, gaps, tender, rub } from '../lib/data';
import type { Fixes } from '../App';

type PreviewDoc = { id: string; title: string };

function DocumentBody({ id, fixes }: { id: string; fixes: Fixes }) {
  const P = ({ children }: { children: React.ReactNode }) => (
    <p className="text-[13px] leading-relaxed text-foreground">{children}</p>
  );
  const H = ({ children }: { children: React.ReactNode }) => (
    <p className="text-sm font-semibold">{children}</p>
  );

  const bodies: Record<string, React.ReactNode> = {
    'zayavka-1': (
      <>
        <H>Заявка на участие в электронном аукционе — часть 1</H>
        <P>
          Изучив извещение и документацию о закупке №{tender.id}, ООО «ТехСнаб» выражает согласие
          осуществить поставку товара на условиях, предусмотренных техническим заданием и проектом
          контракта.
        </P>
        <P>Наименование объекта закупки: {tender.title}.</P>
        <P>Согласие дано без каких-либо оговорок и в полном объёме требований ТЗ.</P>
      </>
    ),
    'zayavka-2': (
      <>
        <H>Заявка на участие — часть 2 (сведения об участнике)</H>
        <P>Участник: ООО «ТехСнаб», ИНН 7701234567, ОГРН 1157746000000.</P>
        <P>
          Конкретные показатели товара: накопитель ноутбука —{' '}
          <b>{fixes['poz2-storage'] ?? '—'}</b>; скорость печати МФУ —{' '}
          <b>{fixes['poz5-speed'] ?? '—'}</b>; выходная мощность ИБП —{' '}
          <b>{fixes['poz9-power'] ?? '—'}</b>.
        </P>
        <P>Все характеристики соответствуют требованиям технического задания.</P>
      </>
    ),
    'decl-smsp': (
      <>
        <H>Декларация о принадлежности к субъектам МСП</H>
        <P>
          Настоящим ООО «ТехСнаб» декларирует принадлежность к субъектам малого предпринимательства в
          соответствии с ч. 3 ст. 30 Федерального закона №44-ФЗ.
        </P>
        <P>Сведения подтверждаются Единым реестром субъектов МСП ФНС России.</P>
      </>
    ),
    license: (
      <>
        <H>Сертификат соответствия (приложение)</H>
        <P>Приложенный файл: {fixes['cert-poz7'] ?? 'не приложен'}.</P>
        <P>
          Документ подтверждает соответствие МФУ (поз. 7) требованиям технических регламентов,
          указанным в п. 5 ТЗ.
        </P>
      </>
    ),
    guarantee: (
      <>
        <H>Обеспечение заявки</H>
        <P>Способ обеспечения: {fixes['guarantee'] ?? 'не выбран'}.</P>
        <P>
          Спецсчёт №40702…8814. Сумма обеспечения: {rub(tender.security)} (5% от НМЦК согласно ст. 44
          44-ФЗ).
        </P>
      </>
    ),
    'price-form': (
      <>
        <H>Ценовое предложение</H>
        <P>
          Итоговая цена контракта рассчитана на основе обоснования НМЦК с учётом предложенного
          снижения. Детализация — в приложении «Расчёт цены».
        </P>
        <P>Цена включает НДС, доставку, монтаж и гарантийное обслуживание 24 месяца.</P>
      </>
    ),
  };

  return <div className="space-y-3">{bodies[id] ?? <P>Предпросмотр недоступен.</P>}</div>;
}

function openGapCount(fixes: Fixes) {
  return gaps.filter((g) => {
    const v = fixes[g.id];
    if (!v) return true;
    return g.kind === 'choice' && v === 'Ещё не оформлено';
  }).length;
}

export function StepPackage({
  fixes,
  onBack,
  onReview,
  specialistStatus = 'idle',
  onSpecialistSent,
}: {
  fixes: Fixes;
  onBack: () => void;
  onReview: () => void;
  specialistStatus?: 'idle' | 'sent' | 'replied';
  onSpecialistSent?: () => void;
}) {
  const [format, setFormat] = useState('PDF');
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<PreviewDoc | null>(null);
  const sent = specialistStatus !== 'idle';

  const certFixed = !!fixes['cert-poz7'];
  const openCount = openGapCount(fixes);

  // Пакет: обязательные документы + сертификат, если он загружен на этапе проверки.
  const finalDocs = requiredDocs
    .filter((d) => d.id !== 'license' || certFixed)
    .map((d) =>
      d.id === 'license'
        ? { ...d, status: 'ok' as const, note: fixes['cert-poz7'] }
        : d,
    );

  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <div className="flex items-center gap-2">
          {openCount === 0 ? (
            <ShieldCheck className="size-5 text-success" />
          ) : (
            <AlertTriangle className="size-5 text-warn" />
          )}
          <h1 className="text-2xl font-semibold tracking-tight">
            {openCount === 0 ? 'Пакет документов готов' : 'Пакет почти готов'}
          </h1>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Скачайте документы по отдельности или всем пакетом, а при желании — отправьте на проверку
          живому специалисту.
        </p>
      </div>

      {openCount > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-warn/40 bg-warn-surface/30 p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
            <div>
              <p className="text-sm font-medium">Осталось {openCount} незакрытых пункт(а)</p>
              <p className="text-[13px] text-muted-foreground">
                Можно подать и так, но риск отклонения выше. Рекомендуем закрыть слепые зоны.
              </p>
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={onReview}>
            Вернуться к проверке
          </Button>
        </Card>
      )}

      {/* Format selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          Формат:
        </span>
        {exportFormats.map((f) => (
          <button
            key={f.ext}
            onClick={() => setFormat(f.ext)}
            title={f.label}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              format === f.ext
                ? 'border-foreground bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            {f.ext}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* Document list */}
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-medium">Состав пакета · {finalDocs.length} док.</span>
            <Button
              size="sm"
              onClick={() => setDownloaded(Object.fromEntries(finalDocs.map((d) => [d.id, true])))}
            >
              <Package className="size-3.5" /> Скачать всё ({format === 'ZIP' ? 'ZIP' : format})
            </Button>
          </div>
          <div>
            {finalDocs.map((d) => (
              <div
                key={d.id}
                className="group flex items-center gap-3 border-b border-border px-4 py-3 last:border-0"
              >
                <button
                  onClick={() => setPreview({ id: d.id, title: d.title })}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  title="Открыть предпросмотр"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium group-hover:underline">{d.title}</p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {d.id === 'license'
                        ? d.note
                        : `${d.title
                            .replace(/[^а-яё\s]/gi, '')
                            .trim()
                            .toLowerCase()
                            .replace(/\s+/g, '_')}.${format === 'ZIP' ? 'pdf' : format.toLowerCase()}`}
                    </p>
                  </div>
                </button>
                <button
                  onClick={() => setPreview({ id: d.id, title: d.title })}
                  className="rounded p-1.5 text-muted-foreground opacity-0 transition-all hover:bg-secondary hover:text-foreground group-hover:opacity-100"
                  title="Предпросмотр"
                >
                  <Eye className="size-4" />
                </button>
                {downloaded[d.id] ? (
                  <Badge tone="success">
                    <Check className="size-2.5" /> скачано
                  </Badge>
                ) : (
                  <button
                    onClick={() => setDownloaded((p) => ({ ...p, [d.id]: true }))}
                    className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    title="Скачать файл"
                  >
                    <Download className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* Specialist review */}
        <Card className={`flex flex-col p-5 ${sent ? '' : 'ring-1 ring-foreground/5'}`}>
          <div className="flex items-center gap-2">
            <UserCheck className="size-4" />
            <span className="text-sm font-medium">Проверка специалистом</span>
          </div>
          <p className="mt-2 text-[13px] leading-snug text-muted-foreground">
            Пакет проверил ИИ. Тендерный юрист вручную сверит документы с извещением и даст
            заключение перед подачей.
          </p>
          <ul className="mt-3 space-y-1.5 text-[13px]">
            {['Ручная сверка с извещением', 'Проверка антидемпинговых рисков', 'Заключение за 2 часа'].map(
              (t) => (
                <li key={t} className="flex items-center gap-2 text-muted-foreground">
                  <Check className="size-3.5 text-success" /> {t}
                </li>
              ),
            )}
          </ul>

          <div className="mt-auto pt-4">
            {specialistStatus === 'replied' ? (
              <div className="space-y-2.5 rounded-md border border-success/30 bg-success/8 p-3 text-[13px]">
                <p className="flex items-center gap-1.5 font-medium text-success">
                  <Bell className="size-3.5" /> Специалист проверил пакет
                </p>
                <ul className="space-y-1.5 text-[12px]">
                  {[
                    { ok: true, text: 'Заявка соответствует требованиям извещения' },
                    { ok: null, text: 'Подтвердите блокировку обеспечения до подачи' },
                    { ok: false, text: 'Приложите сертификат на МФУ перед подачей' },
                  ].map(({ ok, text }) => (
                    <li key={text} className="flex items-start gap-2">
                      <span className={`mt-0.5 shrink-0 ${ok === true ? 'text-success' : ok === false ? 'text-danger' : 'text-warn-foreground'}`}>
                        {ok === true ? '✓' : ok === false ? '✗' : '!'}
                      </span>
                      <span className="text-muted-foreground">{text}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-muted-foreground">
                  Заключение: заявка может быть подана после устранения замечаний.
                </p>
              </div>
            ) : specialistStatus === 'sent' ? (
              <div className="rounded-md border border-warn/30 bg-warn-surface/20 p-3 text-[13px]">
                <p className="flex items-center gap-1.5 font-medium text-warn-foreground">
                  <Clock className="size-3.5" /> Отправлено на проверку
                </p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Ответ придёт в течение 2 часов. Уведомление появится на боковой панели.
                </p>
              </div>
            ) : (
              <>
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    Разовая услуга
                    <HelpTip content="Живой тендерный юрист вручную сверит пакет с извещением и даст письменное заключение." />
                  </span>
                  <span className="font-mono text-xl font-semibold">{rub(500)}</span>
                </div>
                <Button variant="warn" className="w-full" onClick={() => onSpecialistSent?.()}>
                  Отправить специалисту · {rub(500)}
                </Button>
              </>
            )}
          </div>
        </Card>
      </div>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← Назад
        </Button>
        <AIDisclaimer />
      </div>

      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title={preview?.title}
        subtitle={`${tender.customer} · закупка №${tender.id}`}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setPreview(null)}>
              Закрыть
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (preview) setDownloaded((p) => ({ ...p, [preview.id]: true }));
                setPreview(null);
              }}
            >
              <Download className="size-3.5" /> Скачать {format}
            </Button>
          </>
        }
      >
        <div className="bg-secondary/30 p-6">
          {/* Sheet-like document */}
          <div className="mx-auto max-w-lg rounded-md border border-border bg-card p-8 shadow-sm">
            <div className="mb-5 border-b border-border pb-4 text-center">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Электронная подача · {tender.law}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">{tender.customer}</p>
            </div>
            {preview && <DocumentBody id={preview.id} fixes={fixes} />}
            <div className="mt-6 flex items-center justify-between border-t border-border pt-4 text-[11px] text-muted-foreground">
              <span>ООО «ТехСнаб»</span>
              <span className="font-mono">УКЭП · подписано</span>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
