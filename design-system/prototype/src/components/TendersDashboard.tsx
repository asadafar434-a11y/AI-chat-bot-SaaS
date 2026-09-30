import { useState } from 'react';
import { Search, Plus, Calendar, FileText, ChevronRight, Trash2, Clock, Bell } from '../lib/icons';
import { Button, Card, Badge, Modal, AIDisclaimer, Tooltip, IconButton } from './ui';
import { myTenders as initialTenders, statusLabels, procedureMeta, rub, type TenderCard, type TenderStatus } from '../lib/data';
import type { AppState } from '../lib/app-state';

const filters: { id: TenderStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'draft', label: 'Черновики' },
  { id: 'progress', label: 'В работе' },
  { id: 'ready', label: 'Готовы' },
  { id: 'submitted', label: 'Поданы' },
];

export function TendersDashboard({
  onOpen,
  onNew,
  apps,
  progressOf,
}: {
  onOpen: (id: string) => void;
  onNew: () => void;
  apps: Record<string, AppState>;
  progressOf: (id: string) => number;
}) {
  const [filter, setFilter] = useState<TenderStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [tenders, setTenders] = useState<TenderCard[]>(initialTenders);
  const [deleteTarget, setDeleteTarget] = useState<TenderCard | null>(null);

  const list = tenders.filter(
    (t) =>
      (filter === 'all' || t.status === filter) &&
      (t.title.toLowerCase().includes(query.toLowerCase()) ||
        t.customer.toLowerCase().includes(query.toLowerCase()) ||
        t.id.includes(query)),
  );

  const stat = (s: TenderStatus) => tenders.filter((t) => t.status === s).length;

  const confirmDelete = () => {
    if (!deleteTarget) return;
    setTenders((prev) => prev.filter((t) => t.id !== deleteTarget.id));
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
        <Button onClick={onNew}>
          <Plus className="size-4" /> Новая закупка
        </Button>
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
        <div className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-md border border-border bg-card px-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по названию, заказчику или № закупки"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
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
          const expert = apps[t.id]?.specialist;
          const progress = t.status === 'progress' ? progressOf(t.id) : t.progress;
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
                        <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground">
                          {procedureMeta[t.procedure].label}
                        </span>
                      </Tooltip>
                      {expert && (
                        <Badge tone={expert.status === 'replied' ? 'success' : 'warn'}>
                          {expert.status === 'replied' ? <Bell className="size-3" /> : <Clock className="size-3" />}
                          {expert.status === 'replied' ? 'Ответ специалиста' : 'У специалиста'}
                          {expert.status === 'replied' && !expert.read && (
                            <span className="ml-0.5 size-1.5 rounded-full bg-danger" />
                          )}
                        </Badge>
                      )}
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {t.law} · №{t.id}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-medium leading-snug">{t.title}</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{t.customer}</p>

                    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
                      <Tooltip content="НМЦК — начальная (максимальная) цена контракта. Выше неё цену предложить нельзя." align="start">
                        <span className="font-mono tabular-nums text-foreground">{rub(t.nmck)}</span>
                      </Tooltip>
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="size-3.5" /> до {t.deadline}
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
            <p className="text-sm text-muted-foreground">По вашему запросу ничего не найдено.</p>
            <Button variant="secondary" size="sm" onClick={onNew}>
              <Plus className="size-4" /> Добавить закупку
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
