import { useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Sparkles, ChevronRight, Info, Clock, Loader2 } from '../lib/icons';
import { contradictionsSummary, type ContradictionsResult } from '@/lib/contradictions';
import { plural } from '@/lib/plural';
import type { AfterWin } from '@/lib/after-win';
import { Button, Card, Badge, HelpTip, StepActions, Tooltip, cx } from './ui';
import type { CheckStatus } from '../lib/data';
import { RequirementsList, type RequirementRowView } from './RequirementsList';
import { DocSnippetToggle, type DocSnippet } from './StepReview';
import { HiddenRequirementsBlock, type HiddenRequirementsCard } from './HiddenRequirements';

const statusMeta: Record<
  CheckStatus,
  { icon: typeof CheckCircle2; tone: 'success' | 'warn' | 'danger'; label: string }
> = {
  ok: { icon: CheckCircle2, tone: 'success', label: 'Готово' },
  warn: { icon: AlertTriangle, tone: 'warn', label: 'Требует внимания' },
  missing: { icon: XCircle, tone: 'danger', label: 'Отсутствует' },
};

// Закупка загружена без разбора ИИ (например, из «Аналитики»): требований ещё нет. Разбор — платный запрос к ИИ, только по кнопке; после него появляется «Что подать».
export function StepNotAnalyzed({ running, error, onRun, onBack }: { running: boolean; error: string; onRun: () => void; onBack: () => void }) {
  return (
    <div className="animate-fade-up space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Анализ документов</h1>
      <Card className="space-y-4 p-6">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0">
            <p className="text-lg font-bold">ИИ ещё не разбирал эту закупку</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Выпишет требования заказчика — появится «Что подать».</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onRun} disabled={running}>
            {running && <Loader2 className="size-4 animate-spin" />}
            {running ? 'ИИ читает документы…' : 'Анализировать документы'}
          </Button>
          <Badge tone="info">платный запрос ИИ</Badge>
          <Button variant="ghost" onClick={onBack} disabled={running}>
            Назад
          </Button>
        </div>
        {running && <p className="text-[12px] text-muted-foreground">Это может занять минуту.</p>}
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> <span className="min-w-0 break-words">{error}</span>
          </p>
        )}
      </Card>
    </div>
  );
}

