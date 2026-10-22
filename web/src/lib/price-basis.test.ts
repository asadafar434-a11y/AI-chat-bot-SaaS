// Основа рыночной цены — закупочная: цена контракта (ЕИС, итоги торгов) в расчёт не идёт — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeRic, DEFAULT_SETTINGS, type RicData } from "./indicative-price.ts";
import { CONTRACT_PRICE_REASON, isContractPriceSource } from "./price-basis.ts";

test("источник-контракт узнаётся: ЕИС, реестр контрактов, «контракт №», номер из 19 цифр, итоги торгов, адрес zakupki.gov.ru", () => {
  for (const source of ["ЕИС, контракт № 1660100000126000012", "ЕИС", "реестр контрактов, выгрузка 22.10.2026", "Контракт № 84 от 12.10.2026", "1660100000126000012", "протокол подведения итогов", "протокол итогов аукциона", "https://zakupki.gov.ru/epz/contract/x"]) {
    assert.equal(isContractPriceSource(source), true, source);
  }
});

test("закупочные источники не задеваются: прайс, предложение поставщика, биржа, сайт поставщика; слово «контракт» в названии компании — не признак", () => {
  for (const source of ["Прайс ООО Уголь-Опт от 01.09.2026", "коммерческое предложение № 15 от 01.09.2026", "биржевая котировка 21.10.2026", "https://pst-78.ru/catalog/ugol-dpk/", "прайс ООО «Контракт-Снаб»", "таблица, строка 3", "мой прайс", ""]) {
    assert.equal(isContractPriceSource(source), false, source);
  }
});

test("в РИЦ цена контракта получает отказ с причиной, закупочные цены считаются; исключённая участником остаётся «исключена вами»", () => {
  const analog = (id: string, price: string, source: string, extra: object = {}) => ({ id, price, vat: "without" as const, source, date: "2026-09-01", ...extra });
  const data: RicData = {
    settings: { ...DEFAULT_SETTINGS, nmckVat: "without" },
    positions: [
      {
        id: "p",
        name: "Уголь",
        unit: "т",
        qty: "10",
        analogs: [
          analog("a", "5000", "ЕИС, контракт № 1660100000126000012"),
          analog("b", "5100", "Прайс ООО Уголь-Опт"),
          analog("c", "5200", "Прайс ООО Тепло-Снаб"),
          analog("d", "5300", "коммерческое предложение № 7"),
          analog("e", "9999", "Прайс ООО Мусор", { excluded: true }),
        ],
      },
    ],
  };
  const p = computeRic(data, 60_000, new Date("2026-10-22T12:00:00Z")).positions[0];
  const by = (id: string) => p.checks.find((c) => c.analog.id === id)!;
  assert.equal(by("a").state, "invalid");
  assert.equal(by("a").reason, CONTRACT_PRICE_REASON);
  assert.equal(by("b").state, "used");
  assert.equal(by("e").reason, "исключена вами");
  assert.equal(p.used, 3, "в расчёте только закупочные цены");
  assert.equal(Math.round(p.stats!.mean), 5200);
});
