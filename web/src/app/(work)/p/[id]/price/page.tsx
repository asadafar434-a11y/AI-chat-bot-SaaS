"use client";

import { useState, type ReactNode } from "react";
import { CheckIcon, WarningIcon } from "@/components/icons";
import { Island } from "@/components/island";
import { Note } from "@/components/note";
import { PriceScale } from "@/components/price-scale";
import { usePurchase } from "@/components/purchase-provider";
import { StepIntro, TabBody } from "@/components/purchase-view";
import { calcFor, dropText, pctText, rub, rubShort } from "@/lib/price-calc";
import {
  GOOD_FAITH_LIMIT,
  priceFloor,
  raisedPct,
  readRequirements,
  type Breakdown,
  type Floor,
  type FloorKind,
  type PriceCalc,
  type SecurityMethod,
} from "@/lib/price-floor";
import { plural } from "@/lib/plural";
import { parseRubles } from "@/lib/rub-words";

function parseNumber(text: string): number | null {
  const cleaned = text.replace(/\s/g, "").replace(",", ".");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

const showNumber = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : value.toLocaleString("ru-RU", { maximumFractionDigits: 2 }).replace(/[\u00a0\u202f]/g, " ");

// Поле для числа: набранный текст остаётся как есть, наружу уходит число или null, если поле пустое.
// Число, поменявшееся снаружи (ползунком), — переписывает поле.
function NumberField({ id, label, unit, hint, value, onChange }: {
  id: string;
  label: string;
  unit: string;
  hint?: ReactNode;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [text, setText] = useState(() => showNumber(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (parseNumber(text) !== value) setText(showNumber(value));
  }
  return (
    <div className="grid content-start gap-1">
      <label htmlFor={id} className="t-strong">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onChange(parseNumber(e.target.value));
          }}
          onBlur={() => setText(showNumber(parseNumber(text)))}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="field max-w-44 font-mono tabular-nums"
        />
        <span className="text-[var(--ink-3)]">{unit}</span>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="t-caption text-[var(--ink-3)]">
          {hint}
        </p>
      )}
    </div>
  );
}

function Check({ id, checked, onChange, label, hint }: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5 gap-y-0.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-0.5 size-4 accent-[var(--brand)]"
      />
      <label htmlFor={id} className="cursor-pointer text-foreground">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="t-caption col-start-2 text-[var(--ink-3)]">
          {hint}
        </p>
      )}
    </div>
  );
}

const METHODS: { key: SecurityMethod; label: string }[] = [
  { key: "guarantee", label: "Независимая гарантия" },
  { key: "money", label: "Свои деньги" },
];

