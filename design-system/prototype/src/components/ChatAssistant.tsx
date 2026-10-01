import { useEffect, useRef, useState } from 'react';
import { titleOf } from '@/lib/purchase';
import { ACCEPTED_FILES } from '@/lib/read-documents';
import { X, Send, Paperclip, FileText, UserCheck, AlertTriangle } from '../lib/icons';
import { AIDisclaimer, IconButton, cx } from './ui';
import { BotMark } from './BotMark';
import { Markdown } from './Markdown';
import { useAssistant } from '../real/assistant';

// Ответ специалиста по заявке — приходит и в чат, отдельным сообщением от юриста (пока специалиста нет — пусто).
export type ExpertNote = { id: string; title: string; text: string };

const SUGGESTIONS = {
  purchase: ['Какие документы нужны для заявки?', 'Какое обеспечение нужно и как его внести?', 'Что проверить в проекте контракта перед подачей?'],
  general: ['Почему могут отклонить заявку?', 'Заказчик не подписывает акт — что делать?', 'Как вернуть обеспечение заявки?', 'Что такое обеспечение заявки?'],
};

// Окно ассистента. Вид — прототипа; вопросы идут к настоящему ИИ (см. real/assistant.ts): по документам открытой закупки
// или общие — по 44-ФЗ и 223-ФЗ со ссылкой на статью.
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
  const chat = useAssistant();
  const [input, setInput] = useState('');
  const [attached, setAttached] = useState<File[]>([]);
  // Сколько ответов специалиста человек уже видел в чате — точка на кнопке только для новых.
  const [seen, setSeen] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fab = useRef<HTMLButtonElement>(null);

  // Закрытый чат возвращает фокус на кнопку, откуда его открыли: с клавиатуры иначе пришлось бы искать место заново.
  const closeChat = () => {
    setOpen(false);
    fab.current?.focus();
  };

  const busy = chat.status !== 'idle';
  const last = chat.messages.at(-1);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat.messages, chat.status, open, notes.length]);

  useEffect(() => {
    if (open) setSeen(notes.length);
  }, [open, notes.length]);

  const ask = (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const files = attached;
    setInput('');
    setAttached([]);
    void chat.send(q, files);
  };

  const place = chat.purchase ? `по закупке «${titleOf(chat.purchase)}»` : 'общие вопросы по 44-ФЗ и 223-ФЗ';
  const suggestions = SUGGESTIONS[chat.mode];

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
          ref={fab}
          onClick={() => setOpen(!open)}
          className={cx(
            'relative flex size-14 items-center justify-center outline-none transition-transform duration-300 ease-out hover:-translate-y-0.5 active:translate-y-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            open ? 'bg-brand-gradient rounded-full text-white shadow-lg' : 'animate-bot-glow rounded-2xl',
          )}
          aria-label={open ? 'Закрыть чат' : 'Спросить ИИ'}
        >
          {open ? <X className="size-5" /> : <BotMark live className="size-14" />}
          {!open && notes.length > seen && <span className="absolute right-0 top-1.5 size-3 rounded-full bg-danger ring-2 ring-background" />}
        </button>
      </div>

      {/* Panel — anchored top-right */}
      {open && (
        <div
          role="dialog"
          aria-label="ИИ-ассистент"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !e.nativeEvent.isComposing) closeChat();
          }}
          className="animate-fade-up fixed right-4 top-4 z-40 flex h-[560px] max-h-[calc(100vh-2rem)] w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        >
          {/* Header with explicit close */}
          <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
            <BotMark className="size-8 shrink-0" />
            <div className="min-w-0 flex-1 leading-none">
              <p className="text-sm font-semibold">ИИ-ассистент</p>
              <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{place}</p>
            </div>
            <IconButton label="Закрыть чат" onClick={closeChat} side="bottom" align="end">
              <X className="size-4" />
            </IconButton>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            role="log"
            aria-live="polite"
            aria-label="Переписка с ИИ-ассистентом"
            tabIndex={0}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {chat.messages.length === 0 && (
              <div className="flex items-end justify-start gap-2">
                <BotMark className="size-6 shrink-0" />
                <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-secondary px-3.5 py-2 text-[13px] leading-snug text-foreground">
                  {chat.purchase
                    ? 'Здравствуйте! Спросите о чём угодно в этой закупке — отвечу по её документам со ссылкой на пункт и статью закона.'
                    : 'Здравствуйте! Я ИИ-ассистент по тендерам. Отвечу на вопрос по 44-ФЗ и 223-ФЗ со ссылкой на статью закона. Приложите документ — отвечу и по нему.'}
                </div>
              </div>
            )}

            {chat.messages.map((m) => {
              // Пока ответ не начался — вместо пустого пузыря три точки.
              if (m.role === 'assistant' && !m.text) return null;
              return (
                <div key={m.id} className={`flex items-end gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {m.role === 'assistant' && <BotMark className="size-6 shrink-0" />}
                  <div
                    className={`max-w-[85%] break-words rounded-2xl px-3.5 py-2 text-[13px] leading-snug ${
                      m.role === 'user' ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-secondary text-foreground'
                    }`}
                  >
                    {m.files && m.files.length > 0 && (
                      <div className="mb-1.5 space-y-1">
                        {m.files.map((name) => (
                          <div key={name} className="flex items-center gap-1.5 rounded-md border border-current/20 bg-current/10 px-2 py-1 text-[11px]">
                            <FileText className="size-3.5 shrink-0" />
                            <span className="max-w-[170px] truncate">{name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {m.role === 'assistant' ? <Markdown text={m.text} /> : <span className="whitespace-pre-wrap">{m.text}</span>}
                  </div>
                </div>
              );
            })}

            {notes.map((n) => (
              <div key={n.id} className="break-words rounded-2xl rounded-bl-sm border border-info/40 bg-info/5 px-3.5 py-2.5 text-[13px] leading-snug">
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

            {(chat.status === 'reading' || chat.status === 'waiting' || (chat.status === 'streaming' && last?.role === 'assistant' && !last.text)) && (
              <div className="flex items-end justify-start gap-2">
                <BotMark className="size-6 shrink-0" />
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-secondary px-3.5 py-3">
                  <span className="flex gap-1" aria-hidden>
                    {[0, 1, 2].map((d) => (
                      <span key={d} className="size-1.5 animate-scan rounded-full bg-muted-foreground" style={{ animationDelay: `${d * 0.15}s` }} />
                    ))}
                  </span>
                  <span className="sr-only">{chat.status === 'reading' ? 'Читаю файлы…' : 'ИИ отвечает…'}</span>
                  {chat.status === 'reading' && <span className="text-[12px] text-muted-foreground">Читаю файлы…</span>}
                </div>
              </div>
            )}

            {chat.error && (
              <p className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] leading-snug text-danger">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> <span className="min-w-0 break-words">{chat.error}</span>
              </p>
            )}

            {chat.messages.length === 0 && !busy && (
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

          {/* Документы разговора и приложенные файлы — только в общем чате */}
          {chat.mode === 'general' && (chat.documents.length > 0 || attached.length > 0) && (
            <div className="space-y-1 border-t border-border px-3 py-2">
              {chat.documents.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span>В разговоре:</span>
                  {chat.documents.map((d) => (
                    <span key={d.name} className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-secondary px-2 py-1">
                      <FileText className="size-3 shrink-0" />
                      <span className="max-w-[140px] truncate">{d.name}</span>
                      <button aria-label={`Убрать ${d.name} из разговора`} onClick={() => chat.removeDocument(d.name)} className="hover:text-foreground">
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {attached.map((f) => (
                <div key={f.name} className="flex items-center gap-2 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-[12px]">
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate text-muted-foreground">{f.name}</span>
                  <button aria-label={`Убрать ${f.name}`} onClick={() => setAttached((a) => a.filter((x) => x !== f))} className="text-muted-foreground hover:text-foreground">
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {chat.notice && <p className="break-words border-t border-border px-3 py-2 text-[12px] text-warn-foreground">{chat.notice}</p>}

          {/* Input bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="flex items-center gap-2 border-t border-border p-3"
          >
            {chat.mode === 'general' && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_FILES}
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files ? [...e.target.files] : [];
                    e.target.value = '';
                    if (files.length) setAttached((a) => [...a, ...files]);
                  }}
                />
                <IconButton label="Приложить документ, скан или фото" onClick={() => fileRef.current?.click()} align="start" className="size-9 border border-border">
                  <Paperclip className="size-4" />
                </IconButton>
              </>
            )}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={chat.mode === 'purchase' ? 'Спросите про документы закупки…' : 'Задайте вопрос по закупкам…'}
              aria-label="Вопрос ИИ-ассистенту"
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-foreground focus:ring-2 focus:ring-ring/20"
            />
            {chat.status === 'streaming' || chat.status === 'waiting' ? (
              <button
                type="button"
                aria-label="Остановить ответ"
                onClick={chat.stop}
                className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground transition-colors hover:bg-secondary"
              >
                <X className="size-4" />
              </button>
            ) : (
              <button
                type="submit"
                aria-label="Отправить"
                disabled={!input.trim() || busy}
                className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Send className="size-4" />
              </button>
            )}
          </form>

          <div className="px-3 pb-2.5">
            <AIDisclaimer />
          </div>
        </div>
      )}
    </>
  );
}
