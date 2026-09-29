import { useState } from 'react';
import { Search, Calendar, Plus, Check, Sparkles, Loader2 } from '../lib/icons';
import { Button, Card, Badge } from './ui';
import { foundTenders, procedureMeta, rub } from '../lib/data';

const presets = ['компьютерное оборудование', 'МФУ и картриджи', 'серверы', 'ОКПД 26.20'];

export function TenderSearch({ onAdd }: { onAdd: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState(true);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState<Record<string, boolean>>({});

  const run = (q?: string) => {
    if (q !== undefined) setQuery(q);
    setLoading(true);
    setSearched(true);
    setTimeout(() => setLoading(false), 700);
  };

  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Поиск закупок</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
          ИИ ищет актуальные закупки по площадкам (ЕИС, РТС-тендер, Сбербанк-АСТ, Газпромбанк) и
          ранжирует их по релевантности профилю вашей компании и кодам ОКПД.
        </p>
      </div>

      <Card className="p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <div className="flex h-10 min-w-[240px] flex-1 items-center gap-2 rounded-md border border-border bg-background px-3">
            <Search className="size-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ключевые слова, ОКПД или № закупки"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Найти
          </Button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] text-muted-foreground">Быстрый поиск:</span>
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => run(p)}
              className="rounded-full border border-border bg-background px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {p}
            </button>
          ))}
        </div>
      </Card>

      {searched && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              {loading ? 'Идёт поиск…' : `Найдено ${foundTenders.length} закупок`}
            </p>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Sparkles className="size-3.5" /> отсортировано по релевантности
            </span>
          </div>

          {foundTenders.map((t) => {
            const isAdded = added[t.id];
            return (
              <Card key={t.id} className={`p-4 transition-opacity ${loading ? 'opacity-50' : ''}`}>
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={t.relevance >= 90 ? 'success' : 'neutral'}>
                        {t.relevance}% совпадение
                      </Badge>
                      <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground">
                        {procedureMeta[t.procedure].label}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {t.law} · ОКПД {t.okpd}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-medium leading-snug">{t.title}</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{t.customer}</p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
                      <span className="font-mono tabular-nums text-foreground">{rub(t.nmck)}</span>
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="size-3.5" /> до {t.deadline}
                      </span>
                      <span>{t.platform}</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={isAdded ? 'secondary' : 'primary'}
                    disabled={isAdded}
                    onClick={() => {
                      setAdded((p) => ({ ...p, [t.id]: true }));
                      onAdd(t.id);
                    }}
                  >
                    {isAdded ? (
                      <>
                        <Check className="size-4" /> Добавлено
                      </>
                    ) : (
                      <>
                        <Plus className="size-4" /> В работу
                      </>
                    )}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
