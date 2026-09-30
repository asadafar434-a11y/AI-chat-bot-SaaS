import { useEffect, useRef, useState } from 'react';
import { castCheck, castHints, castNote, needLine, rowsOf, spreadCast, titleHints, type CastHint, type CastRow, type TpCast } from '@/lib/cast';
import { plural } from '@/lib/plural';
import { AlertTriangle, Check, CheckCircle2, ChevronDown, FileText, Plus, X } from '../lib/icons';
import { Badge, Button, Card, IconButton, cx } from './ui';

// Состав исполнителей: ТЗ требует назвать в заявке людей — артистов, музыкантов, ведущих — с ФИО и званием.
// Кто нужен и какого звания — из ТЗ; людей вписывает участник под каждую закупку: ИИ фамилий не видит и не придумывает.
// Подсказки при наборе фамилии — люди из составов других закупок. Логика — общая с приложением (web/src/lib/cast.ts).

const INPUT =
  'h-9 w-full min-w-0 rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground focus:ring-2 focus:ring-ring/20';

type Status = { ok: boolean; text: string } | null;

export function CastCard({
  cast,
  history,
  sample,
  onChange,
}: {
  cast: TpCast;
  history: CastHint[];
  // Пример списка для «Вставить пример» — только в примере закупки.
  sample?: string;
  onChange: (cast: TpCast) => void;
}) {
  const checks = castCheck(cast);
  const todo = checks.some((c) => !c.ok);
  // Раскрыт, пока есть что вписать.
  const [open, setOpen] = useState(todo);
  const [quote, setQuote] = useState<'cast' | 'replace' | null>(null);
  // null — поле списка закрыто.
  const [paste, setPaste] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  // Куда перевести фокус после перерисовки: в новую строку, на «Добавить…», в поле списка.
  const focusNext = useRef<string | null>(null);

  useEffect(() => {
    if (!focusNext.current) return;
    document.getElementById(focusNext.current)?.focus();
    focusNext.current = null;
  });

  const change = (next: TpCast) => {
    setStatus(null);
    onChange(next);
  };
  const setRow = (id: string, patch: Partial<CastRow>) => change({ ...cast, rows: cast.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const addRow = (group: string) => {
    const id = crypto.randomUUID();
    focusNext.current = `cast-name-${id}`;
    change({ ...cast, rows: [...cast.rows, { id, group, name: '', title: '' }] });
  };
  const removeRow = (row: CastRow) => {
    focusNext.current = `cast-add-${row.group}`;
    change({ ...cast, rows: cast.rows.filter((r) => r.id !== row.id) });
  };
  const togglePaste = () => {
    focusNext.current = paste === null ? 'cast-paste' : null;
    setPaste(paste === null ? '' : null);
    setStatus(null);
  };
  const split = () => {
    const text = paste ?? '';
    const { cast: next, added } = spreadCast(cast, text, () => crypto.randomUUID());
    if (!added) {
      focusNext.current = 'cast-paste';
      setStatus({ ok: false, text: text.trim() ? 'Все из списка уже в составе.' : 'Вставьте список — по человеку в строке.' });
      return;
    }
    onChange(next);
    setPaste(null);
    setStatus({ ok: true, text: `Добавил из списка: ${added} ${plural(added, 'человек', 'человека', 'человек')}. Проверьте, кто куда попал.` });
  };

  const quoteBlock = (which: 'cast' | 'replace', source: string, text: string, verified: boolean, what: string) => (
    <div className="text-[12px]">
      <button
        type="button"
        aria-expanded={quote === which}
        onClick={() => setQuote(quote === which ? null : which)}
        className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        <FileText className="size-3" /> {source}
      </button>
      {quote === which && <blockquote className="mt-1 rounded-md bg-secondary px-3 py-2 leading-snug text-muted-foreground">«{text}»</blockquote>}
      {!verified && (
        <p className="mt-1 flex items-start gap-1.5 text-warn-foreground">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          Не нашёл эту цитату в документах дословно — сверьте {what} вручную.
        </p>
      )}
    </div>
  );

  return (
    <div id="cast-card" className="scroll-mt-24">
      <Card className="p-0">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2.5 px-4 py-3 text-left">
          {todo ? <AlertTriangle className="size-4 shrink-0 text-warn" /> : <CheckCircle2 className="size-4 shrink-0 text-success" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Состав исполнителей</p>
            <p className="text-[12px] text-muted-foreground">Кто выступит в этот раз, знаете только вы. ИИ фамилий не видит и не придумывает.</p>
          </div>
          <Badge tone={todo ? 'warn' : 'success'}>{todo ? 'впишите исполнителей' : 'готово'}</Badge>
          <ChevronDown className={cx('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>

        {open && (
          <div className="animate-fade-up space-y-3 border-t border-border px-4 pb-4 pt-3">
            <div className="space-y-1.5">
              <p className="text-[13px] text-muted-foreground">
                В ТЗ{cast.clause ? `, п. ${cast.clause}` : ''}: {cast.requirement}
              </p>
              {quoteBlock('cast', 'цитата из ТЗ', cast.quote, cast.verified, 'состав')}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" aria-expanded={paste !== null} onClick={togglePaste}>
                Вставить списком
              </Button>
            </div>

            {paste !== null && (
              <div className="space-y-2 rounded-lg bg-secondary/60 p-3">
                <label htmlFor="cast-paste" className="text-[13px] font-medium">
                  Список исполнителей: по человеку в строке — ФИО, через запятую роль и звание
                </label>
                <textarea
                  id="cast-paste"
                  rows={5}
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder="Соколова Мария Андреевна, вокал, заслуженная артистка России"
                  className="min-h-28 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-foreground focus:ring-2 focus:ring-ring/20"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={split}>
                    Разложить по строкам
                  </Button>
                  <Button size="sm" variant="secondary" onClick={togglePaste}>
                    Отмена
                  </Button>
                  {sample && (
                    <button type="button" onClick={() => setPaste(sample)} className="text-[12px] text-muted-foreground underline underline-offset-4 hover:text-foreground">
                      Вставить пример
                    </button>
                  )}
                </div>
              </div>
            )}
            {status && (
              <p role="status" className={cx('text-[13px] font-medium', status.ok ? 'text-success' : 'text-warn-foreground')}>
                {status.text}
              </p>
            )}

            <ul aria-label="Сверка с ТЗ" className="space-y-1">
              {checks.map((c, i) => (
                <li key={cast.groups[i].key} className={cx('flex items-start gap-1.5 text-[13px] font-medium', c.ok ? 'text-success' : 'text-warn-foreground')}>
                  {c.ok ? <Check className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>

            {cast.groups.map((g, gi) => {
              const rows = rowsOf(cast, g.key);
              return (
                <div key={g.key} role="group" aria-labelledby={`cast-${g.key}`} className="space-y-2 border-t border-border pt-3">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <h4 id={`cast-${g.key}`} className="text-sm font-medium">
                      {g.title}
                    </h4>
                    <span className="text-[12px] text-muted-foreground">{needLine(g)}</span>
                  </div>
                  {rows.length > 0 && (
                    <ol className="space-y-2">
                      {rows.map((row, i) => {
                        const who = `${g.one} ${i + 1}`;
                        const note = castNote(g, row, checks[gi].rankFail);
                        return (
                          <li key={row.id} className="grid grid-cols-[16px_minmax(0,1fr)_28px] items-start gap-x-2 gap-y-1.5">
                            <span aria-hidden className="pt-2 text-right font-mono text-[11px] text-muted-foreground">
                              {i + 1}
                            </span>
                            <div className="grid min-w-0 gap-1.5 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                              <input
                                id={`cast-name-${row.id}`}
                                list={`cast-names-${row.id}`}
                                value={row.name}
                                onChange={(e) => {
                                  const name = e.target.value;
                                  // Человек из прошлой закупки — вместе со званием, если звание ещё не вписано.
                                  const known = history.find((h) => h.name === name);
                                  setRow(row.id, { name, ...(known?.title && !row.title.trim() ? { title: known.title } : {}) });
                                }}
                                placeholder="Фамилия, имя, отчество"
                                aria-label={`${who}: фамилия, имя, отчество`}
                                autoComplete="off"
                                className={INPUT}
                              />
                              <datalist id={`cast-names-${row.id}`}>
                                {castHints(history, cast, row.name).map((h) => (
                                  <option key={h.name} value={h.name}>
                                    {[h.title, `из закупки «${h.from}»`].filter(Boolean).join(' · ')}
                                  </option>
                                ))}
                              </datalist>
                              <input
                                list={`cast-titles-${row.id}`}
                                value={row.title}
                                onChange={(e) => setRow(row.id, { title: e.target.value })}
                                placeholder={g.rank !== 'none' ? 'Почётное звание' : 'Звание, если есть'}
                                aria-label={`${who}: почётное звание`}
                                autoComplete="off"
                                className={INPUT}
                              />
                              <datalist id={`cast-titles-${row.id}`}>
                                {titleHints(row.title).map((t) => (
                                  <option key={t} value={t} />
                                ))}
                              </datalist>
                            </div>
                            <IconButton label={`Убрать: ${who.toLowerCase()}`} align="end" onClick={() => removeRow(row)}>
                              <X className="size-4" />
                            </IconButton>
                            {note && (
                              <p className="col-span-2 col-start-2 flex items-start gap-1.5 text-[12px] text-warn-foreground">
                                <AlertTriangle className="mt-px size-3.5 shrink-0" />
                                {note}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  <button
                    id={`cast-add-${g.key}`}
                    type="button"
                    onClick={() => addRow(g.key)}
                    className="ml-6 inline-flex items-center gap-1 text-[13px] font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    <Plus className="size-4" />
                    Добавить {g.acc}
                  </button>
                </div>
              );
            })}

            {cast.replace.rule && (
              <div className="space-y-1.5 border-t border-border pt-3">
                <p className="text-[13px] text-muted-foreground">Состав поменяется после подачи? {cast.replace.rule}</p>
                {quoteBlock('replace', cast.replace.source || 'цитата из проекта контракта', cast.replace.quote, cast.replace.verified, 'условие')}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
