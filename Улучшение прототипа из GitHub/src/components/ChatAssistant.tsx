import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, Sparkles, Paperclip, ImageIcon, FileText, Trash2 } from '../lib/icons';
import { AIDisclaimer } from './ui';

type Msg = { role: 'user' | 'ai'; text: string; file?: { name: string; kind: 'image' | 'doc' } };

const suggestions = [
  'Почему могут отклонить заявку?',
  'Что такое обеспечение заявки?',
  'Насколько снижать цену?',
  'Зачем нужен сертификат соответствия?',
];

function aiReply(q: string): string {
  const t = q.toLowerCase();
  if (t.includes('сертификат'))
    return 'Сертификат соответствия подтверждает, что товар отвечает техрегламентам (п. 5 ТЗ). Это отдельный документ от органа сертификации — ИИ не может создать его сам, поэтому на шаге «Проверка» его нужно приложить вручную. Без него заявку отклонят по ч. 12 ст. 48 44-ФЗ.';
  if (t.includes('обеспеч'))
    return 'Обеспечение заявки — это сумма (здесь 214 000 ₽, 5% от НМЦК по ст. 44 44-ФЗ), которую блокируют на спецсчёте или покрывают банковской гарантией. Если к моменту подачи сумма не заблокирована — заявку не допустят.';
  if (t.includes('цен') || t.includes('сниж') || t.includes('демпинг'))
    return 'Оптимальное снижение ИИ подбирает по истории закупок заказчика (см. шаг «Цена»). Снижение свыше 25% от НМЦК включает антидемпинговые меры (ст. 37) — потребуется увеличенное обеспечение или подтверждение добросовестности.';
  if (t.includes('отклон') || t.includes('риск'))
    return 'Частые причины отклонения: отсутствует обязательный документ (сертификат), не подтверждено обеспечение, неполные характеристики товара по ТЗ. Все найденные «слепые зоны» показаны на шаге «Проверка» с пояснением, почему и как исправить.';
  if (t.includes('срок') || t.includes('дедлайн') || t.includes('когда'))
    return 'Подача заявки по этой закупке — до 14 окт 2026, 10:00 МСК. Рекомендую закрыть все слепые зоны минимум за сутки, чтобы успеть подтвердить обеспечение в банке.';
  if (t.includes('специалист') || t.includes('юрист') || t.includes('проверк'))
    return 'На шаге «Пакет» можно отправить готовый комплект тендерному юристу за 500 ₽. Он вручную сверит документы с извещением и даст заключение в течение 2 часов — полезно перед первой подачей.';
  return 'Я помогаю по подаче заявок на 44-ФЗ: разбор документации, состав пакета, цена и риски отклонения. Уточните вопрос — например, про сертификат, обеспечение заявки или снижение цены.';
}

export function ChatAssistant({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: 'ai',
      text: 'Здравствуйте! Я ИИ-ассистент по тендерам. Спрошу площадку, разберу документы и отвечу на вопросы по заявке. Чем помочь?',
    },
  ]);
  const [attachedFile, setAttachedFile] = useState<{ name: string; kind: 'image' | 'doc' } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, typing, open]);

  const ask = (text: string) => {
    const q = text.trim();
    if (!q && !attachedFile) return;
    const msg: Msg = { role: 'user', text: q || '📎 Прикреплён файл' };
    if (attachedFile) msg.file = attachedFile;
    setMsgs((m) => [...m, msg]);
    setInput('');
    setAttachedFile(null);
    setTyping(true);
    setTimeout(() => {
      const reply = attachedFile
        ? `Файл «${attachedFile.name}» получен. Анализирую содержимое — убедитесь, что документ чёткий и полностью виден. Если это сертификат или лицензия, прикрепите его на шаге «Проверка» через слепую зону «Сертификат соответствия».`
        : aiReply(q);
      setMsgs((m) => [...m, { role: 'ai', text: reply }]);
      setTyping(false);
    }, 700);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isImage = file.type.startsWith('image/');
    setAttachedFile({ name: file.name, kind: isImage ? 'image' : 'doc' });
    e.target.value = '';
  };

  return (
    <>
      {/* Launcher FAB */}
      <button
        onClick={() => setOpen(!open)}
        style={{ backgroundImage: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 45%, #3b82f6 100%)' }}
        className={`fixed bottom-5 right-5 z-40 flex size-12 items-center justify-center rounded-full text-white shadow-lg transition-all duration-500 ease-out hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 ${
          open ? '' : 'animate-glow'
        }`}
        aria-label={open ? 'Закрыть чат' : 'Спросить ИИ'}
      >
        {open ? <X className="size-5" /> : <MessageCircle className="size-5" />}
      </button>

      {/* Panel — anchored top-right */}
      {open && (
        <div className="animate-fade-up fixed right-4 top-4 z-40 flex h-[560px] max-h-[calc(100vh-2rem)] w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
          {/* Header with explicit close */}
          <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
            <div
              style={{ backgroundImage: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 45%, #3b82f6 100%)' }}
              className="flex size-7 items-center justify-center rounded-full text-white"
            >
              <Sparkles className="size-3.5" />
            </div>
            <div className="flex-1 leading-none">
              <p className="text-sm font-semibold">ИИ-ассистент</p>
              <p className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                <span className="inline-block size-1.5 rounded-full bg-success" /> на связи
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-snug ${
                    m.role === 'user'
                      ? 'rounded-br-sm bg-primary text-primary-foreground'
                      : 'rounded-bl-sm bg-secondary text-foreground'
                  }`}
                >
                  {m.file && (
                    <div className="mb-1.5 flex items-center gap-1.5 rounded-md border border-current/20 bg-current/10 px-2 py-1 text-[11px]">
                      {m.file.kind === 'image' ? (
                        <ImageIcon className="size-3.5" />
                      ) : (
                        <FileText className="size-3.5" />
                      )}
                      <span className="truncate max-w-[140px]">{m.file.name}</span>
                    </div>
                  )}
                  {m.text}
                </div>
              </div>
            ))}
            {typing && (
              <div className="flex justify-start">
                <div className="flex gap-1 rounded-2xl rounded-bl-sm bg-secondary px-3.5 py-3">
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="size-1.5 animate-scan rounded-full bg-muted-foreground"
                      style={{ animationDelay: `${d * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            )}

            {msgs.length <= 1 && !typing && (
              <div className="space-y-1.5 pt-1">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-left text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Attached file preview */}
          {attachedFile && (
            <div className="flex items-center gap-2 border-t border-border px-3 py-2">
              <div className="flex flex-1 items-center gap-2 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-[12px]">
                {attachedFile.kind === 'image' ? (
                  <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1 truncate text-muted-foreground">{attachedFile.name}</span>
                <button
                  onClick={() => setAttachedFile(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Input bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="flex items-center gap-2 border-t border-border p-3"
          >
            {/* Hidden file input */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.pdf,.doc,.docx"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              title="Прикрепить фото, скан или документ"
              className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Paperclip className="size-4" />
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Задайте вопрос…"
              className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-foreground focus:ring-2 focus:ring-ring/20"
            />
            <button
              type="submit"
              disabled={!input.trim() && !attachedFile}
              className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Send className="size-4" />
            </button>
          </form>

          <div className="px-3 pb-2.5">
            <AIDisclaimer />
          </div>
        </div>
      )}
    </>
  );
}
