import { useEffect, useRef, useState } from 'react';
import { Search, Plus, Calendar, FileText, ChevronRight, Trash2 } from '../lib/icons';
import { Button, Card, Badge, Modal, AIDisclaimer, Tooltip, IconButton, cx } from './ui';
import { SectionIcon } from './SectionIcon';
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

  // Числа — прямо на кнопках-фильтрах (отдельной полосы счётчиков с теми же видами больше нет); виды без закупок не показываем.
  const countOf = (id: TenderStatus | 'all') => (id === 'all' ? tenders.length : stat(id));
  const visibleFilters = filters.filter((f) => f.id === 'all' || f.id === filter || countOf(f.id) > 0);

  return (
    <div className="animate-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><SectionIcon name="cart" className="size-8" />Мои закупки</h1>
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

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-md border border-border bg-card px-3 hover:border-foreground/30 focus-within:border-foreground focus-within:ring-2 focus-within:ring-ring/20 focus-within:ring-inset">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Название, заказчик или №"
            aria-label="Поиск по моим закупкам"
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {visibleFilters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors ${
                filter === f.id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              {f.label}
              <span className="font-mono tabular-nums opacity-80">{countOf(f.id)}</span>
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
            <Card key={t.id} className="card-hover group transition-colors hover:border-foreground/25">
              <div className="flex w-full items-center gap-2 p-4">
                <div className="min-w-0 flex-1">
                  <button onClick={() => onOpen(t.id)} className="block w-full min-w-0 text-left">
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
                      <span className="font-mono text-[11px] text-muted-foreground">{t.law}</span>
                    </div>
                    {/* Цена — сразу после названия и крупнее остального текста (владелец, 29.10.2026: «цена должна быть рядом с названием и побольше») */}
                    <div className="mt-2 flex items-start justify-between gap-x-4 gap-y-0.5">
                      <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{t.title}</p>
                      <Tooltip content="НМЦК — начальная (максимальная) цена контракта. Выше неё цену предложить нельзя." align="start">
                        <span className={cx('shrink-0 text-right font-mono tabular-nums', t.nmck ? 'text-lg font-bold text-foreground' : 'text-[13px] text-muted-foreground')}>{t.nmck ? rub(t.nmck) : 'цена не указана'}</span>
                      </Tooltip>
                    </div>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{t.customer}</p>

                    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
                      <span
                        className={cx(
                          'inline-flex items-center gap-1',
                          t.dueTone === 'danger' && 'font-medium text-danger',
                          t.dueTone === 'warn' && 'font-medium text-warn-foreground',
                        )}
                      >
                        <Calendar className="size-3.5" />
                        {!t.deadline
                          ? 'срок не найден'
                          : t.dueTone === 'danger'
                            ? `приём заявок закончился ${t.deadline}`
                            : `до ${t.deadline}${t.dueLeft ? ` · ${t.dueLeft}` : ''}`}
                      </span>
                      {t.docsLoaded < t.docsTotal && (
                        <Tooltip content="Часть файлов не прочиталась: откройте закупку на шаге «Загрузка» и добавьте их заново.">
                          <span className="inline-flex items-center gap-1 font-medium text-warn-foreground">
                            <FileText className="size-3.5" /> прочитано {t.docsLoaded} из {t.docsTotal}
                          </span>
                        </Tooltip>
                      )}
                    </div>
                  </button>

                  {/* Внизу: прогресс слева, напротив него — «Отметить поданной» и «Удалить» (при наведении) */}
                  <div className="mt-3 flex items-center gap-3">
                    <Tooltip content="Готовность заявки: доля заполненных и подтверждённых полей." side="bottom" align="start" className="flex min-w-0 flex-1">
                      <div className="flex w-full items-center gap-3">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                          <div className={cx('h-full rounded-full transition-all', progress >= 100 ? 'bg-success' : 'bg-foreground')} style={{ width: `${progress}%` }} />
                        </div>
                        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{progress}%</span>
                      </div>
                    </Tooltip>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => onToggleSubmitted(t.id)}
                        className="inline-flex min-h-7 shrink-0 items-center text-[12px] text-muted-foreground underline underline-offset-4 hover:text-foreground"
                      >
                        {t.status === 'submitted' ? 'Снять отметку «Подана»' : 'Отметить поданной'}
                      </button>
                      <IconButton
                        label="Удалить закупку"
                        tone="danger"
                        align="end"
                        onClick={() => setDeleteTarget(t)}
                        className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="size-4" />
                      </IconButton>
                    </div>
                  </div>
                </div>
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
