import { Fragment, type ReactNode } from 'react';
import { rowsOf } from '@/lib/cast';
import type { Purchase } from '@/lib/purchase';
import { Card } from './ui';
import { Eye } from '../lib/icons';

// Живой предпросмотр заявки, как в прототипе: текст технического предложения таким, какой он сейчас. Жёлтые места —
// что ещё нужно вписать; нажмите на место — откроется его поле слева. Вписали — место исчезает, текст встаёт на своё.
// Номер места в тексте совпадает с номером в ключе поля (tp:good:<i>:<место>, tp:item:…, tp:consent:<место>).
const PART = /(\[[^\]]+\])/;
const IS_HOLE = /^\[[^\]]+\]$/;

// Текст с жёлтыми местами «[…]». С onSelect место — кнопка (открывает своё поле); без него — просто отметка,
// как в окне просмотра шага «Пакет», где текст уже не правят.
export function MarkedText({
  text,
  keyOf,
  focusKey = null,
  onSelect,
}: {
  text: string;
  keyOf?: (hole: number) => string;
  focusKey?: string | null;
  onSelect?: (key: string) => void;
}) {
  let hole = 0;
  return (
    <>
      {text
        .split(PART)
        .filter(Boolean)
        .map((part, i) => {
          if (!IS_HOLE.test(part)) return <Fragment key={i}>{part}</Fragment>;
          const n = hole++;
          const key = keyOf?.(n);
          if (!onSelect || !key) return <mark key={i} className="highlight rounded-sm">{part}</mark>;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(key)}
              title="Вписать это место"
              className={`highlight cursor-pointer rounded-sm text-left underline decoration-dotted underline-offset-2 hover:decoration-solid ${
                focusKey === key ? 'ring-1 ring-warn' : ''
              }`}
            >
              {part}
            </button>
          );
        })}
    </>
  );
}

// Сам текст заявки: форма, товары, пункты ТЗ и состав исполнителей. Показывается и справа от карты полей, и в окне
// просмотра на шаге «Пакет».
export function ApplicationText({
  purchase,
  focusKey = null,
  onSelect,
}: {
  purchase: Purchase;
  focusKey?: string | null;
  onSelect?: (key: string) => void;
}) {
  const tp = purchase.tp;
  if (!tp) return null;
  const marked = (text: string, keyOf: (hole: number) => string) => (
    <MarkedText text={text} keyOf={keyOf} focusKey={focusKey} onSelect={onSelect} />
  );

  const block = (key: string, head: ReactNode, body: ReactNode) => (
    <p key={key} className="whitespace-pre-wrap">
      <b className="font-semibold">{head}</b> {body}
    </p>
  );
  const cast = tp.cast;

  return (
    <div className="space-y-3 text-[13px] leading-relaxed">
      <p className="font-semibold">{tp.form.title}</p>
      {tp.form.consent && (
        <p className="whitespace-pre-wrap text-muted-foreground">{marked(tp.form.consent, (h) => `tp:consent:${h}`)}</p>
      )}
      {tp.goods.map((g, i) =>
        block(
          `g${i}`,
          <>
            {g.name}
            {g.quantity && <span className="font-normal text-muted-foreground"> · {g.quantity}</span>}
          </>,
          marked(g.characteristics, (h) => `tp:good:${i}:${h}`),
        ),
      )}
      {tp.items.map((it, i) =>
        block(`i${i}`, `${it.clause ? `${it.clause}. ` : ''}${it.topic}.`, marked(it.offer, (h) => `tp:item:${i}:${h}`)),
      )}
      {tp.goods.length === 0 && tp.items.length === 0 && <p className="text-muted-foreground">В ТП пока нет пунктов.</p>}
      {cast && cast.rows.length > 0 && (
        <div>
          <p className="font-semibold">Состав исполнителей{cast.clause ? ` (п. ${cast.clause})` : ''}</p>
          <ul className="mt-1 space-y-0.5">
            {cast.groups.flatMap((g) =>
              rowsOf(cast, g.key).map((r) => (
                <li key={r.id}>
                  <span className="text-muted-foreground">{g.one} — </span>
                  {r.name.trim() ? r.name.trim() : <mark className="highlight rounded-sm">[ФИО]</mark>}
                  {g.rank !== 'none' && (
                    <>
                      {', '}
                      {r.title.trim() ? r.title.trim() : <mark className="highlight rounded-sm">[звание]</mark>}
                    </>
                  )}
                </li>
              )),
            )}
          </ul>
        </div>
      )}
      {purchase.tpPrice ? (
        <p className="border-t border-border pt-3 text-[12px] text-muted-foreground">
          Цена: <b className="font-mono font-medium text-foreground">{purchase.tpPrice.toLocaleString('ru-RU')} ₽</b>
        </p>
      ) : null}
    </div>
  );
}

export function ApplicationPreview({
  purchase,
  focusKey,
  onSelect,
}: {
  purchase: Purchase;
  focusKey: string | null;
  onSelect: (key: string) => void;
}) {
  if (!purchase.tp) return null;
  return (
    <Card className="p-0 lg:sticky lg:top-4 lg:h-fit lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Заявка · предпросмотр</span>
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
          <Eye className="size-3" /> живой
        </span>
      </div>
      <div className="p-5">
        <ApplicationText purchase={purchase} focusKey={focusKey} onSelect={onSelect} />
      </div>
    </Card>
  );
}
