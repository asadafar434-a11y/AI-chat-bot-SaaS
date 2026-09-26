"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { SearchIcon } from "@/components/icons";
import { Island } from "@/components/island";
import { usePurchase } from "@/components/purchase-provider";
import { TabBody } from "@/components/purchase-view";
import { fragmentsOf, piecesOf, searchDocuments, type DocHits, type Fragment } from "@/lib/doc-search";
import { plural } from "@/lib/plural";

const EXAMPLES = ["обеспечение заявки", "неустойка", "срок поставки", "гарантия", "приёмка", "лицензия"];

// Сколько знаков текста вокруг найденного: в отрывке и в раскрытом отрывке.
const NEAR = 90;
const WIDE = 480;
// Отрывков в документе сразу; остальные — по кнопке.
const FIRST = 5;

const places = (n: number) => `${n} ${plural(n, "место", "места", "мест")}`;

function Snippet({ doc, fragment }: { doc: DocHits; fragment: Fragment }) {
  const [wide, setWide] = useState(false);
  const shown = wide ? fragmentsOf(doc.text, fragment.marks, WIDE)[0] : fragment;
  const cut = fragment.from > 0 || fragment.to < doc.text.length;
  return (
    <li className="grid justify-items-start gap-1 py-2.5">
      <p className="t-read">
        {shown.from > 0 && "… "}
        {piecesOf(doc.text, shown).map((piece, i) =>
          piece.mark ? (
            <mark key={i} className="rounded-sm bg-[var(--brand-tint)] px-0.5 font-semibold text-foreground">
              {piece.text}
            </mark>
          ) : (
            <span key={i}>{piece.text}</span>
          )
        )}
        {shown.to < doc.text.length && " …"}
      </p>
      {cut && (
        <button type="button" aria-expanded={wide} onClick={() => setWide(!wide)} className="link link-quiet t-caption">
          {wide ? "Свернуть" : "Показать больше текста"}
        </button>
      )}
    </li>
  );
}

function DocResults({ doc }: { doc: DocHits }) {
  const [all, setAll] = useState(false);
  const fragments = fragmentsOf(doc.text, doc.hits, NEAR);
  const shown = all ? fragments : fragments.slice(0, FIRST);
  return (
    <Island
      level={3}
      title={doc.name}
      count={doc.total}
      sub={doc.scan ? "распознан со скана — цифры сверьте с оригиналом" : undefined}
    >
      <ul className="divide-y divide-[var(--line)] px-[var(--pad)] pb-1">
        {shown.map((f) => (
          <Snippet key={f.from} doc={doc} fragment={f} />
        ))}
      </ul>
      {fragments.length > FIRST && (
        <div className="mx-[var(--pad)] border-t border-[var(--line)] py-2.5">
          <button type="button" onClick={() => setAll(!all)} className="link">
            {all ? "Свернуть" : `Показать все отрывки — ещё ${fragments.length - FIRST}`}
          </button>
        </div>
      )}
      {doc.total > doc.hits.length && (
        <p className="t-caption px-[var(--pad)] pb-3 text-[var(--ink-3)]">
          Показаны первые {places(doc.hits.length)} из {doc.total} — уточните запрос, например, добавьте второе слово.
        </p>
      )}
    </Island>
  );
}

// Поиск по словам во всех документах закупки. Не шаг подготовки заявки, а инструмент рядом с «Вопросами»:
// найти, где в извещении, ТЗ или проекте контракта говорится об обеспечении, сроках, неустойке.
export default function SearchPage() {
  const { documents } = usePurchase();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const result = useMemo(() => searchDocuments(documents, deferred), [documents, deferred]);

  const found = result?.docs.filter((d) => d.total > 0) ?? [];
  const total = found.reduce((n, d) => n + d.total, 0);
  const summary = !result
    ? `Ищу во всех документах закупки: ${documents.map((d) => d.name).join(", ")}. Окончания не важны: «гарантия» найдёт и «гарантии», и «гарантией».`
    : total === 0
      ? `Не нашёл «${deferred.trim()}» ни в одном документе. Проверьте, нет ли опечатки, или попробуйте другое слово.`
      : `${result.mode === "words" ? "Фразы целиком нет — нашёл слова по отдельности: " : "Нашёл "}${places(total)} в ${found.length} ${plural(found.length, "документе", "документах", "документах")} из ${documents.length}.`;

  return (
    <TabBody>
      <section aria-labelledby="search-title" className="island">
        <div className="island-head">
          <h3 id="search-title" className="t-section">
            Поиск по документам закупки
          </h3>
        </div>
        <div className="grid gap-2.5 px-[var(--pad)] pb-[var(--pad)] pt-1">
          <label className="field flex items-center gap-2 text-[var(--ink-3)]">
            <SearchIcon className="size-4 shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder="Слово или фраза, например «обеспечение заявки»"
              aria-label="Что найти в документах закупки"
              autoComplete="off"
              autoFocus
              className="h-full min-w-0 flex-1 bg-transparent text-foreground outline-none"
            />
          </label>
          <p aria-live="polite" className="max-w-[80ch] text-[var(--ink-3)]">
            {summary}
          </p>
          {!result && (
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((q) => (
                <button key={q} type="button" onClick={() => setQuery(q)} className="chip">
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {found.map((doc) => (
        <DocResults key={`${deferred}:${doc.name}`} doc={doc} />
      ))}
    </TabBody>
  );
}
