import { useRef, useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Check,
  HelpCircle,
  Pencil,
  Paperclip,
  Eye,
  AlertTriangle,
} from '../lib/icons';
import { Button, Card, Badge } from './ui';
import { gaps, type Gap } from '../lib/data';
import type { Fixes } from '../App';

const sevMeta = {
  high: { tone: 'danger' as const, label: 'Критично', ring: 'border-l-danger' },
  medium: { tone: 'warn' as const, label: 'Важно', ring: 'border-l-warn' },
  low: { tone: 'neutral' as const, label: 'Уточнение', ring: 'border-l-border' },
};

function isResolved(gap: Gap, fixes: Fixes) {
  const v = fixes[gap.id];
  if (!v) return false;
  if (gap.kind === 'choice') return v !== 'Ещё не оформлено';
  return true;
}

export function StepReview({
  fixes,
  setFix,
  onNext,
  onBack,
}: {
  fixes: Fixes;
  setFix: (id: string, value: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const resolvedCount = gaps.filter((g) => isResolved(g, fixes)).length;
  const openGaps = gaps.filter((g) => !isResolved(g, fixes));
  const openWeight = openGaps.reduce((s, g) => s + g.weight, 0);
  const rejectionRisk = openWeight === 0 ? 3 : Math.min(74, openWeight + 2);
  const criticalOpen = openGaps.some((g) => g.severity === 'high');
  const allClear = openGaps.length === 0;

  const select = (id: string) => {
    setSelected(id);
    requestAnimationFrame(() => {
      cardRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Проверка перед подачей</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Документы и цена готовы. Это последний шаг перед формированием пакета: ИИ сверил заявку с
          извещением и ТЗ и нашёл «слепые зоны» — места, которые он <b>не смог заполнить сам</b>
          , потому что данных нет в загруженных файлах. Нажмите на любую{' '}
          <mark className="highlight">жёлтую подсветку</mark> в тексте заявки или на карточку слева,
          чтобы увидеть <b>почему</b> и исправить прямо здесь. Когда всё закрыто — жмите
          «Сформировать пакет».
        </p>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-secondary/40 px-4 py-3 text-xs">
        <LegendItem swatch="bg-warn-surface border border-warn/50" label="Нужно дописать вручную" />
        <LegendItem swatch="bg-danger/15 border border-danger/40" label="Критично — иначе отклонят" />
        <LegendItem swatch="bg-success/15 border border-success/40" label="Заполнено — готово" />
        <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
          <HelpCircle className="size-3.5" /> «Слепая зона» = данных нет в загруженных файлах
        </span>
      </div>

      {/* Risk banner */}
      <Card className={`p-5 ${allClear ? 'bg-success/5' : criticalOpen ? 'bg-danger/5' : 'bg-warn-surface/30'}`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {allClear ? (
              <ShieldCheck className="size-6 text-success" />
            ) : (
              <ShieldAlert className={`size-6 ${criticalOpen ? 'text-danger' : 'text-warn'}`} />
            )}
            <div>
              <p className="text-sm font-medium">Риск отклонения заявки</p>
              <p className="text-xs text-muted-foreground">
                {allClear
                  ? 'Все слепые зоны закрыты — заявку можно подавать'
                  : `Исправлено ${resolvedCount} из ${gaps.length}. Осталось ${openGaps.length}.`}
              </p>
            </div>
          </div>
          <p
            className={`font-mono text-3xl font-semibold tabular-nums ${
              allClear ? 'text-success' : criticalOpen ? 'text-danger' : 'text-warn-foreground'
            }`}
          >
            {rejectionRisk}%
          </p>
        </div>
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-foreground transition-all duration-500"
            style={{ width: `${(resolvedCount / gaps.length) * 100}%` }}
          />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        {/* Fix cards */}
        <div className="space-y-3">
          {gaps.map((gap) => (
            <GapCard
              key={gap.id}
              gap={gap}
              value={fixes[gap.id]}
              resolved={isResolved(gap, fixes)}
              selected={selected === gap.id}
              onSelect={() => setSelected(gap.id)}
              onFix={(v) => setFix(gap.id, v)}
              cardRef={(el) => (cardRefs.current[gap.id] = el)}
            />
          ))}
        </div>

        {/* Live document */}
        <Card className="p-0 lg:sticky lg:top-[5.5rem] lg:h-fit">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Заявка · вторая часть
            </span>
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
              <Eye className="size-3" /> живой предпросмотр
            </span>
          </div>
          <div className="space-y-3 p-5 text-[13px] leading-relaxed">
            <p className="font-semibold">Согласие участника закупки</p>
            <p>
              Настоящим ООО «ТехСнаб» подтверждает согласие на поставку товара, соответствующего
              требованиям технического задания закупки №0173200001325001842.
            </p>
            <p>
              <b>Поз. 2. Ноутбук 15.6".</b> Диагональ 15.6", процессор Intel Core i5, ОЗУ 16 ГБ,
              накопитель <Mark gap={gaps[2]} fixes={fixes} onSelect={select} selected={selected} />.
            </p>
            <p>
              <b>Поз. 5. МФУ лазерное.</b> Формат A4, скорость печати{' '}
              <Mark gap={gaps[3]} fixes={fixes} onSelect={select} selected={selected} />, автоподача
              документов.
            </p>
            <p>
              <b>Поз. 7. Сертификат соответствия.</b>{' '}
              <Mark gap={gaps[0]} fixes={fixes} onSelect={select} selected={selected} />
            </p>
            <p>
              <b>Поз. 9. ИБП.</b> Выходная мощность{' '}
              <Mark gap={gaps[4]} fixes={fixes} onSelect={select} selected={selected} />, время
              автономной работы не менее 10 мин.
            </p>
            <p>
              <b>Обеспечение заявки.</b> Спецсчёт №40702…8814, сумма 214 000 ₽ —{' '}
              <Mark gap={gaps[1]} fixes={fixes} onSelect={select} selected={selected} />.
            </p>
          </div>
        </Card>
      </div>

      {criticalOpen && (
        <p className="flex items-center gap-2 text-[13px] text-danger">
          <AlertTriangle className="size-4 shrink-0" />
          Есть критичное замечание — без него заявку почти наверняка отклонят. Рекомендуем закрыть до
          подачи.
        </p>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← Назад
        </Button>
        <Button variant={criticalOpen ? 'secondary' : 'primary'} onClick={onNext}>
          {allClear ? 'Сформировать пакет →' : 'Продолжить с открытыми пунктами →'}
        </Button>
      </div>
    </div>
  );
}

function LegendItem({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span className={`inline-block size-3 rounded-sm ${swatch}`} />
      {label}
    </span>
  );
}

/* Inline highlight inside the document preview */
function Mark({
  gap,
  fixes,
  onSelect,
  selected,
}: {
  gap: Gap;
  fixes: Fixes;
  onSelect: (id: string) => void;
  selected: string | null;
}) {
  const resolved = isResolved(gap, fixes);
  const value = fixes[gap.id];
  const isSel = selected === gap.id;

  if (resolved) {
    return (
      <button
        onClick={() => onSelect(gap.id)}
        className={`rounded px-1 font-medium text-success underline decoration-success/40 underline-offset-2 transition-colors hover:bg-success/10 ${
          isSel ? 'bg-success/10' : ''
        }`}
      >
        {gap.kind === 'upload' ? `📎 ${value}` : value}
      </button>
    );
  }
  return (
    <button
      onClick={() => onSelect(gap.id)}
      className={`highlight cursor-pointer font-medium transition-shadow ${
        isSel ? 'ring-2 ring-warn' : ''
      }`}
    >
      ⚠ {gap.kind === 'upload' ? 'приложить сертификат' : `вписать: ${gap.label.toLowerCase()}`}
    </button>
  );
}

/* One fixable "blind zone" with the actual input control */
function GapCard({
  gap,
  value,
  resolved,
  selected,
  onSelect,
  onFix,
  cardRef,
}: {
  gap: Gap;
  value?: string;
  resolved: boolean;
  selected: boolean;
  onSelect: () => void;
  onFix: (v: string) => void;
  cardRef: (el: HTMLDivElement | null) => void;
}) {
  const meta = sevMeta[gap.severity];
  const [draft, setDraft] = useState(value ?? '');
  const [editing, setEditing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const showControl = !resolved || editing;

  return (
    <div
      ref={cardRef}
      onClick={onSelect}
      className={`scroll-mt-24 rounded-lg border border-l-2 bg-card p-4 transition-all ${
        resolved ? 'border-l-success/60 opacity-90' : meta.ring
      } ${selected ? 'ring-2 ring-ring/30' : 'border-border'}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">{gap.position}</span>
          <Badge tone={resolved ? 'success' : meta.tone}>
            {resolved ? (
              <>
                <Check className="size-2.5" /> Готово
              </>
            ) : (
              meta.label
            )}
          </Badge>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">{gap.ref}</span>
      </div>

      <p className="mt-2 text-sm font-medium">{gap.label}</p>

      {/* Why this is a blind zone */}
      <div className="mt-2 flex gap-2 rounded-md bg-secondary/60 p-2.5">
        <HelpCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-[12px] leading-snug text-muted-foreground">
            <span className="font-medium text-foreground">Почему ИИ не заполнил сам: </span>
            {gap.why}
          </p>
          <p className="text-[12px] leading-snug text-muted-foreground">
            <span className="font-medium text-foreground">Если оставить: </span>
            {gap.consequence}
          </p>
        </div>
      </div>

      {/* The actual fix control */}
      <div className="mt-3">
        {resolved && !editing ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-success/30 bg-success/5 px-3 py-2">
            <span className="min-w-0 truncate text-[13px] text-success">
              {gap.kind === 'upload' ? `📎 ${value}` : value}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDraft(value ?? '');
                setEditing(true);
              }}
              className="inline-flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Pencil className="size-3" /> Изменить
            </button>
          </div>
        ) : (
          showControl && (
            <div onClick={(e) => e.stopPropagation()}>
              {gap.kind === 'text' && (
                <div className="flex gap-2">
                  <input
                    autoFocus={selected}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={gap.placeholder}
                    className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-foreground focus:ring-2 focus:ring-ring/20"
                  />
                  <Button
                    size="sm"
                    disabled={!draft.trim()}
                    onClick={() => {
                      onFix(draft.trim());
                      setEditing(false);
                    }}
                  >
                    Сохранить
                  </Button>
                </div>
              )}

              {gap.kind === 'choice' && (
                <div className="flex flex-col gap-1.5">
                  {gap.choices!.map((c) => {
                    const active = draft === c || value === c;
                    const positive = c !== 'Ещё не оформлено';
                    return (
                      <button
                        key={c}
                        onClick={() => {
                          setDraft(c);
                          onFix(c);
                          setEditing(false);
                        }}
                        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-[13px] transition-colors ${
                          active
                            ? positive
                              ? 'border-success/50 bg-success/5 text-foreground'
                              : 'border-warn/50 bg-warn-surface/40 text-foreground'
                            : 'border-border bg-background text-muted-foreground hover:bg-secondary'
                        }`}
                      >
                        <span
                          className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
                            active ? 'border-foreground bg-primary text-primary-foreground' : 'border-border'
                          }`}
                        >
                          {active && <Check className="size-2.5" />}
                        </span>
                        {c}
                      </button>
                    );
                  })}
                </div>
              )}

              {gap.kind === 'upload' && (
                <div>
                  <input
                    ref={fileInput}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const name = e.target.files?.[0]?.name ?? 'Сертификат_соответствия.pdf';
                      onFix(name);
                      setEditing(false);
                    }}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Paperclip className="size-3.5" /> Загрузить файл
                  </Button>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">{gap.accept}</p>
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
