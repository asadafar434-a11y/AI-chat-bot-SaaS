import { useState } from 'react';
import { innProblem, lookupOf, ogrnProblem, textQueryProblem, type CounterpartyReport, type SearchHit, type SearchMode } from '@/lib/counterparty';
import { errorMessage, errorText } from '@/lib/http-error';
import { CounterpartyCard } from '../components/Counterparty';

// «Проверка контрагента» на главной раздела «Аналитика»: ИНН или ОГРН — сразу отчёт; название, ФИО или руководитель — список найденных, из него выбирают нужную.
// Сервер (/api/counterparty) спрашивает ЕГРЮЛ, Федресурс и ГИР БО или Checko; в них уходит только то, что вписал человек.

export type CounterpartyAnswer = { report: CounterpartyReport } | { hits: SearchHit[]; more: boolean } | { error: string };

/** Один запрос к серверу: { inn } и { ogrn } отвечают отчётом (ОГРН, которого нет, — пустым списком), { query, mode } — списком найденных. */
export async function askCounterparty(body: { inn: string } | { ogrn: string } | { query: string; mode: SearchMode }): Promise<CounterpartyAnswer> {
  try {
    const res = await fetch('/api/counterparty', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) return { error: await errorText(res, 'Проверка сейчас недоступна. Повторите позже.') };
    const json = (await res.json()) as CounterpartyReport | { hits: SearchHit[]; more?: boolean };
    return 'hits' in json ? { hits: json.hits, more: json.more === true } : { report: json };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function checkCounterparty(inn: string): Promise<{ report: CounterpartyReport } | { error: string }> {
  const answer = await askCounterparty({ inn });
  return 'hits' in answer ? { error: 'Проверка сейчас недоступна. Повторите позже.' } : answer;
}

export function CounterpartyBlock() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<SearchMode>('org');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<CounterpartyReport | null>(null);
  const [hits, setHits] = useState<{ list: SearchHit[]; more: boolean } | null>(null);

  const run = async (body: Parameters<typeof askCounterparty>[0]) => {
    setError(null);
    setBusy(true);
    setReport(null);
    setHits(null);
    const answer = await askCounterparty(body);
    setBusy(false);
    if ('error' in answer) setError(answer.error);
    else if ('hits' in answer) setHits({ list: answer.hits, more: answer.more });
    else setReport(answer.report);
  };

  const check = () => {
    const lookup = lookupOf(input);
    const problem = lookup.kind === 'inn' ? innProblem(lookup.value) : lookup.kind === 'ogrn' ? ogrnProblem(lookup.value) : textQueryProblem(lookup.value);
    if (problem) {
      setError(problem);
      return;
    }
    void run(lookup.kind === 'inn' ? { inn: lookup.value } : lookup.kind === 'ogrn' ? { ogrn: lookup.value } : { query: lookup.value, mode });
  };

  const pick = (hit: SearchHit) => {
    setInput(hit.inn);
    void run({ inn: hit.inn });
  };

  return (
    <CounterpartyCard
      inn={input}
      onInn={(v) => {
        setInput(v);
        if (error) setError(null);
      }}
      onCheck={check}
      busy={busy}
      error={error}
      report={report}
      mode={mode}
      onMode={(m) => {
        setMode(m);
        setHits(null);
      }}
      hits={hits?.list ?? null}
      more={hits?.more ?? false}
      onPick={pick}
    />
  );
}
