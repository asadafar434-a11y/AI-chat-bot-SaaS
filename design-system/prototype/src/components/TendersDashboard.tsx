import { useEffect, useRef, useState } from 'react';
import { Search, Plus, Calendar, FileText, ChevronRight, Trash2, Clock, Bell } from '../lib/icons';
import { Button, Card, Badge, Modal, AIDisclaimer, Tooltip, IconButton } from './ui';
import { statusLabels, procedureMeta, rub, type TenderCard, type TenderStatus } from '../lib/data';

const filters: { id: TenderStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'draft', label: 'Черновики' },
  { id: 'progress', label: 'В работе' },
  { id: 'ready', label: 'Готовы' },
  { id: 'submitted', label: 'Поданы' },
];

export function TendersDashboard({
  tenders,
  onOpen,
  onNew,
  onDelete,
  onToggleSubmitted,
  onOpenSample,
}: {
  tenders: TenderCard[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onToggleSubmitted: (id: string) => void;
  // Готовый пример закупки — пройти все шаги без своих документов и без запросов к ИИ.
  onOpenSample?: () => void;
}) {
  const [filter, setFilter] = useState<TenderStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TenderCard | null>(null);

  const list = tenders.filter(
    (t) =>
      (filter === 'all' || t.status === filter) &&
      (t.title.toLowerCase().includes(query.toLowerCase()) ||
        t.customer.toLowerCase().includes(query.toLowerCase())),
  );

  const stat = (s: TenderStatus) => tenders.filter((t) => t.status === s).length;

  // Удалённая строка уносит фокус с собой: после удаления он переходит в основной блок, а не в начало страницы.
  const countBeforeDelete = useRef<number | null>(null);
  useEffect(() => {
    if (countBeforeDelete.current === null || tenders.length >= countBeforeDelete.current) return;
    countBeforeDelete.current = null;
    document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true });
  }, [tenders.length]);

  const confirmDelete = () => {
    if (!deleteTarget) return;
    countBeforeDelete.current = tenders.length;
    onDelete(deleteTarget.id);
    setDeleteTarget(null);
  };

  const summary: [string, number, string, string][] = [
    ['Всего', tenders.length, 'text-foreground', 'Все закупки, которые вы добавили.'],
    ['В работе', stat('progress') + stat('draft'), 'text-warn-foreground', 'Черновики и заявки, где осталось что-то заполнить.'],
    ['Готовы', stat('ready'), 'text-success', 'Пустых обязательных полей нет — осталось подписать и подать.'],
    ['Поданы', stat('submitted'), 'text-muted-foreground', 'Заявки, поданные на площадке.'],
  ];

  return (
    <div className="animate-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Мои закупки</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Загрузите документацию — ИИ проведёт до готового пакета.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onOpenSample && !tenders.some((t) => t.sample) && (
            <Tooltip content="Готовая закупка с документами: пройдите все шаги, не загружая своё. Запросов к ИИ нет." align="end">
              <Button variant="secondary" onClick={onOpenSample}>
                Посмотреть на примере
              </Button>
            </Tooltip>
          )}
          <Button onClick={onNew}>
            <Plus className="size-4" /> Новая закупка
          </Button>
        </div>
      </div>

      {/* Summary strip */}
      <Card className="flex divide-x divide-border p-0">
        {summary.map(([label, n, color, hint], i) => (
          <Tooltip
            key={label}
            content={hint}
            side="bottom"
            align={i === 0 ? 'start' : i === summary.length - 1 ? 'end' : 'center'}
            className="flex-1"
          >
            <div className="flex w-full cursor-default flex-col items-center gap-0.5 px-2 py-3">
              <span className={`text-lg font-semibold tabular-nums leading-none ${color}`}>{n}</span>
              <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
            </div>
          </Tooltip>
        ))}
      </Card>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-md border border-border bg-card px-3 focus-within:border-foreground focus-within:ring-2 focus-within:ring-ring/20">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по названию, заказчику или № закупки"
            aria-label="Поиск по моим закупкам"
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === f.id
                  ? 'border-foreground bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="space-y-2.5">
        {list.map((t) => {
          const st = statusLabels[t.status];
          const progress = t.progress;
          return (
            <Card key={t.id} className="group transition-colors hover:border-foreground/25">
              <div className="flex w-full items-center gap-2 p-4">
                <button onClick={() => onOpen(t.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Tooltip content={st.hint} align="start">
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </Tooltip>
                      <Tooltip content={procedureMeta[t.procedure].hint}>
                        <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground empty:hidden">
                          {t.procedureLabel ?? procedureMeta[t.procedure].label}
                        </span>
                      </Tooltip>
                      {t.sample && <Badge>пример</Badge>}
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {t.law}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-medium leading-snug">{t.title}</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{t.customer}</p>

                    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
                      <Tooltip content="НМЦК — начальная (максимальная) цена контракта. Выше неё цену предложить нельзя." align="start">
                        <span className="font-mono tabular-nums text-foreground">{t.nmck ? rub(t.nmck) : 'цена не указана'}</span>
                      </Tooltip>
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="size-3.5" /> {t.deadline ? `до ${t.deadline}` : 'срок не найден'}
                      </span>
                      <Tooltip content="Сколько документов закупки загружено из тех, что опубликованы на площадке.">
                        <span className="inline-flex items-center gap-1">
                          <FileText className="size-3.5" /> документы {t.docsLoaded}/{t.docsTotal}
                        </span>
                      </Tooltip>
                    </div>

                    <Tooltip
                      content="Готовность заявки: доля заполненных и подтверждённых полей."
                      side="bottom"
                      align="start"
                      className="mt-3 flex w-full"
                    >
                      <div className="flex w-full items-center gap-3">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full rounded-full bg-foreground transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{progress}%</span>
                      </div>
                    </Tooltip>
                  </div>
                </button>

                {/* Удалить — при наведении на карточку; шеврон — по центру справа */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSubmitted(t.id);
                  }}
                  className="hidden shrink-0 text-[12px] text-muted-foreground underline underline-offset-4 hover:text-foreground sm:block"
                >
                  {t.status === 'submitted' ? 'Снять отметку «Подана»' : 'Отметить поданной'}
                </button>
                <IconButton
                  label="Удалить закупку"
                  tone="danger"
                  align="end"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(t);
                  }}
                  className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-4" />
                </IconButton>
                <button
                  onClick={() => onOpen(t.id)}
                  aria-label="Открыть закупку"
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <ChevronRight className="size-5 transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>
            </Card>
          );
        })}

        {list.length === 0 && (
          <Card className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm text-muted-foreground">
              {tenders.length === 0
                ? 'Закупок пока нет. Загрузите документы — ИИ выпишет требования и сроки и проведёт до готового пакета.'
                : 'По вашему запросу ничего не найдено.'}
            </p>
            <Button variant="secondary" size="sm" onClick={onNew}>
              <Plus className="size-4" /> {tenders.length === 0 ? 'Новая закупка' : 'Добавить закупку'}
            </Button>
          </Card>
        )}
      </div>

      <AIDisclaimer />

      {/* Delete confirmation dialog */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Удалить закупку?"
        subtitle={deleteTarget?.title}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)}>
              Отмена
            </Button>
            <Button size="sm" variant="danger" onClick={confirmDelete}>
              <Trash2 className="size-3.5" /> Удалить
            </Button>
          </>
        }
      >
        <div className="px-5 py-6">
          <p className="text-[13px] text-muted-foreground">
            Закупка «<span className="font-medium text-foreground">{deleteTarget?.title}</span>» будет удалена из
            списка. Это действие нельзя отменить.
          </p>
        </div>
      </Modal>
    </div>
  );
}
