import { useState } from 'react';
import type { SearchRecord } from '@/lib/web-search';
import { ExternalLink, Search } from '../lib/icons';
import { CertaintyBadge } from './Certainty';
import { Button } from './ui';

// «Проверить поиском» у гипотезы о скрытых затратах: обычный бесплатный поиск по ключевым словам (lib/web-search.ts, /api/search). Показываем, ЧТО именно уходит в поиск, и результаты со ссылками.
// Метка «Не проверено»: программа страницы не читает и чисел из них не берёт — смотрит человек. Когда автоматический поиск отказал, тот же запрос открывается в Яндексе в браузере участника.

const yandex = (query: string) => `https://yandex.ru/search/?text=${encodeURIComponent(query)}`;
const dateRu = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU');
};
const isWeb = (url: string) => /^https?:\/\//i.test(url);

export function HypothesisSearch({ query, record, onSearch }: { query: string; record: SearchRecord | undefined; onSearch: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    const failed = await onSearch();
    setError(failed);
    setBusy(false);
  };
  return (
    <div className="mt-2 space-y-2 pl-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run()}>
          <Search className="size-3.5" />
          {busy ? 'Ищу…' : record ? 'Искать заново' : 'Проверить поиском'}
        </Button>
        <span className="min-w-0 break-words text-[11px] text-muted-foreground">В поиск уходит только: «{query}»</span>
      </div>
      {error && (
        <p role="alert" className="break-words text-[12px] text-danger">
          {error}{' '}
          <a href={yandex(query)} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2">
            Открыть тот же запрос в Яндексе
          </a>
        </p>
      )}
      {record && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <CertaintyBadge kind="unchecked" />
            <span className="min-w-0 break-words text-[11px] text-muted-foreground">
              {record.provider}
              {dateRu(record.at) && `, ${dateRu(record.at)}`}. Страницы программа не читает и чисел из них не берёт — проверьте по ссылкам.
            </span>
          </div>
          {record.hits.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">Ничего не нашлось.</p>
          ) : (
            <ul className="space-y-1.5">
              {record.hits.map((hit) => (
                <li key={hit.url} className="min-w-0 break-words text-[12px]">
                  {isWeb(hit.url) ? (
                    <a href={hit.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-start gap-1 font-medium underline-offset-2 hover:underline">
                      <span className="break-words">{hit.title}</span>
                      <ExternalLink className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                    </a>
                  ) : (
                    <span className="font-medium">{hit.title}</span>
                  )}
                  <span className="block text-[11px] text-muted-foreground">{hit.domain}</span>
                  {hit.snippet && <span className="block text-muted-foreground">{hit.snippet}</span>}
                </li>
              ))}
            </ul>
          )}
          <a href={yandex(record.query)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Посмотреть этот запрос в Яндексе
            <ExternalLink className="size-3" />
          </a>
        </div>
      )}
    </div>
  );
}
