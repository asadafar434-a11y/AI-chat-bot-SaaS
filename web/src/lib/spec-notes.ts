// Пометки для шага «Цена» о бланке «Спецификация» заказчика: что в нём просят, какая ставка НДС и где копейка может выйти за начальную цену.
// Только то, что есть в документах закупки; ничего не придумывается — нет бланка, нет и пометок.
import { plural } from "@/lib/plural";
import { baseTotalKop, rubText, toKop } from "@/lib/price-split";
import type { Profile } from "@/lib/profile";
import { baseUnitPrices, findSpecification } from "@/lib/spec-table";

// Ставка НДС по реквизитам участника: «НДС не облагается» — 0, «НДС 5 %» — 5. Иначе неизвестна: упрощёнка бывает и без НДС, и с 5 или 7 %,
// поэтому по одному названию режима ставку не угадываем.
export function vatRateOf(profile: Pick<Profile, "taxSystem" | "vatNote">): number | null {
  const text = `${profile.vatNote} ${profile.taxSystem}`;
  if (/не\s+облага|без\s+НДС/i.test(text)) return 0;
  const m = /НДС[^\d.;]{0,30}(\d{1,2})\s*%|(\d{1,2})\s*%[^.;]{0,12}НДС/i.exec(text);
  const rate = m ? Number(m[1] ?? m[2]) : NaN;
  return Number.isFinite(rate) && rate > 0 && rate <= 30 ? rate : null;
}

const rateText = (rate: number) => (rate === 0 ? "без НДС" : `${rate} %`);

export function specNotes({ documents, profile, nmck }: { documents: { name: string; text: string }[]; profile: Pick<Profile, "taxSystem" | "vatNote">; nmck: number | null }): string[] {
  const spec = findSpecification(documents);
  if (!spec || !spec.hasPrice) return [];
  const n = spec.rows.length;
  const notes = [
    `В документах закупки есть бланк «${spec.title}» на ${n} ${plural(n, "позицию", "позиции", "позиций")} (${spec.doc}): в нём нужны цены за единицу в рублях и копейках, сумма по позициям не должна быть выше итоговой цены`,
  ];

  // Ставка НДС стоит в самом бланке («НДС, 5%»): если у участника другая, колонки надо править.
  if (spec.vatRate !== null) {
    const mine = vatRateOf(profile);
    if (mine === null) notes.push(`В бланке заказчика НДС ${spec.vatRate} %: проверьте, подходит ли ваш режим налогообложения (его вписывают в «Реквизитах»)`);
    else if (mine !== spec.vatRate) notes.push(`В бланке заказчика НДС ${spec.vatRate} %, а по вашим реквизитам — ${rateText(mine)}: поправьте колонки с НДС`);
  }

  // Начальные цены за единицу с копейками: округлённые, они могут дать в сумме больше начальной цены договора.
  const base = nmck ? baseUnitPrices(spec.rows, documents) : null;
  if (base && nmck && spec.rows.every((r) => Number.isInteger(r.qty))) {
    const total = baseTotalKop(spec.rows.map((r, i) => ({ name: r.name, qty: r.qty, baseKop: toKop(base[i]) })));
    if (total > toKop(nmck)) {
      notes.push(`Начальные цены за единицу, округлённые до копеек, дают в сумме ${rubText(total)} — выше начальной цены ${rubText(toKop(nmck))}: цены в бланке подберите так, чтобы сумма не вышла за итог`);
    }
  }
  return notes;
}