function MethodPicker({ method, onChange }: { method: SecurityMethod; onChange: (method: SecurityMethod) => void }) {
  return (
    <fieldset>
      <legend className="t-strong mb-1.5">Чем обеспечите</legend>
      <div className="flex flex-wrap gap-1.5">
        {METHODS.map(({ key, label }) => (
          <label
            key={key}
            className={`t-strong flex min-h-8 cursor-pointer items-center rounded-[var(--r-pill)] px-3.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--brand)] ${
              method === key ? "bg-primary text-primary-foreground" : "bg-[var(--paper-2)] hover:bg-[var(--paper-3)]"
            }`}
          >
            <input type="radio" name="price-method" checked={method === key} onChange={() => onChange(key)} className="sr-only" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// Что останется по вашей цене, а пока её нет — по начальной.
function Profit({ b, byNmck }: { b: Breakdown; byNmck: boolean }) {
  const loss = b.profit < 0;
  return (
    <div aria-live="polite" className="grid content-start gap-0.5">
      <span className="t-strong">{byNmck ? "По начальной цене" : "По вашей цене"}</span>
      <span className="flex items-center gap-1.5">
        {loss ? <WarningIcon className="size-4 text-[var(--danger)]" /> : <CheckIcon className="size-4 text-[var(--ok)]" strokeWidth={2.5} />}
        <span className="text-[var(--ink-2)]">{loss ? "убыток" : "прибыль"}</span>
        <span className="[font:600_16px/24px_var(--mono)] tabular-nums">{rubShort(Math.abs(b.profit))}</span>
      </span>
      {Math.abs(b.profit) >= 0.5 && <span className="t-caption text-[var(--ink-3)]">{pctText(Math.round((Math.abs(b.profit) / b.price) * 1000) / 10)} % цены</span>}
    </div>
  );
}

type Row = { label: string; note?: string; cell: (b: Breakdown) => ReactNode; sub?: (b: Breakdown) => ReactNode; strong?: boolean };

// Из чего складывается цена: нижняя и, если вписана, ваша — рядом, чтобы видеть разницу.
function PriceTable({ cols, rows }: { cols: { title: string; b: Breakdown }[]; rows: Row[] }) {
  return (
    <table className="w-full max-w-xl border-collapse">
      <thead>
        <tr>
          <td />
          {cols.map((col) => (
            <th key={col.title} scope="col" className="t-caption pb-1 pl-3 text-right font-medium text-[var(--ink-3)]">
              {col.title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--line)]">
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row" className={`py-2 pr-3 text-left align-top ${row.strong ? "t-strong" : "font-medium text-[var(--ink-2)]"}`}>
              {row.label}
              {row.note && <span className="t-caption block text-[var(--ink-3)]">{row.note}</span>}
            </th>
            {cols.map((col) => {
              const sub = row.sub?.(col.b);
              return (
                <td key={col.title} className="py-2 pl-3 text-right align-top">
                  <span className={`block whitespace-nowrap font-mono tabular-nums ${row.strong ? "font-semibold" : ""}`}>{row.cell(col.b)}</span>
                  {sub && <span className="t-caption block text-[var(--ink-3)]">{sub}</span>}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Ответ экрана — плавающим островом внизу, как «Скачать ТП»: виден, пока правите расходы и обеспечение.
// unpriced — обеспечение есть, но ставка или срок не вписаны: его стоимость в цену не вошла.
function Result({ calc, floor, atFloor, unpriced }: { calc: PriceCalc; floor: Floor; atFloor: Breakdown | null; unpriced: boolean }) {
  const raised = raisedPct(calc.securityPct ?? 0);
  const why: Record<FloorKind, string> = {
    plain: "Ниже — контракт в убытке.",
    antiDumping: `Ниже — убыток. При таком снижении обеспечение — ${pctText(raised)} % вместо ${pctText(calc.securityPct ?? 0)} % (ст. 37).`,
    threshold: `Снизите на 25 % и больше — обеспечение вырастет до ${pctText(raised)} % (ст. 37), и контракт уйдёт в убыток.`,
  };
  const unpricedNote = unpriced ? " Стоимость обеспечения не учтена — впишите ставку и срок." : "";

  let body: ReactNode;
  if (!floor.ok && floor.reason === "input") {
    body = (
      <p className="text-[var(--ink-2)]">
        Впишите {calc.nmck ? "себестоимость" : "начальную цену и себестоимость"} — посчитаю, до какой цены можно снижаться.
      </p>
    );
  } else if (!floor.ok) {
    body = <p className="t-strong text-[var(--warn)]">Налог и стоимость обеспечения съедают всю цену — проверьте проценты.</p>;
  } else if (floor.aboveNmck || !atFloor) {
    body = (
      <>
        <p className="t-strong text-[var(--warn)]">Даже по начальной цене контракт в убытке</p>
        <p className="text-[var(--ink-2)]">
          Без убытка — только от {rub(floor.price)}, а начальная цена — {rub(calc.nmck ?? 0)}.
        </p>
      </>
    );
  } else {
    body = (
      <>
        <p className="t-caption text-[var(--ink-3)]">Можно снижаться до</p>
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="[font:600_16px/24px_var(--mono)] tabular-nums">{rub(floor.price)}</span>
          <span className="text-[var(--ink-2)]">— на {dropText(atFloor.drop)} % ниже начальной</span>
        </p>
        <p className="t-caption text-[var(--ink-3)]">
          {why[floor.kind]}
          {unpricedNote}
        </p>
      </>
    );
  }

  return (
    <div className="sticky -bottom-2 z-[5] -mx-2 -mb-2 mt-auto bg-[linear-gradient(to_top,var(--canvas)_8px,transparent_8px)] px-2 pb-2 pt-2">
      <div aria-live="polite" className="island grid gap-0.5 px-[var(--pad)] py-3 shadow-[var(--float)]">
        {body}
      </div>
    </div>
  );
}

export default function PricePage() {
  const { purchase, update } = usePurchase();
  const nmckFound = parseRubles(purchase.price);
  const found = readRequirements(purchase);
  const calc = calcFor(purchase);
  const set = (patch: Partial<PriceCalc>) => update({ priceCalc: { ...purchase.priceCalc, ...patch } });

  const { floor, at, raisedBelow } = priceFloor(calc);
  const atFloor = floor.ok ? at(floor.price) : null;
  const mine = calc.price ? at(calc.price) : null;
  const shown = mine ?? (calc.nmck ? at(calc.nmck) : null);
  const above = calc.nmck !== null && calc.price !== null && calc.price > calc.nmck;
  const guarantee = calc.method === "guarantee";
  const secured = (calc.securityPct ?? 0) > 0 && !(calc.smeOnly && calc.exempt);
  const ratePct = guarantee ? calc.guaranteeRatePct : calc.moneyRatePct;
  const rated = (ratePct ?? 0) > 0 && (calc.days ?? 0) > 0;
  const small = calc.nmck !== null && calc.nmck <= GOOD_FAITH_LIMIT;
  const big = calc.nmck !== null && calc.nmck > GOOD_FAITH_LIMIT;
  const is223 = /223/.test(purchase.kind);
  const rule = purchase.tp?.antiDumping?.rule;

  const rows: Row[] = [
    { label: "Цена", cell: (b) => rub(b.price), strong: true },
    { label: "Снижение", cell: (b) => (b.drop >= 0 ? `${dropText(b.drop)} %` : "выше начальной") },
    { label: "Себестоимость", cell: (b) => rub(b.costs) },
    ...((calc.extra ?? 0) > 0 ? [{ label: "Расходы на участие", cell: (b: Breakdown) => rub(b.extra) }] : []),
    ...((calc.taxPct ?? 0) > 0 ? [{ label: `Налог ${pctText(calc.taxPct ?? 0)} %`, cell: (b: Breakdown) => rub(b.tax) }] : []),
    ...(secured
      ? [
          {
            label: "Обеспечение",
            note: rated
              ? `${guarantee ? "гарантия" : "свои деньги"}, ${pctText(ratePct ?? 0)} % годовых, ${calc.days} ${plural(calc.days ?? 0, "день", "дня", "дней")}`
              : "впишите ставку и срок",
            cell: (b: Breakdown) => (rated ? rub(b.securityCost) : "не учтено"),
            sub: (b: Breakdown) => `на ${rub(b.security)} (${pctText(b.securityPct)} %)`,
          },
        ]
      : []),
    {
      label: "Прибыль",
      cell: (b) => <span className={b.profit < 0 ? "text-destructive" : ""}>{rub(b.profit)}</span>,
      sub: (b) => (Math.abs(b.profit) >= 0.5 ? `${pctText(Math.round((b.profit / b.price) * 1000) / 10)} % цены` : null),
      strong: true,
    },
  ];
  const cols = [...(atFloor ? [{ title: "Нижняя", b: atFloor }] : []), ...(mine ? [{ title: "Ваша", b: mine }] : [])];

  return (
    <>
      <TabBody>
        <StepIntro>
          До какой цены можно снижаться на торгах, чтобы контракт не ушёл в убыток. Учитываю расходы, налог, стоимость обеспечения
          исполнения и антидемпинговые меры 44-ФЗ. Считается прямо в браузере — цифры никуда не отправляются.
        </StepIntro>

        <Island id="price-scale" level={3} title="Где убыток, где прибыль" sub="Двигайте ползунок или впишите цену — покажу, что останется">
          <div className="grid gap-4 px-[var(--pad)] pb-4 pt-1">
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <NumberField
                id="price-offer"
                label="Ваша цена"
                unit="₽"
                value={calc.price}
                onChange={(price) => set({ price })}
                hint={
                  above ? (
                    <span className="text-[var(--warn)]">Выше начальной — такую заявку отклонят</span>
                  ) : calc.price !== null && calc.nmck ? (
                    `На ${dropText(1 - calc.price / calc.nmck)} % ниже начальной`
                  ) : (
                    "Сколько хотите предложить на торгах"
                  )
                }
              />
              {shown && <Profit b={shown} byNmck={!mine} />}
            </div>
            {calc.nmck ? (
              <PriceScale
                nmck={calc.nmck}
                floor={floor}
                raisedBelow={raisedBelow}
                raisedPct={raisedPct(calc.securityPct ?? 0)}
                at={at}
                price={calc.price}
                onPrice={(price) => set({ price })}
              />
            ) : (
              <p className="text-[var(--ink-3)]">Впишите начальную цену — нарисую шкалу.</p>
            )}
          </div>
        </Island>

        <Island id="price-costs" level={3} title="Цена и расходы" sub={purchase.sample ? "В примере — вымышленные расходы" : undefined}>
          <div className="@container px-[var(--pad)] pb-4 pt-1">
            <div className="grid gap-4 @min-[520px]:grid-cols-2">
              <NumberField
                id="price-nmck"
                label="Начальная цена"
                unit="₽"
                value={calc.nmck}
                onChange={(nmck) => set({ nmck })}
                hint={nmckFound ? "Из сведений о закупке" : "В документах не нашлась — впишите из извещения"}
              />
              <NumberField
                id="price-own-costs"
                label="Себестоимость исполнения"
                unit="₽"
                value={calc.costs}
                onChange={(costs) => set({ costs })}
                hint="Всё, что потратите на исполнение: товар, работа, аренда, доставка"
              />
              <NumberField
                id="price-extra"
                label="Расходы на участие"
                unit="₽"
                value={calc.extra}
                onChange={(extra) => set({ extra })}
                hint="Обеспечение заявки, плата площадке, дорога — всё, что заплатите за участие"
              />
              <NumberField
                id="price-tax"
                label="Налог с выручки"
                unit="%"
                value={calc.taxPct}
                onChange={(taxPct) => set({ taxPct })}
                hint="Например, 6 на УСН «доходы». Налог с прибыли не вписывайте: на нижней цене прибыли нет"
              />
            </div>
          </div>
        </Island>

        <Island
          id="price-security"
          level={3}
          title="Обеспечение исполнения"
          sub="Гарантия банка или замороженные деньги тоже стоят денег — учту это в цене"
        >
          <div className="@container grid gap-4 px-[var(--pad)] pb-4 pt-1">
            <NumberField
              id="price-security-pct"
              label="Размер"
              unit="%"
              value={calc.securityPct}
              onChange={(securityPct) => set({ securityPct })}
              hint={
                found.securityLine
                  ? `В требованиях: ${found.securityLine}`
                  : "В требованиях не нашёл — посмотрите в извещении. Если обеспечения нет, оставьте пустым"
              }
            />
            <Check
              id="price-sme"
              checked={calc.smeOnly}
              onChange={(smeOnly) => set({ smeOnly })}
              label="Закупка только у малого бизнеса и социально ориентированных НКО"
              hint="Тогда обеспечение считается от цены контракта, а не от начальной (ч. 6.2 ст. 96 44-ФЗ)"
            />
            {calc.smeOnly && (
              <Check
                id="price-exempt"
                checked={calc.exempt}
                onChange={(exempt) => set({ exempt })}
                label="Освобождены от обеспечения: за три года — три контракта без неустоек на сумму не меньше начальной цены"
                hint="Сведения из реестра контрактов подаёте до заключения контракта (ч. 8.1 ст. 96 44-ФЗ)"
              />
            )}
            {secured && (
              <>
                <MethodPicker method={calc.method} onChange={(method) => set({ method })} />
                <div className="grid gap-4 @min-[520px]:grid-cols-2">
                  <NumberField
                    key={calc.method}
                    id="price-rate"
                    label={guarantee ? "Комиссия банка" : "Сколько стоят ваши деньги"}
                    unit="% годовых"
                    value={ratePct}
                    onChange={(value) => set(guarantee ? { guaranteeRatePct: value } : { moneyRatePct: value })}
                    hint={guarantee ? "Процент в год от суммы гарантии — по тарифу банка" : "Ставка кредита, если берёте в долг, или вклада, если деньги свои"}
                  />
                  <NumberField
                    id="price-days"
                    label={guarantee ? "Срок гарантии" : "Сколько дней деньги у заказчика"}
                    unit="дней"
                    value={calc.days}
                    onChange={(days) => set({ days })}
                    hint={
                      guarantee
                        ? "Срок исполнения контракта и ещё не меньше месяца (ч. 3 ст. 96 44-ФЗ)"
                        : "Срок исполнения и до 30 дней на возврат, в закупке у малого бизнеса — до 15 (ч. 27 ст. 34 44-ФЗ)"
                    }
                  />
                </div>
              </>
            )}
          </div>
        </Island>

        <Island id="price-dumping" level={3} title="Антидемпинговые меры" sub="Статья 37 44-ФЗ — на конкурсе и аукционе">
          <div className="grid gap-4 px-[var(--pad)] pb-4 pt-1">
            <Check
              id="price-anti-dumping"
              checked={calc.antiDumping}
              onChange={(antiDumping) => set({ antiDumping })}
              label="Учитывать антидемпинговые меры"
              hint={`Снизите цену на 25 % и больше — обеспечение нужно в полтора раза больше обычного, но не меньше 10 % ${
                calc.smeOnly ? "цены контракта" : "начальной цены"
              } (ч. 1 ст. 37).${
                is223 ? " Закупка по 223-ФЗ: такие меры — в положении о закупке заказчика; включите, если правила там те же." : ""
              }`}
            />
            {calc.antiDumping && small && secured && (
              <Check
                id="price-good-faith"
                checked={calc.goodFaith}
                onChange={(goodFaith) => set({ goodFaith })}
                label="Подтвержу добросовестность: за три года — три контракта без неустоек, один из них — не меньше 20 % начальной цены"
                hint="Тогда хватит обычного обеспечения. Сведения из реестра контрактов подаёте вместе с подписанным проектом контракта (ч. 2, 3 и 5 ст. 37)"
              />
            )}
            {calc.antiDumping && big && secured && (
              <p className="t-caption text-[var(--ink-3)]">
                Начальная цена больше 15 млн ₽ — заменить повышенное обеспечение подтверждением добросовестности нельзя (ч. 1 ст. 37).
              </p>
            )}
            {calc.antiDumping && !secured && (
              <p className="t-caption text-[var(--ink-3)]">
                {calc.smeOnly && calc.exempt
                  ? "Вы освобождены от обеспечения, в том числе от повышенного (ч. 8.1 ст. 96), — на цену эти меры не влияют."
                  : "Обеспечения исполнения нет — повышать нечего, на цену эти меры не влияют."}
              </p>
            )}
            {rule && <Note tone="info">В документах закупки: {rule}</Note>}
          </div>
        </Island>

        {cols.length > 0 && (
          <Island id="price-table" level={3} title="Из чего складывается цена" sub="Нижняя цена и ваша — рядом, чтобы видеть разницу">
            <div className="grid gap-3 px-[var(--pad)] pb-4 pt-1">
              <PriceTable cols={cols} rows={rows} />
              <p className="t-caption text-[var(--ink-3)]">Прибыль — до налога с прибыли, если вы его платите.</p>
            </div>
          </Island>
        )}
      </TabBody>

      <Result calc={calc} floor={floor} atFloor={atFloor} unpriced={secured && !rated} />
    </>
  );
}
