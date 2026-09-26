"use client";

import { useState, type PointerEvent } from "react";
import { CheckIcon, WarningIcon } from "@/components/icons";
import { dropText, pctText, rubShort } from "@/lib/price-calc";
import type { Breakdown, Floor } from "@/lib/price-floor";
import { scaleModel } from "@/lib/price-scale";

// Зона убытка — бледная заливка красным, без убытка — зелёным. Цвета статусов, всегда с иконкой и подписью.
const LOSS_WASH = "bg-[color-mix(in_srgb,var(--danger)_14%,var(--paper))]";
const OK_WASH = "bg-[var(--ok-tint)]";
// Подпись у точки шкалы: у левого края прижата влево, у правого — вправо, между ними сдвигается плавно.
const anchored = (x: number) => ({ left: `${x}%`, translate: `-${x}% 0` });

type Props = {
  nmck: number;
  floor: Floor;
  raisedBelow: number | null;
  raisedPct: number;
  at: (price: number) => Breakdown | null;
  price: number | null;
  // Без onPrice шкала только показывает: в блоке на шаге «Требования».
  onPrice?: (price: number) => void;
};

// Шкала цены: от начальной цены вниз — где убыток, где прибыль и докуда обеспечение повышенное.
// Ползунок поверх — ваша цена: двигаете, и меняются прибыль, таблица и всё, что от цены зависит.
export function PriceScale({ nmck, floor, raisedBelow, raisedPct, at, price, onPrice }: Props) {
  const m = scaleModel(nmck, floor, raisedBelow);
  const [hover, setHover] = useState<number | null>(null);
  const shown = Math.min(Math.max(price ?? nmck, m.lo), m.hi);
  const mine = at(price ?? nmck);
  const hoverAt = hover === null ? null : at(hover);

  const priceUnder = (e: PointerEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return m.priceAt(((e.clientX - box.left) / box.width) * 100);
  };
  const outcome = (b: Breakdown) => `${b.profit < 0 ? "убыток" : "прибыль"} ${rubShort(Math.abs(b.profit))}`;

  return (
    <div className="grid gap-1.5">
      {/* Над дорожкой — нижняя цена, при наведении — цена под курсором */}
      <div className="relative h-5">
        {hover !== null ? (
          <p
            className="t-caption pointer-events-none absolute top-0 whitespace-nowrap rounded-md bg-[var(--paper)] px-1.5 py-0.5 shadow-[var(--float)]"
            style={anchored(m.x(hover))}
          >
            <b className="font-mono font-semibold">{rubShort(hover)}</b>
            {hoverAt && <span className="text-[var(--ink-2)]"> — {outcome(hoverAt)}</span>}
          </p>
        ) : (
          m.floorX !== null &&
          floor.ok &&
          (onPrice ? (
            <button
              type="button"
              onClick={() => onPrice(floor.price)}
              title="Поставить свою цену на нижнюю"
              className="t-caption absolute top-0 whitespace-nowrap rounded-md px-1 text-[var(--ink-2)] hover:bg-[var(--hover)]"
              style={anchored(m.floorX)}
            >
              Нижняя цена <b className="font-mono font-semibold text-foreground">{rubShort(floor.price)}</b>
            </button>
          ) : (
            <p className="t-caption absolute top-0 whitespace-nowrap text-[var(--ink-2)]" style={anchored(m.floorX)}>
              Нижняя цена <b className="font-mono font-semibold text-foreground">{rubShort(floor.price)}</b>
            </p>
          ))
        )}
      </div>

      <div
        className="relative h-8"
        onPointerMove={(e) => setHover(e.pointerType === "mouse" && e.buttons === 0 ? priceUnder(e) : null)}
        onPointerLeave={() => setHover(null)}
        onPointerDown={() => setHover(null)}
      >
        <div className="absolute inset-x-0 top-1 flex h-6 gap-0.5">
          {m.loss === "unknown" ? (
            <div className="flex-1 rounded-md bg-[var(--paper-2)]" />
          ) : (
            <>
              {m.loss !== "none" && (
                <div
                  className={`@container flex items-center rounded-l-md ${m.loss === "all" ? "flex-1 rounded-r-md" : ""} ${LOSS_WASH}`}
                  style={m.loss === "part" ? { width: `${m.floorX}%` } : undefined}
                >
                  <span className="t-tag hidden items-center gap-1 whitespace-nowrap px-2 text-[var(--ink-2)] @min-[92px]:flex">
                    <WarningIcon className="size-3.5 text-[var(--danger)]" />
                    Убыток
                  </span>
                </div>
              )}
              {m.loss !== "all" && (
                <div
                  className={`@container flex flex-1 items-center justify-end rounded-r-md ${m.loss === "none" ? "rounded-l-md" : ""} ${OK_WASH}`}
                >
                  <span className="t-tag hidden items-center gap-1 whitespace-nowrap pl-2 pr-4 text-[var(--ink-2)] @min-[124px]:flex">
                    <CheckIcon className="size-3.5 text-[var(--ok)]" strokeWidth={2.5} />
                    Без убытка
                  </span>
                </div>
              )}
            </>
          )}
        </div>
        {m.floorX !== null && <span aria-hidden className="absolute top-0 h-1 w-px bg-[var(--ink-3)]" style={{ left: `${m.floorX}%` }} />}
        {hover !== null && (
          <span aria-hidden className="pointer-events-none absolute top-1 h-6 w-px bg-[var(--ink-2)]" style={{ left: `${m.x(hover)}%` }} />
        )}
        {onPrice && (
          <input
            type="range"
            min={m.lo}
            max={m.hi}
            step={m.step}
            value={shown}
            onChange={(e) => onPrice(Number(e.currentTarget.value))}
            aria-label="Ваша цена"
            aria-valuetext={`${rubShort(shown)}, на ${dropText(1 - shown / nmck)} % ниже начальной${mine ? `, ${outcome(mine)}` : ""}`}
            className="price-range peer absolute inset-0 z-10 h-8 w-full cursor-pointer opacity-0"
          />
        )}
        {(onPrice || price !== null) && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-2 size-4 -translate-x-1/2 rounded-full bg-primary shadow-[0_1px_3px_rgb(16_18_39/.3)] ring-2 ring-[var(--paper)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--brand)]"
            style={{ left: `${m.x(shown)}%` }}
          />
        )}
      </div>

      {m.raisedX !== null && (
        <div className="h-1">
          <div className="h-1 rounded-full bg-[var(--warn)]" style={{ width: `${m.raisedX}%` }} />
        </div>
      )}

      <div className="relative h-4 text-[var(--ink-3)]">
        {m.ticks.map((t) => (
          <span key={t.label} className={`absolute top-0 whitespace-nowrap ${t.x === 100 ? "t-caption" : "t-num"}`} style={anchored(t.x)}>
            {t.label}
          </span>
        ))}
      </div>

      {(m.raisedX !== null || m.loss === "all" || m.loss === "unknown") && (
        <p className="t-caption flex flex-wrap items-center gap-x-4 gap-y-1 text-[var(--ink-3)]">
          {m.raisedX !== null && (
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-1 w-3 flex-none rounded-full bg-[var(--warn)]" />
              Снижение на 25 % и больше — обеспечение {pctText(raisedPct)} %
            </span>
          )}
          {m.loss === "all" && <span>Без убытка — только выше начальной цены</span>}
          {m.loss === "unknown" && <span>Впишите себестоимость — покажу, где начинается убыток</span>}
        </p>
      )}
    </div>
  );
}
