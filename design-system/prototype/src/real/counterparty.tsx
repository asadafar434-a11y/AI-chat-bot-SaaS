import { useState } from 'react';
import { innProblem, normalizeInn, type CounterpartyReport } from '@/lib/counterparty';
import { errorMessage, errorText } from '@/lib/http-error';
import { CounterpartyCard } from '../components/Counterparty';

// «Проверка контрагента по ИНН» на главной раздела «Аналитика»: сервер (/api/counterparty) спрашивает ЕГРЮЛ, Федресурс и ГИР БО; в них уходит только ИНН.

export async function checkCounterparty(inn: string): Promise<{ report: CounterpartyReport } | { error: string }> {
  try {
    const res = await fetch('/api/counterparty', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inn }) });
    if (!res.ok) return { error: await errorText(res, 'Проверка сейчас недоступна. Повторите позже.') };
    return { report: (await res.json()) as CounterpartyReport };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export function CounterpartyBlock() {
  const [inn, setInn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<CounterpartyReport | null>(null);

  const check = async () => {
    const digits = normalizeInn(inn);
    const problem = innProblem(digits);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    setReport(null);
    const result = await checkCounterparty(digits);
    setBusy(false);
    if ('error' in result) setError(result.error);
    else setReport(result.report);
  };

  return <CounterpartyCard inn={inn} onInn={(v) => { setInn(v); if (error) setError(null); }} onCheck={() => void check()} busy={busy} error={error} report={report} />;
}
