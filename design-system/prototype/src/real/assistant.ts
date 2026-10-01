import { useRef, useState } from 'react';
import { MAX_CONTEXT_CHARS, type ChatMessage } from '@/lib/chat-types';
import { streamEvents } from '@/lib/chat-stream';
import { errorMessage, errorText } from '@/lib/http-error';
import { aiHeaders } from '@/lib/purchase';
import { forServer, readDocuments, type SentDocument } from '@/lib/read-documents';
import { useActivePurchase } from './active-purchase';

// Ассистент в окне чата: вопросы к ИИ. Открыта закупка — отвечает по её документам, а переписка хранится в ней
// (purchase.chat, тот же формат, что в приложении на Next). Закупки нет — общие вопросы по 44-ФЗ и 223-ФЗ, документы
// можно приложить к разговору. Ответы приходят потоком: сервер — /api/chat из папки web, разбор потока — web/src/lib/chat-stream.ts.

export type Msg = { id: string; role: 'user' | 'assistant'; text: string; files?: string[]; date?: string };
export type Status = 'idle' | 'reading' | 'waiting' | 'streaming';

const textOf = (m: ChatMessage) => m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
const toMsg = (m: ChatMessage): Msg => ({
  id: m.id,
  role: m.role === 'user' ? 'user' : 'assistant',
  text: textOf(m),
  files: m.metadata?.files?.length ? m.metadata.files : undefined,
  date: m.metadata?.date,
});
const toChat = (m: Msg): ChatMessage => ({
  id: m.id,
  role: m.role,
  parts: [{ type: 'text', text: m.text }],
  metadata: { ...(m.date && { date: m.date }), ...(m.files && { files: m.files }) },
});

const fmtChars = (n: number) => `${n.toLocaleString('ru-RU')} знаков`;

export function useAssistant() {
  const active = useActivePurchase();
  const key = active?.purchase.id ?? 'general';
  // Переписка по ключу: у каждой закупки своя, общая — отдельно. Закупка, которую ещё не трогали, берёт сохранённую.
  const [byKey, setByKey] = useState<Record<string, Msg[]>>({});
  // Документы общего разговора; в закупке — её собственные.
  const [documents, setDocuments] = useState<SentDocument[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const messages = byKey[key] ?? (active ? (active.purchase.chat ?? []).map(toMsg) : []);

  async function send(text: string, files: File[] = []) {
    const question = text.trim();
    if (status !== 'idle' || !question) return;
    setError(null);
    setNotice(null);
    const k = key;
    const purchase = active;
    const base = messages;
    let docs: SentDocument[] = purchase ? purchase.documents : documents;
    let attached: string[] = [];

    if (!purchase && files.length > 0) {
      setStatus('reading');
      try {
        const result = await readDocuments(files);
        attached = result.documents.map((d) => d.name);
        const replaced = new Set(attached);
        docs = [...documents.filter((d) => !replaced.has(d.name)), ...result.documents];
        setDocuments(docs);
        if (result.failed.length) setNotice(`Не прочитаны: ${result.failed.map((f) => `${f.name} — ${f.reason}`).join('; ')}.`);
      } catch (e) {
        setNotice(errorMessage(e));
        setStatus('idle');
        return;
      }
    }

    const total = docs.reduce((sum, d) => sum + d.text.length, 0);
    if (total > MAX_CONTEXT_CHARS) {
      setNotice(`Документы слишком большие: ${fmtChars(total)} при лимите ${fmtChars(MAX_CONTEXT_CHARS)} — уберите лишние файлы.`);
      setStatus('idle');
      return;
    }

    const user: Msg = { id: crypto.randomUUID(), role: 'user', text: question, files: attached.length ? attached : undefined, date: new Date().toLocaleDateString('ru-RU') };
    const reply: Msg = { id: crypto.randomUUID(), role: 'assistant', text: '' };
    setByKey((s) => ({ ...s, [k]: [...base, user, reply] }));
    setStatus('waiting');
    const controller = new AbortController();
    abort.current = controller;
    let answer = '';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: aiHeaders(purchase?.purchase.id),
        body: JSON.stringify({ messages: [...base, user].map(toChat), documents: forServer(docs), general: !purchase }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(await errorText(res, 'Не удалось получить ответ.'));
      setStatus('streaming');
      for await (const event of streamEvents(res)) {
        if (event.type === 'text-delta' && event.delta) {
          answer += event.delta;
          const now = answer;
          setByKey((s) => ({ ...s, [k]: (s[k] ?? []).map((m) => (m.id === reply.id ? { ...m, text: now } : m)) }));
        } else if (event.type === 'error') {
          throw new Error(event.errorText || 'Ассистент не ответил.');
        }
      }
      // Поток закончился, а текста нет: молча убрать пустой ответ — человек решит, что вопрос потерялся.
      if (!answer) throw new Error('Ассистент не ответил — задайте вопрос ещё раз.');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(errorMessage(e));
    } finally {
      abort.current = null;
      setStatus('idle');
      // Пустой ответ не оставляем; переписку запоминаем в закупке.
      const finished = [...base, user, ...(answer ? [{ ...reply, text: answer }] : [])];
      setByKey((s) => ({ ...s, [k]: finished }));
      purchase?.update({ chat: finished.map(toChat) });
    }
  }

  return {
    mode: active ? ('purchase' as const) : ('general' as const),
    purchase: active?.purchase ?? null,
    messages,
    documents,
    removeDocument: (name: string) => setDocuments((ds) => ds.filter((d) => d.name !== name)),
    status,
    error,
    notice,
    send,
    stop: () => abort.current?.abort(),
  };
}
