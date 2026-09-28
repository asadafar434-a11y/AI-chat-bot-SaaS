"use client";

import { useEffect, useState } from "react";
import { NewerDataError } from "@/lib/data-format";
import { onDataChanged } from "@/lib/db";
import { byUrgency } from "@/lib/deadline";
import type { Purchase } from "@/lib/purchase";
import { listPurchases } from "@/lib/purchase-store";

export const STORAGE_ERROR =
  "Браузер не дал открыть хранилище закупок. Обновите страницу; если не поможет — проверьте, что сайту разрешено хранить данные.";

// error — текст для человека: хранилище не открылось или закупки сохранила более новая версия приложения.
type PurchaseList = { purchases: Purchase[] | null; error: string | null };

// Закупки по срочности. Список перечитывается после каждой записи: вписали пункт ТП — отметка в списке обновилась.
export function usePurchases(): PurchaseList {
  const [state, setState] = useState<PurchaseList>({ purchases: null, error: null });

  useEffect(() => {
    let alive = true;
    const load = () =>
      listPurchases().then(
        (list) =>
          alive &&
          setState({
            purchases: list.sort((a, b) => byUrgency(a.deadline, b.deadline)),
            error: null,
          }),
        (e) => alive && setState((s) => ({ ...s, error: e instanceof NewerDataError ? e.message : STORAGE_ERROR }))
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
