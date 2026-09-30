"use client";

import { Fragment, type ReactNode } from "react";
import { plural } from "@/lib/plural";
import type { Purchase } from "@/lib/purchase";

// Живой предпросмотр заявки, как в прототипе: текст технического предложения таким, какой он сейчас. Жёлтые места —
// что ещё нужно вписать; нажмите на место — откроется его поле слева. Вписали — место исчезает, текст встаёт на своё.
// Номер места в тексте совпадает с номером в ключе поля (lib/fields.ts: tp:good:<i>:<место>, tp:item:…, tp:consent:<место>).

const PART = /(\[[^\]]+\])/;
const IS_HOLE = /^\[[^\]]+\]$/;

function Text({
  text,
  keyOf,
  focusKey,
  onSelect,
}: {
  text: string;
  keyOf: (hole: number) => string;
  focusKey: string | null;
  onSelect: (key: string) => void;
}) {
  let hole = 0;
  return (
    <>
      {text
        .split(PART)
        .filter(Boolean)
        .map((part, i) => {
          if (!IS_HOLE.test(part)) return <Fragment key={i}>{part}</Fragment>;
          const key = keyOf(hole++);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(key)}
              title="Вписать это место"
              className={`rounded-sm bg-[var(--warn-tint)] px-0.5 text-left font-medium text-[var(--warn)] underline decoration-dotted underline-offset-2 hover:decoration-solid ${
                focusKey === key ? "ring-1 ring-[var(--warn)]" : ""
              }`}
            >
              {part}
            </button>
          );
        })}
    </>
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
  const tp = purchase.tp;
  if (!tp) return null;
  const holes = [tp.form.consent, ...tp.goods.map((g) => g.characteristics), ...tp.items.map((i) => i.offer)].reduce(
    (n, text) => n + (text.match(/\[[^\]]+\]/g)?.length ?? 0),
    0
  );

  const block = (key: string, head: ReactNode, body: ReactNode) => (
    <p key={key} className="whitespace-pre-wrap">
      <b className="font-semibold">{head}</b> {body}
    </p>
  );

  return (
    <section
      aria-label="Предпросмотр заявки"
      className="island p-0 @min-[880px]:sticky @min-[880px]:top-1 @min-[880px]:max-h-[calc(100dvh-9rem)] @min-[880px]:overflow-y-auto"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-[var(--pad)] py-2.5">
        <span className="t-over text-[var(--ink-3)]">Заявка · предпросмотр</span>
        <span className="t-caption text-[var(--ink-3)]">
          {holes > 0 ? `${holes} ${plural(holes, "место", "места", "мест")} — жёлтым` : "пустых мест нет"}
        </span>
      </div>
      <div className="grid gap-3 px-[var(--pad)] py-4">
        <p className="t-strong">{tp.form.title}</p>
        {tp.form.consent && (
          <p className="whitespace-pre-wrap text-[var(--ink-2)]">
            <Text text={tp.form.consent} keyOf={(h) => `tp:consent:${h}`} focusKey={focusKey} onSelect={onSelect} />
          </p>
        )}
        {tp.goods.map((g, i) =>
          block(
            `g${i}`,
            <>
              {g.name}
              {g.quantity && <span className="font-normal text-[var(--ink-3)]"> · {g.quantity}</span>}
            </>,
            <Text text={g.characteristics} keyOf={(h) => `tp:good:${i}:${h}`} focusKey={focusKey} onSelect={onSelect} />
          )
        )}
        {tp.items.map((it, i) =>
          block(
            `i${i}`,
            `${it.clause ? `${it.clause}. ` : ""}${it.topic}.`,
            <Text text={it.offer} keyOf={(h) => `tp:item:${i}:${h}`} focusKey={focusKey} onSelect={onSelect} />
          )
        )}
        {tp.goods.length === 0 && tp.items.length === 0 && <p className="text-[var(--ink-3)]">В ТП пока нет пунктов.</p>}
        {purchase.tpPrice ? (
          <p className="border-t border-[var(--line)] pt-3 text-[var(--ink-2)]">
            Цена: <b className="font-mono font-medium text-foreground">{purchase.tpPrice.toLocaleString("ru-RU")} ₽</b>
          </p>
        ) : null}
      </div>
    </section>
  );
}
