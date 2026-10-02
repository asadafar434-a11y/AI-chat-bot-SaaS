import { useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Sparkles, ChevronRight, Info } from '../lib/icons';
import { Button, Card, Badge, Dot, Tooltip } from './ui';
import type { CheckStatus } from '../lib/data';
import { RequirementsList, type RequirementRowView } from './RequirementsList';

const statusMeta: Record<
  CheckStatus,
  { icon: typeof CheckCircle2; tone: 'success' | 'warn' | 'danger'; label: string }
> = {
  ok: { icon: CheckCircle2, tone: 'success', label: 'Готово' },
  warn: { icon: AlertTriangle, tone: 'warn', label: 'Требует внимания' },
  missing: { icon: XCircle, tone: 'danger', label: 'Отсутствует' },
};

// Строка «Что подать»: пункт из документов закупки и как его выполнить. Вид — как в прототипе, данные — настоящие:
// план выполнения требований считает приложение (web/src/lib/fulfillment.ts).
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

export function StepAnalysis({
  rows,
  requirements = [],
  kindText,
  fromPlatform,
  hidden,
  onNext,
  onBack,
  onFix,
}: {
  rows: AnalysisRow[];
  // Все требования заказчика со сроком, числами, обязательностью, проверкой и предложением участника.
  requirements?: RequirementRowView[];
  // «на электронный аукцион» — способ закупки для описания; пусто, если не определён.
  kindText: string;
  // 44-ФЗ, электронная процедура: сведения об участнике передаёт площадка.
  fromPlatform: boolean;
  // Сколько пунктов для этой заявки не требуется — в список не входят.
  hidden: number;
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Анализ комплекта</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          ИИ сверил извещение и ТЗ с составом заявки{kindText ? ` на ${kindText}` : ''}. Сверху — то, без чего заявку
          отклонят, ниже — что требует внимания, готовое — в конце. Нажмите на строку, чтобы увидеть, что не так и
          где это исправить.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {(
          [
            ['danger', counts.missing ?? 0, 'Не хватает', 'Документа нет в загруженных файлах — без него заявку отклонят.'],
            ['warn', counts.warn ?? 0, 'Внимание', 'Документ есть, но нужно что-то дописать или подтвердить.'],
            ['success', counts.ok ?? 0, 'Готово', 'Составлено и заполнено — войдёт в пакет как есть.'],
          ] as const
        ).map(([tone, n, label, hint], i) => (
          <Tooltip key={label} content={hint} side="bottom" align={i === 0 ? 'start' : i === 2 ? 'end' : 'center'} className="w-full">
            <Card className="w-full p-4">
              <div className="flex items-center gap-2">
                <Dot tone={tone} />
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{n}</p>
            </Card>
          </Tooltip>
        ))}
      </div>

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
              className={`rounded-lg border bg-card transition-all duration-300 ${expanded ? 'border-foreground/30' : 'border-border'}`}
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
                    {doc.where && (
                      <p className="break-words text-muted-foreground">
                        <span className="font-medium text-foreground">Место в файле: </span>
                        {doc.where}
                      </p>
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

      {fromPlatform && (
        <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Наименование, ИНН и адрес в заявку на аукцион не пишут: по ч. 1 ст. 49 44-ФЗ заявка содержит сведения из пп.
          «м»–«п» п. 1, пп. «а»–«в» п. 2 и п. 5 ч. 1 ст. 43, остальное площадка передаёт сама.
        </p>
      )}

      <RequirementsList rows={requirements} onFix={() => onFix('review')} />

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← Назад
        </Button>
        <Button onClick={onNext}>Дальше: цена →</Button>
      </div>
    </div>
  );
}
