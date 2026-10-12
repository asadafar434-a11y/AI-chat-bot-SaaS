import { registryLine } from "@/lib/registry-types";

// Как реестровый номер попадает в текст товаров ТП — и в предпросмотр на экране, и в файлы заявки (одна функция на оба).
// Код ОКПД в заявке участника не нужен: в ней нужен номер реестровой записи его товара. Поэтому:
//  — строка «ОКПД: 14.19.42.141» (так ИИ переносит код заказчика из ТЗ) из характеристик товара убирается всегда;
//  — на её месте (или в конце, если такой строки не было) — строка с номером, если он подтверждён и проверен (registry-log.ts → autofillCheck);
//    жёлтое поле «[номер реестровой записи — …]», если закупка требует реестр, а номер не выбран; пометка «проверьте», если запись
//    уже не действует;
//  — строка «Страна происхождения – Россия», которую ТП добавляет после товаров, содержит поле «[номер реестровой записи — …]»: оно заполняется
//    номерами по позициям (или частично, остальное остаётся жёлтым).

export type RegistryGood = {
  name: string;
  characteristics: string;
  quantity: string;
  registryNumber?: string;
  registryRejected?: boolean;
  /** Закупка требует реестровый номер: если номера нет, на его месте жёлтое поле. */
  registryNeeded?: boolean;
};

/** Строка «ОКПД: 14.19.42.141», «ОКПД2: 14.19.23.140», «ОКПД 2 – 14.19»: целиком, без другого текста. */
const OKPD_LINE = /^[ \t]*ОКПД[ \t]*[-–]?[ \t]*2?[ \t]*[:\-–—]?[ \t]*\d{2}(?:\.\d{1,3}){1,3}[ \t]*\.?[ \t]*$/i;

/** Поле под номер, которое ТП оставляет участнику в строке про страну происхождения. */
const NUMBER_HOLE = /\[номер реестровой записи[^\]]*\]/i;

export const REGISTRY_CHECK = "[номер реестровой записи: проверьте — записи нет среди действующих]";
export const REGISTRY_NEEDED = "[номер реестровой записи — выберите в блоке «Реестровые номера товаров» на шаге «Пакет»]";

/** Строка про страну происхождения, которую ТП добавляет после товаров: это не товар, номер для неё не ищется. */
export const isOriginRow = (good: { name: string; quantity?: string }): boolean => /^\s*страна\s+происхождени/i.test(good.name) && !(good.quantity ?? "").trim();

const lineFor = (g: RegistryGood): string =>
  g.registryNumber ? registryLine(g.registryNumber) : g.registryRejected ? REGISTRY_CHECK : g.registryNeeded ? REGISTRY_NEEDED : "";

/** Характеристики одного товара: строка ОКПД убрана, вместо неё номер реестровой записи или отметка, что его нужно выбрать. */
export function characteristicsWithRegistry(g: RegistryGood): string {
  const extra = lineFor(g);
  const lines = g.characteristics.split("\n");
  const first = lines.findIndex((l) => OKPD_LINE.test(l));
  if (first === -1) return extra ? `${g.characteristics}${g.characteristics.trim() ? "\n" : ""}${extra}` : g.characteristics;
  const kept = lines.map((l, i) => (i === first ? extra : OKPD_LINE.test(l) ? null : l)).filter((l): l is string => l !== null && l !== "" );
  return kept.join("\n");
}

/** Товары для показа и сборки файла: ОКПД убран, номера подставлены, строка про происхождение заполнена номерами по позициям. */
export function goodsWithRegistry<T extends RegistryGood>(goods: T[]): T[] {
  const ordinary = goods.filter((g) => !isOriginRow(g));
  const done = ordinary.filter((g) => g.registryNumber);
  const missing = ordinary.filter((g) => !g.registryNumber);
  return goods.map((g) => {
    if (!isOriginRow(g)) return { ...g, characteristics: characteristicsWithRegistry(g) };
    if (done.length === 0 || !NUMBER_HOLE.test(g.characteristics)) return g;
    const filled = done.map((d) => `${d.name} — ${d.registryNumber}`).join("; ");
    const rest = missing.length ? `; [номер реестровой записи — ещё для: ${missing.map((m) => m.name).join(", ")}]` : "";
    return { ...g, characteristics: g.characteristics.replace(NUMBER_HOLE, () => `${filled}${rest}`) };
  });
}
