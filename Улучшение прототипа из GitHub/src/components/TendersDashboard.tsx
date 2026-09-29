import { useState } from 'react';
import { Search, Plus, Calendar, FileText, ChevronRight, Trash2 } from '../lib/icons';
import { Button, Card, Badge, Modal, AIDisclaimer } from './ui';
import { myTenders as initialTenders, statusLabels, procedureMeta, rub, type TenderCard, type TenderStatus } from '../lib/data';

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
}: {
  onOpen: (id: string) => void;
  onNew: () => void;
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
      <Card className="flex divide-x divide-border overflow-hidden p-0">
        {[
          ['Всего', tenders.length, 'text-foreground'],
          ['В работе', stat('progress') + stat('draft'), 'text-warn-foreground'],
          ['Готовы', stat('ready'), 'text-success'],
          ['Поданы', stat('submitted'), 'text-muted-foreground'],
        ].map(([label, n, color]) => (
          <div key={label as string} className="flex flex-1 flex-col items-center gap-0.5 px-2 py-3">
            <span className={`text-lg font-semibold tabular-nums leading-none ${color}`}>{n as number}</span>
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
          </div>
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
          return (
            <Card
              key={t.id}
              className="group cursor-pointer transition-colors hover:border-foreground/25"
            >
              <div className="flex w-full items-start gap-3 p-4">
                <button onClick={() => onOpen(t.id)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground">
                        {procedureMeta[t.procedure].label}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {t.law} · №{t.id}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-medium leading-snug">{t.title}</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{t.customer}</p>

                    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
                      <span className="font-mono tabular-nums text-foreground">{rub(t.nmck)}</span>
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="size-3.5" /> до {t.deadline}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <FileText className="size-3.5" /> документы {t.docsLoaded}/{t.docsTotal}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-foreground transition-all"
                          style={{ width: `${t.progress}%` }}
                        />
                      </div>
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        {t.progress}%
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="mt-1 size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </button>

                {/* Delete button — appears on hover */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(t);
                  }}
                  title="Удалить закупку"
                  className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                >
                  <Trash2 className="size-4" />
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
            <Button
              size="sm"
              className="bg-danger text-white hover:opacity-90"
              onClick={confirmDelete}
            >
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