// Строка «Что подать»: пункт из документов закупки и как его выполнить. Вид — как в прототипе, данные — настоящие:
// план выполнения требований считает приложение (web/src/lib/fulfillment.ts).
function ContradictionsBlock({ card }: { card: ContradictionsCard }) {
  const { result, stale, running, error, onRun } = card;
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="size-4 shrink-0" /> Противоречия в документах заказчика
          </p>
          <p className="mt-0.5 max-w-[70ch] text-[13px] text-muted-foreground">
            ИИ перечитает все документы и найдёт места, которые противоречат друг другу или оставляют вопрос. Это повод спросить заказчика
            или оспорить требование. Платный запрос к ИИ — только по кнопке.
          </p>
        </div>
        <Button size="sm" variant="ai" busy={running} disabled={running} onClick={onRun}>
          {running ? 'ИИ читает документы…' : result ? 'Проверить заново' : 'Найти противоречия'}
        </Button>
      </div>
      {running && <p className="text-[12px] text-muted-foreground">Это занимает до двух минут.</p>}
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> <span className="min-w-0 break-words">{error}</span>
        </p>
      )}
      {result && (
        <>
          <p className="text-[13px] font-medium">{contradictionsSummary(result)}</p>
          {stale && <p className="text-[12px] text-warn">Документы изменились после проверки — результат мог устареть.</p>}
          <ul className="space-y-3">
            {result.findings.map((f, i) => (
              <li key={`${i}:${f.what}`} className="min-w-0 space-y-1.5 rounded-md border border-border p-3 text-[13px]">
                <p className="flex flex-wrap items-center gap-2">
                  <Badge tone={f.kind === 'conflict' ? 'danger' : 'warn'}>{f.kind === 'conflict' ? 'Противоречие' : 'Неясность'}</Badge>
                  <span className="min-w-0 break-words font-medium">{f.what}</span>
                </p>
                <Quote label={f.firstSource} at={f.firstAt} quote={f.firstQuote} verified={f.firstVerified} />
                {f.secondQuote && <Quote label={f.secondSource} at={f.secondAt} quote={f.secondQuote} verified={f.secondVerified} />}
                {f.ask && (
                  <p className="min-w-0 break-words text-muted-foreground">
                    <b className="font-medium text-foreground">Вопрос заказчику:</b> {f.ask}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function Quote({ label, at, quote, verified }: { label: string; at?: string; quote: string; verified: boolean }) {
  return (
    <div className="min-w-0 break-words rounded bg-secondary/50 px-2.5 py-1.5">
      <p className="font-mono text-[11px] text-muted-foreground">
        {label || 'Документы закупки'}
        {at ? ` · ${at}` : ''}
      </p>
      <p>«{quote}»</p>
      {!verified && <p className="text-[12px] text-warn">Цитата не найдена в документах дословно — сверьте вручную.</p>}
    </div>
  );
}

export type AnalysisRow = {
  id: string;
  title: string;
  // Основание: «пп. «а» п. 2 ч. 1 ст. 43 44-ФЗ» или документация закупки.
  ref: string;
  status: CheckStatus;
  // Что сделать — одной фразой.
  note: string;
  // Документ составляет приложение.
  auto: boolean;
  // Это файл заявки; иначе — требование (подтвердить, обеспечение).
  file: boolean;
  // Где это написано в документах закупки, с точной цитатой.
  source: string;
  quote: string;
  quoteFound: boolean;
  // Где эта цитата в файлах закупки, найденная приложением: файл, страница, таблица, пункт. Нет — не нашлась или карты нет.
  where?: string;
  // Куда перейти, чтобы это сделать: «Проверка» — вписать поля документа, «Пакет» — приложить и отметить готовым.
  fixAt?: 'review' | 'package';
};

// Противоречия внутри документов заказчика: платная проверка по кнопке (web/src/lib/contradictions.ts).
export type ContradictionsCard = {
  result: ContradictionsResult | null;
  // Документы изменились после проверки.
  stale: boolean;
  running: boolean;
  error: string;
  onRun: () => void;
};

export function StepAnalysis({
  contradictions,
  hiddenRequirements,
  discrepancies = [],
  afterWin = null,
  rows,
  requirements = [],
  kindText,
  platformNote,
  hidden,
  snippetOf,
  onNext,
  onBack,
  onFix,
}: {
  // Проверка документов на противоречия; не задана — карточки нет (например, в примере закупки).
  contradictions?: ContradictionsCard;
  // Скрытые требования, неоднозначности и условия допуска; не задана — карточки нет.
  hiddenRequirements?: HiddenRequirementsCard;
  // Расхождения в цене внутри документов заказчика (web/src/lib/doc-discrepancies.ts): повод для запроса разъяснений.
  discrepancies?: string[];
  // Обязанности после заключения договора из его проекта (web/src/lib/after-win.ts); null — в договоре их не нашлось.
  afterWin?: AfterWin | null;
  rows: AnalysisRow[];
  // Все требования заказчика со сроком, числами, обязательностью, проверкой и предложением участника.
  requirements?: RequirementRowView[];
  // «на электронный аукцион» — способ закупки для описания; пусто, если не определён.
  kindText: string;
  // 44-ФЗ, электронная процедура: сведения об участнике передаёт площадка.
  // Пояснение, почему сведений об участнике в заявке нет (зависит от способа закупки); null — не нужно.
  platformNote: string | null;
  // Сколько пунктов для этой заявки не требуется — в список не входят.
  hidden: number;
  // Контекст цитаты в документе: до, сама цитата, после — для кнопки «Показать в тексте».
  snippetOf?: (quote: string) => DocSnippet | undefined;
  onNext: () => void;
  onBack: () => void;
  onFix: (at: 'review' | 'package') => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  // Сначала отсутствующее, потом требующее внимания, готовое — вниз.
  const rank: Record<CheckStatus, number> = { missing: 0, warn: 1, ok: 2 };
  const docs = [...rows].sort((a, b) => rank[a.status] - rank[b.status]);
  const counts = docs.reduce((acc, d) => ((acc[d.status] = (acc[d.status] ?? 0) + 1), acc), {} as Record<CheckStatus, number>);

  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Анализ комплекта</h1>
        <HelpTip
          align="start"
          content={`ИИ сверил извещение и ТЗ с составом заявки${kindText ? ` на ${kindText}` : ''}. Сверху — то, без чего заявку отклонят, ниже — что требует внимания, готовое — в конце. Нажмите на строку, чтобы увидеть, что не так и где это исправить.`}
        />
      </div>

      <Card className="grid grid-cols-3 divide-x divide-border overflow-hidden p-0">
        {(
          [
            ['danger', counts.missing ?? 0, 'Не хватает', XCircle],
            ['warn', counts.warn ?? 0, 'Внимание', AlertTriangle],
            ['success', counts.ok ?? 0, 'Готово', CheckCircle2],
          ] as const
        ).map(([tone, n, label, Icon]) => (
          <div key={label} className="flex items-center gap-2 p-3 sm:gap-2.5 sm:p-4">
            <span
              className={cx(
                'flex size-7 shrink-0 items-center justify-center rounded-full sm:size-8',
                tone === 'danger' ? 'bg-danger/10 text-danger' : tone === 'warn' ? 'bg-warn/15 text-warn-foreground' : 'bg-success/10 text-success',
              )}
            >
              <Icon className="size-3.5 sm:size-4" />
            </span>
            <div className="min-w-0">
              <p
                className={cx(
                  'text-xl font-semibold leading-none tabular-nums',
                  tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn-foreground' : 'text-success',
                )}
              >
                {n}
              </p>
              <p className="mt-1 text-[11px] leading-tight text-muted-foreground sm:text-[12px]">{label}</p>
            </div>
          </div>
        ))}
      </Card>

      <div className="space-y-2">
        {docs.length === 0 && (
          <Card className="p-5 text-sm text-muted-foreground">
            Не нашёл, что подать в заявке. Это обычно в извещении или в требованиях к содержанию заявки — проверьте, что
            документы загружены.
          </Card>
        )}
        {docs.map((doc) => {
          const meta = statusMeta[doc.status];
          const Icon = meta.icon;
          const needsAttention = doc.status !== 'ok';
          const expanded = openId === doc.id;
          return (
            <div
              key={doc.id}
              className={`card-hover rounded-lg border bg-card transition-all duration-300 ${expanded ? 'border-foreground/30' : 'border-border'}`}
            >
              <button
                type="button"
                onClick={() => setOpenId(expanded ? null : doc.id)}
                className="flex w-full items-center gap-3 rounded-lg p-4 text-left transition-colors hover:bg-secondary/40"
              >
                <Icon
                  className={`size-4 shrink-0 self-start mt-0.5 ${
                    meta.tone === 'success' ? 'text-success' : meta.tone === 'warn' ? 'text-warn' : 'text-danger'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-medium">{doc.title}</p>
                    {doc.auto && (
                      <Tooltip content="Документ ИИ составляет сам — из документов закупки, профиля и ваших образцов.">
                        <Badge tone="neutral">
                          <Sparkles className="size-2.5" /> авто
                        </Badge>
                      </Tooltip>
                    )}
                    {!doc.file && (
                      <Tooltip content="Это требование, а не файл заявки: в пакет не входит, но без него заявку не примут.">
                        <Badge tone="neutral">
                          <Info className="size-2.5" /> не файл
                        </Badge>
                      </Tooltip>
                    )}
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{doc.ref}</p>
                  <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{doc.note}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="hidden sm:block">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </div>
                  <ChevronRight
                    className={`size-4 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
                  />
                </div>
              </button>

              {expanded && (
                <div className="animate-fade-up border-t border-border px-4 py-3 pl-11">
                  <div className="space-y-2 text-[13px] leading-snug">
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">Где это написано: </span>
                      {doc.source || 'в документах закупки'}
                      {doc.quote && <> — «{doc.quote}»</>}
                      {!doc.quoteFound && doc.quote && (
                        <span className="text-warn-foreground"> · цитата не найдена в документах дословно — сверьте вручную</span>
                      )}
                    </p>
                    {doc.quote && (
                      <DocSnippetToggle where={doc.where} snippet={snippetOf?.(doc.quote)} />
                    )}
                    <div
                      className={
                        needsAttention
                          ? 'flex flex-wrap items-center justify-between gap-2 rounded-md bg-warn-surface/40 px-2.5 py-2 text-warn-foreground'
                          : 'text-muted-foreground'
                      }
                    >
                      <span className="flex items-start gap-1.5">
                        {needsAttention && <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
                        <span>
                          <span className="font-medium">{needsAttention ? 'Как исправить: ' : 'Действий не требуется. '}</span>
                          {needsAttention ? doc.note : 'Войдёт в итоговый пакет.'}
                        </span>
                      </span>
                      {needsAttention && doc.fixAt && (
                        <Button size="sm" variant="secondary" onClick={() => onFix(doc.fixAt!)}>
                          {doc.fixAt === 'review' ? 'Исправить →' : 'К пакету →'}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hidden > 0 && (
        <p className="text-[12px] text-muted-foreground">
          Для вашей заявки не требуется: {hidden} {hidden === 1 ? 'пункт' : hidden < 5 ? 'пункта' : 'пунктов'} из документов закупки.
        </p>
      )}

      {platformNote && (
        <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {platformNote}
        </p>
      )}

      {discrepancies.length > 0 && (
        <Card className="space-y-2 border-warn/40 bg-warn-surface/30 p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="size-4 shrink-0 text-warn" /> Расхождения в цене в документах заказчика
          </p>
          <p className="text-[13px] text-muted-foreground">Стоит спросить заказчика запросом разъяснений до подачи заявки.</p>
          <ul className="space-y-1 text-[13px]">
            {discrepancies.map((d) => (
              <li key={d} className="min-w-0 break-words">
                {d}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {contradictions && <ContradictionsBlock card={contradictions} />}

      {hiddenRequirements && <HiddenRequirementsBlock card={hiddenRequirements} />}

      {afterWin && (
        <Card className="space-y-2 p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Clock className="size-4 shrink-0" /> Что потребуется после победы
          </p>
          <p className="text-[13px] text-muted-foreground">Из проекта договора: в заявку это не входит, но влияет на решение участвовать.</p>
          <ul className="space-y-1.5 text-[13px]">
            {afterWin.duties.map((d) => {
              // Срок или периодичность выделены в самой фразе договора; нет в тексте (сокращён) — стоят впереди.
              const at = d.text.toLowerCase().indexOf(d.term.toLowerCase());
              return (
                <li key={`${d.clause}:${d.text}`} className="min-w-0 break-words">
                  {d.clause && <span className="font-mono text-[12px] text-muted-foreground">п. {d.clause} · </span>}
                  {at >= 0 ? (
                    <>
                      {d.text.slice(0, at)}
                      <b className="font-medium">{d.text.slice(at, at + d.term.length)}</b>
                      {d.text.slice(at + d.term.length)}
                    </>
                  ) : (
                    <>
                      <b className="font-medium">{d.term}</b> — {d.text}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          {afterWin.more && (
            <p className="text-[12px] text-muted-foreground">
              Ещё {afterWin.more.count} {plural(afterWin.more.count, 'обязанность', 'обязанности', 'обязанностей')} предоставить документы без срока
              {afterWin.more.range ? ` — ${afterWin.more.range}` : ''}.
            </p>
          )}
        </Card>
      )}

      <RequirementsList rows={requirements} onFix={() => onFix('review')} />

      <StepActions className="justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← Назад
        </Button>
        <Button onClick={onNext}>Дальше: цена →</Button>
      </StepActions>
    </div>
  );
}
