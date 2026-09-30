import { calcFor } from '@/lib/price-calc';
import type { PriceCalc } from '@/lib/price-floor';
import { StepPricing } from '../components/StepPricing';
import { usePurchase } from './purchase-provider';

// Шаг «Цена» на настоящей закупке: начальная цена и обеспечение — из документов, расходы вписывает участник.
// Всё вписанное сохраняется в закупке; цену, которую поставили в заявку, подхватят ТП и предложение о цене.
export function PurchasePricing({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { purchase, update } = usePurchase();
  const calc = calcFor(purchase);
  const set = (patch: Partial<PriceCalc>) => update({ priceCalc: { ...purchase.priceCalc, ...patch } });

  const notes: string[] = [];
  if ((calc.securityPct ?? 0) > 0) notes.push(`Обеспечение исполнения: ${calc.securityPct}% НМЦК — из документов закупки`);
  else notes.push('Обеспечения исполнения в документах закупки не нашлось');

  return (
    <StepPricing
      calc={calc}
      set={set}
      tpPrice={purchase.tpPrice}
      onPutPrice={(price) => update({ tpPrice: price })}
      notes={notes}
      onNext={onNext}
      onBack={onBack}
    />
  );
}
