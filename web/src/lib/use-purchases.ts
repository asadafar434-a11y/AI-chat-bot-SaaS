"use client";

import { useEffect, useState } from "react";
import { onDataChanged } from "@/lib/db";
import { byUrgency } from "@/lib/deadline";
import { upgradePurchase, type Purchase } from "@/lib/purchase";
import { listPurchases } from "@/lib/purchase-store";

export const STORAGE_ERROR =
  "Браузер не дал открыть хранилище закупок. Обновите страницу; если не поможет — проверьте, что сайту разрешено хранить данные.";

type PurchaseList = { purchases: Purchase[] | null; error: boolean };

// Закупки по срочности. Список перечитывается после каждой записи: вписали пункт ТП — отметка в списке обновилась.
export function usePurchases(): PurchaseList {
  const [state, setState] = useState<PurchaseList>({ purchases: null, error: false });

  useEffect(() => {
    let alive = true;
    const load = () =>
      listPurchases().then(
        (list) =>
          alive &&
          setState({
            purchases: list.map(upgradePurchase).sort((a, b) => byUrgency(a.deadline, b.deadline)),
            error: false,
          }),
        () => alive && setState((s) => ({ ...s, error: true }))
      );
    void load();
    const off = onDataChanged(() => void load());
    return () => {
      alive = false;
      off();
    };
  }, []);

  return state;
}
