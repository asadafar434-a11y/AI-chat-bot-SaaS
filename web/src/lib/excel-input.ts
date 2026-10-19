import { goodsIndexOf, type DocText } from "@/lib/product-card";
import { isOriginRow } from "@/lib/registry-lines";
import { registryCardsOf, registryFillFor, type RegistryPurchase } from "@/lib/registry-fill";
import { REGISTRY_SHORT } from "@/lib/registry-types";
import type { ExcelGood } from "@/lib/xlsx-plan";

// Что приложение знает о товарах участника и может вписать в Excel-бланк заказчика (lib/xlsx-plan.ts): страна, производитель и реестровый номер.
// Берётся только сказанное участником или его документами: значение «из ТЗ» — это то, чего хочет заказчик, участник его не называл.
export function excelGoodsOf(purchase: RegistryPurchase, docs: DocText[], now = new Date()): ExcelGood[] {
  const goods = purchase.tp?.goods ?? [];
  const fills = new Map(registryFillFor(purchase, docs, now).map((x) => [x.index, x]));
  const cards = new Map(registryCardsOf(purchase, docs).map((card) => [goodsIndexOf(card.key), card]));
  return goods.flatMap((good, index) => {
    if (isOriginRow(good)) return [];
    const card = cards.get(index);
    const own = (field: "country" | "manufacturer") => {
      const f = card?.fields[field];
      return f && f.origin !== "tz" && f.value.trim() ? f.value.trim() : undefined;
    };
    const fill = fills.get(index);
    // Номер, который программа подобрала, а участник ещё не подтвердил, в файле помечен так же, как в Word: «ПРОВЕРЬТЕ».
    const registry = fill ? `${REGISTRY_SHORT[fill.kind]}, № ${fill.number}${fill.unverified ? " [ПРОВЕРЬТЕ]" : ""}` : undefined;
    return [{ name: good.name, country: own("country"), manufacturer: own("manufacturer"), registry }];
  });
}
