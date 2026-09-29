import { useEffect, useRef, useState } from 'react';
import { X, Send, Paperclip, ImageIcon, FileText, UserCheck } from '../lib/icons';
import { AIDisclaimer, IconButton, cx } from './ui';
import { BotMark } from './BotMark';

type Msg = { role: 'user' | 'ai'; text: string; file?: { name: string; kind: 'image' | 'doc' } };

// Ответ специалиста по заявке — приходит и в чат, отдельным сообщением от юриста.
export type ExpertNote = { id: string; title: string; text: string };

const suggestions = [
  'Почему могут отклонить заявку?',
  'Что такое обеспечение заявки?',
  'Насколько снижать цену?',
  'Зачем нужен сертификат соответствия?',
];

function aiReply(q: string): string {
  const t = q.toLowerCase();
  if (t.includes('сертификат'))
    return 'Сертификат соответствия подтверждает, что товар отвечает техрегламентам (п. 5 ТЗ). Это отдельный документ от органа по сертификации — ИИ не может создать его сам, поэтому на шаге «Проверка» его нужно приложить. Без него заявку отклонят: нет документа, который требует извещение (п. 1 ч. 12 ст. 48 44-ФЗ).';
  if (t.includes('обеспеч'))
    return 'Обеспечение заявки — сумма, которую площадка блокирует на спецсчёте, или независимая гарантия банка. Здесь — 42 800 ₽, 1% НМЦК: по ч. 2 ст. 44 44-ФЗ при НМЦК до 20 млн — от 0,5 до 1%. Если денег на спецсчёте нет к подаче, заявку не примут.';
  if (t.includes('цен') || t.includes('сниж') || t.includes('демпинг'))
    return 'На шаге «Цена» видно, до какой цены можно снижаться без убытка — по вашим расходам, налогу и стоимости обеспечения. Снижение на 25% и больше — антидемпинговые меры ст. 37 44-ФЗ: обеспечение исполнения в 1,5 раза больше или сведения о добросовестности.';
  if (t.includes('отклон') || t.includes('риск'))
    return 'Частые причины отклонения: отсутствует обязательный документ (сертификат), не подтверждено обеспечение, неполные характеристики товара по ТЗ. Все найденные «слепые зоны» показаны на шаге «Проверка» с пояснением, почему и как исправить.';
  if (t.includes('срок') || t.includes('дедлайн') || t.includes('когда'))
    return 'Подача заявки по этой закупке — до 14 окт 2026, 10:00 МСК. Рекомендую закрыть все слепые зоны минимум за сутки, чтобы успеть подтвердить обеспечение в банке.';
  if (t.includes('специалист') || t.includes('юрист') || t.includes('проверк'))
    return 'На шаге «Пакет» можно отправить готовый комплект тендерному юристу за 500 ₽. Он вручную сверит документы с извещением и даст заключение в течение 2 часов. Ответ придёт сюда, в шапку закупки и в список закупок.';
  return 'Я помогаю по подаче заявок на 44-ФЗ: разбор документации, состав пакета, цена и риски отклонения. Уточните вопрос — например, про сертификат, обеспечение заявки или снижение цены.';
}

export function ChatAssistant({
  open,
  setOpen,
  notes = [],
  onOpenNote,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  notes?: ExpertNote[];
  onOpenNote?: (id: string) => void;
}) {
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: 'ai',
      text: 'Здравствуйте! Я ИИ-ассистент по тендерам: разберу документы закупки и отвечу на вопросы по заявке. Чем помочь?',
    },
  ]);
  const [attachedFile, setAttachedFile] = useState<{ name: string; kind: 'image' | 'doc' } | null>(null);
  // Сколько ответов специалиста человек уже видел в чате — точка на кнопке только для новых.
  const [seen, setSeen] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, typing, open, notes.length]);

  useEffect(() => {
    if (open) setSeen(notes.length);
  }, [open, notes.length]);

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
      {/* Кнопка чата — робот ИИ-ассистента; при открытом чате — крестик */}
      <div className="group/fab fixed bottom-5 right-5 z-40">
        {!open && (
          <span className="animate-tip pointer-events-none absolute right-full top-1/2 mr-3 hidden -translate-y-1/2 whitespace-nowrap rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground shadow-xl group-hover/fab:block">
            Спросить ИИ
          </span>
        )}
        <button
          onClick={() => setOpen(!open)}
          className={cx(
            'relative flex size-14 items-center justify-center outline-none transition-transform duration-300 ease-out hover:-translate-y-0.5 active:translate-y-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            open ? 'bg-brand-gradient rounded-full text-white shadow-lg' : 'animate-bot-glow rounded-2xl',
          )}
          aria-label={open ? 'Закрыть чат' : 'Спросить ИИ'}
        >
          {open ? <X className="size-5" /> : <BotMark live className="size-14" />}
          {!open && notes.length > seen && (
            <span className="absolute right-0 top-1.5 size-3 rounded-full bg-danger ring-2 ring-background" />
          )}
        </button>
      </div>

      {/* Panel — anchored top-right */}
      {open && (
        <div className="animate-fade-up fixed right-4 top-4 z-40 flex h-[560px] max-h-[calc(100vh-2rem)] w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
          {/* Header with explicit close */}
          <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
            <BotMark className="size-8 shrink-0" />
            <div className="flex-1 leading-none">
              <p className="text-sm font-semibold">ИИ-ассистент</p>
              <p className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                <span className="inline-block size-1.5 rounded-full bg-success" /> на связи
              </p>
            </div>
            <IconButton label="Закрыть чат" onClick={() => setOpen(false)} side="bottom" align="end">
              <X className="size-4" />
            </IconButton>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {msgs.map((m, i) => (
              <div key={i} className={`flex items-end gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'ai' && <BotMark className="size-6 shrink-0" />}
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
            {notes.map((n) => (
              <div key={n.id} className="rounded-2xl rounded-bl-sm border border-info/40 bg-info/5 px-3.5 py-2.5 text-[13px] leading-snug">
                <p className="flex items-center gap-1.5 text-[12px] font-medium text-info">
                  <UserCheck className="size-3.5" /> Тендерный юрист · ответ по заявке
                </p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{n.title}</p>
                <p className="mt-1.5 whitespace-pre-line text-foreground">{n.text}</p>
                {onOpenNote && (
                  <button onClick={() => onOpenNote(n.id)} className="mt-2 text-[12px] font-medium underline underline-offset-2">
                    Открыть заявку
                  </button>
                )}
              </div>
            ))}
            {typing && (
              <div className="flex items-end justify-start gap-2">
                <BotMark className="size-6 shrink-0" />
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
              <div className="space-y-1.5 pl-8 pt-1">
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
            <IconButton label="Прикрепить фото, скан или документ" onClick={() => fileRef.current?.click()} align="start" className="size-9 border border-border">
              <Paperclip className="size-4" />
            </IconButton>
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
