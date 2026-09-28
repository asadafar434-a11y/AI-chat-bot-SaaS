"use client";

import Link from "next/link";
import { CalculatorIcon } from "@/components/icons";
import { PriceScale } from "@/components/price-scale";
import type { Purchase } from "@/lib/purchase";
import { calcFor, dropText, rub } from "@/lib/price-calc";
import { priceFloor, raisedPct } from "@/lib/price-floor";

// Вход в калькулятор — первым на шаге «Требования», над «Кто может участвовать»: ответ, если уже посчитан, и шкала.
export function PriceTeaser({ purchase }: { purchase: Purchase }) {
  const calc = calcFor(purchase);
  const { floor, at, raisedBelow } = priceFloor(calc);
  const atFloor = floor.ok && !floor.aboveNmck ? at(floor.price) : null;

  let text: string;
  if (atFloor) text = `Можно снижаться до ${rub(atFloor.price)} — на ${dropText(atFloor.drop)} % ниже начальной.`;
  else if (floor.ok) text = "Даже по начальной цене контракт в убытке — проверьте расходы.";
  else if (!floor.ok && floor.reason === "impossible") text = "Налог и стоимость обеспечения съедают всю цену — проверьте проценты.";
  else
    text = `Впишите себестоимость — посчитаю нижнюю цену без убытка${
      calc.nmck ? "" : " (начальную цену тоже впишите: в документах она не нашлась)"
    }: с налогом, обеспечением и антидемпингом.`;

  return (
    <section aria-labelledby="req-price" className="island grid gap-3 px-[var(--pad)] py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 flex-none place-items-center rounded-[var(--r-card)] bg-[var(--brand-tint)] text-primary">
            <CalculatorIcon className="size-5" />
          </span>
          <div className="grid min-w-0 gap-0.5">
            <p className="t-over text-primary">Перед торгами</p>
            <h3 id="req-price" className="t-section">
              До какой цены снижаться
            </h3>
            <p className="text-[var(--ink-2)]">{text}</p>
          </div>
        </div>
        <Link href={`/p/${purchase.id}/price`} className="btn btn-line flex-none">
          <CalculatorIcon />
          {floor.ok ? "Открыть расчёт" : "Посчитать"}
        </Link>
      </div>
      {floor.ok && calc.nmck && (
        <PriceScale
          nmck={calc.nmck}
          floor={floor}
          raisedBelow={raisedBelow}
          raisedPct={raisedPct(calc.securityPct ?? 0)}
          at={at}
          price={calc.price}
        />
      )}
    </section>
  );
}
