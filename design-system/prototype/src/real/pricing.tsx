import { useMemo } from 'react';
import { priceWeightNote } from '@/lib/criteria';
import { calcFor } from '@/lib/price-calc';
import type { PriceCalc } from '@/lib/price-floor';
import { specNotes } from '@/lib/spec-notes';
import { findUnitSum, unitSumNotes } from '@/lib/unit-sum';
import { StepPricing } from '../components/StepPricing';
import { useProfile } from './analysis';
import { usePurchase } from './purchase-provider';

// Шаг «Цена» на настоящей закупке: начальная цена и обеспечение — из документов, расходы вписывает участник.
// Всё вписанное сохраняется в закупке; цену, которую поставили в заявку, подхватят ТП и предложение о цене.
export function PurchasePricing({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { purchase, documents, update } = usePurchase();
  const profile = useProfile();
  const calc = calcFor(purchase);
  const set = (patch: Partial<PriceCalc>) => update({ priceCalc: { ...purchase.priceCalc, ...patch } });
  const nmck = calc.nmck ?? null;

  // Что сказано в документах закупки о цене. Тексты большие, поэтому читаем их заново только когда они или реквизиты изменились,
  // а не при каждом движении ползунка.
  const fromDocs = useMemo(
    () => ({
      // Бланк «Спецификация» заказчика: цены за единицу, ставка НДС в его шапке, копейка сверх начальной цены.
      spec: specNotes({ documents, profile, nmck }),
      // Торг по сумме цен единиц: начальная сумма и порог снижения на 25 %.
      unit: findUnitSum(documents),
      unitNotes: unitSumNotes(documents),
    }),
    [documents, profile, nmck],
  );

  const notes: string[] = [];
  if ((calc.securityPct ?? 0) > 0) notes.push(`Обеспечение исполнения: ${calc.securityPct}% НМЦК — из документов закупки`);
  else notes.push('Обеспечения исполнения в документах закупки не нашлось');
  const weight = priceWeightNote(purchase.criteria);
  if (weight) notes.push(weight);
  notes.push(...fromDocs.spec, ...fromDocs.unitNotes);

  return (
    <StepPricing
      kind={purchase.kind}
      calc={calc}
      set={set}
      tpPrice={purchase.tpPrice}
      onPutPrice={(price) => update({ tpPrice: price })}
      notes={notes}
      unitSum={fromDocs.unit ? { start: fromDocs.unit.sum, parts: fromDocs.unit.parts } : undefined}
      onNext={onNext}
      onBack={onBack}
    />
  );
}
