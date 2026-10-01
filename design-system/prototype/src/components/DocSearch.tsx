import { useDeferredValue, useMemo, useState } from 'react';
import { createLocator, describeLocation } from '@/lib/doc-locate';
import { fragmentsOf, piecesOf, searchDocuments, type DocHits, type Fragment } from '@/lib/doc-search';
import { plural } from '@/lib/plural';
import type { SentDocument } from '@/lib/read-documents';
import { ChevronDown, Search } from '../lib/icons';
import { Card, cx } from './ui';

// Поиск по словам во всех документах закупки — не шаг подготовки заявки, а инструмент: найти, где в извещении, ТЗ или
// проекте контракта говорится об обеспечении, сроках, неустойке. Логика — общая с приложением (web/src/lib/doc-search.ts).

const EXAMPLES = ['обеспечение заявки', 'неустойка', 'срок поставки', 'гарантия', 'приёмка', 'лицензия'];
// Сколько знаков текста вокруг найденного: в отрывке и в раскрытом отрывке.
const NEAR = 90;
const WIDE = 480;
// Отрывков в документе сразу; остальные — по кнопке.
const FIRST = 5;

const places = (n: number) => `${n} ${plural(n, 'место', 'места', 'мест')}`;

// where — где в файле стоит найденное: страница, таблица, строка, пункт (lib/doc-locate.ts).
function Snippet({ doc, fragment, where }: { doc: DocHits; fragment: Fragment; where?: string }) {
  const [wide, setWide] = useState(false);
  const shown = wide ? fragmentsOf(doc.text, fragment.marks, WIDE)[0] : fragment;
  const cut = fragment.from > 0 || fragment.to < doc.text.length;
  return (
    <li className="space-y-1 py-2.5">
      <p className="text-[13px] leading-relaxed">
        {shown.from > 0 && '… '}
        {piecesOf(doc.text, shown).map((piece, i) =>
          piece.mark ? (
            <mark key={i} className="highlight rounded-sm px-0.5 font-semibold text-foreground">
              {piece.text}
            </mark>
          ) : (
            <span key={i}>{piece.text}</span>
          ),
        )}
        {shown.to < doc.text.length && ' …'}
      </p>
      {where && <p className="break-words text-[11px] text-muted-foreground">{where}</p>}
      {cut && (
        <button
          type="button"
          aria-expanded={wide}
          onClick={() => setWide(!wide)}
          className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {wide ? 'Свернуть' : 'Показать больше текста'}
        </button>
      )}
    </li>
  );
}

function DocResults({ doc, whereAt }: { doc: DocHits; whereAt: (name: string, pos: number) => string | undefined }) {
  const [all, setAll] = useState(false);
  const fragments = fragmentsOf(doc.text, doc.hits, NEAR);
  const shown = all ? fragments : fragments.slice(0, FIRST);
  return (
    <div className="border-t border-border px-4 py-3">
      <p className="text-sm font-medium">
        {doc.name} <span className="ml-1 font-mono text-[11px] text-muted-foreground">{doc.total}</span>
      </p>
      {doc.scan && <p className="text-[12px] text-warn-foreground">распознан со скана — цифры сверьте с оригиналом</p>}
      <ul className="divide-y divide-border">
        {shown.map((f) => (
          <Snippet key={f.from} doc={doc} fragment={f} where={whereAt(doc.name, f.marks[0].start)} />
        ))}
      </ul>
      {fragments.length > FIRST && (
        <button type="button" onClick={() => setAll(!all)} className="mt-1 text-[13px] font-medium underline underline-offset-4">
          {all ? 'Свернуть' : `Показать все отрывки — ещё ${fragments.length - FIRST}`}
        </button>
      )}
      {doc.total > doc.hits.length && (
        <p className="mt-1 text-[12px] text-muted-foreground">
          Показаны первые {places(doc.hits.length)} из {doc.total} — уточните запрос, например, добавьте второе слово.
        </p>
      )}
    </div>
  );
}

export function DocSearch({ documents }: { documents: SentDocument[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const result = useMemo(() => searchDocuments(documents, deferred), [documents, deferred]);
  const locator = useMemo(() => createLocator(documents), [documents]);
  const whereAt = (name: string, pos: number) => {
    const place = locator.at(name, pos);
    return (place && describeLocation(place)) || undefined;
  };

  const found = result?.docs.filter((d) => d.total > 0) ?? [];
  const total = found.reduce((n, d) => n + d.total, 0);
  const summary = !result
    ? `Ищу во всех документах закупки: ${documents.map((d) => d.name).join(', ')}. Окончания не важны: «гарантия» найдёт и «гарантии», и «гарантией».`
    : total === 0
      ? `Не нашёл «${deferred.trim()}» ни в одном документе. Проверьте, нет ли опечатки, или попробуйте другое слово.`
      : `${result.mode === 'words' ? 'Фразы целиком нет — нашёл слова по отдельности: ' : 'Нашёл '}${places(total)} в ${found.length} ${plural(found.length, 'документе', 'документах', 'документах')} из ${documents.length}.`;

  return (
    <Card className="p-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2.5 px-4 py-3 text-left">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Поиск по документам закупки</p>
          <p className="text-[12px] text-muted-foreground">Найти, где в извещении, ТЗ или проекте контракта говорится об обеспечении, сроках, неустойке.</p>
        </div>
        <ChevronDown className={cx('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="animate-fade-up">
          <div className="space-y-2.5 border-t border-border px-4 pb-3 pt-3">
            <label className="flex h-10 items-center gap-2 rounded-md border border-border bg-background px-3 text-muted-foreground focus-within:border-foreground focus-within:ring-2 focus-within:ring-ring/20">
              <Search className="size-4 shrink-0" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                placeholder="Слово или фраза, например «обеспечение заявки»"
                aria-label="Что найти в документах закупки"
                autoComplete="off"
                autoFocus
                className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>
            <p aria-live="polite" className="max-w-[80ch] text-[12px] text-muted-foreground">
              {summary}
            </p>
            {!result && (
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuery(q)}
                    className="rounded-full border border-border bg-background px-3 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
          {found.map((doc) => (
            <DocResults key={`${deferred}:${doc.name}`} doc={doc} whereAt={whereAt} />
          ))}
        </div>
      )}
    </Card>
  );
}
