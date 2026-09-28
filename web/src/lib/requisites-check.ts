// Проверка реквизитов: длина и контрольные цифры ИНН, ОГРН, ОГРНИП, счетов. Подсказка, а не запрет: сохраняется
// всё, что вписано, — опечатку видно сразу, а не в отказе заказчика. Модуль без зависимостей: его проверяют тесты (npm test).
//
// ИНН: контрольные цифры — остаток от деления на 11 суммы цифр с весами, если остаток 10 — цифра 0.
// ОГРН: 13-я цифра — младший разряд остатка от деления первых 12 цифр на 11; ОГРНИП: 15-я — первых 14 на 13
//   (Порядок ведения ЕГРЮЛ и ЕГРИП, приказ Минфина России от 30.10.2017 № 165н).
// Счета: контрольный ключ — «Порядок расчёта контрольного ключа в номере лицевого счёта» (Банк России, 08.09.1997 № 515):
//   к 20 цифрам счёта спереди — три цифры от БИК, веса 7, 1, 3 по кругу, сумма должна делиться на 10.

import type { Profile, ProfileKey } from "./profile.ts";

const clean = (value: string) => value.replace(/[\s-]/g, "");
const onlyDigits = (value: string, length: number) => new RegExp(`^\\d{${length}}$`).test(value);

function innDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  return (sum % 11) % 10;
}
const INN10 = [2, 4, 10, 3, 5, 9, 4, 6, 8];
const INN11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
const INN12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];

export function innProblem(value: string): string | null {
  const v = clean(value);
  if (!onlyDigits(v, 10) && !onlyDigits(v, 12)) return "ИНН — 10 цифр у организации или 12 у ИП";
  const ok =
    v.length === 10
      ? innDigit(v, INN10) === Number(v[9])
      : innDigit(v, INN11) === Number(v[10]) && innDigit(v, INN12) === Number(v[11]);
  return ok ? null : "Контрольная цифра ИНН не сходится — проверьте, нет ли опечатки";
}

// КПП: 4 цифры — налоговая, 2 знака — причина постановки (цифры или заглавные латинские буквы), 3 цифры — номер.
export function kppProblem(value: string): string | null {
  return /^\d{4}[\dA-Z]{2}\d{3}$/.test(clean(value)) ? null : "КПП — 9 знаков, например 773601001";
}

// Остаток от деления длинного числа — по цифрам: 14 знаков не помещаются в точную арифметику с плавающей точкой.
const mod = (digits: string, m: number) => [...digits].reduce((r, d) => (r * 10 + Number(d)) % m, 0);

export function ogrnProblem(value: string): string | null {
  const v = clean(value);
  if (onlyDigits(v, 13)) return mod(v.slice(0, 12), 11) % 10 === Number(v[12]) ? null : "Контрольная цифра ОГРН не сходится — проверьте, нет ли опечатки";
  if (onlyDigits(v, 15)) return mod(v.slice(0, 14), 13) % 10 === Number(v[14]) ? null : "Контрольная цифра ОГРНИП не сходится — проверьте, нет ли опечатки";
  return "ОГРН — 13 цифр, ОГРНИП — 15";
}

export function bikProblem(value: string): string | null {
  return onlyDigits(clean(value), 9) ? null : "БИК — 9 цифр";
}

// Контрольный ключ: 23 цифры с весами 7, 1, 3 по кругу; сумма младших разрядов произведений делится на 10.
const keyOk = (digits23: string) => [...digits23].reduce((sum, d, i) => sum + ((Number(d) * [7, 1, 3][i % 3]) % 10), 0) % 10 === 0;

// Расчётный счёт в банке: спереди — последние три цифры БИК. Ключ сверяем только у счетов организаций и ИП (407…, 408…):
// у казначейских и прочих счетов свои правила, ложная тревога там хуже, чем её отсутствие.
export function accountProblem(value: string, bik: string): string | null {
  const v = clean(value);
  if (!onlyDigits(v, 20)) return "Расчётный счёт — 20 цифр";
  const b = clean(bik);
  if (!onlyDigits(b, 9) || !/^40[78]/.test(v)) return null;
  return keyOk(b.slice(6) + v) ? null : "Счёт не сходится с БИК по контрольной цифре — проверьте счёт и БИК";
}

// Корреспондентский счёт банка: начинается с 301; спереди — «0» и 5–6-я цифры БИК.
export function corrAccountProblem(value: string, bik: string): string | null {
  const v = clean(value);
  if (!onlyDigits(v, 20) || !v.startsWith("301")) return "Корреспондентский счёт — 20 цифр, начинается с 301";
  const b = clean(bik);
  if (!onlyDigits(b, 9)) return null;
  return keyOk(`0${b.slice(4, 6)}${v}`) ? null : "Корреспондентский счёт не сходится с БИК — проверьте оба";
}

// Подсказки к полям реквизитов: пустые поля не проверяем.
export function profileProblems(p: Profile): Partial<Record<ProfileKey, string>> {
  const out: Partial<Record<ProfileKey, string>> = {};
  const has = (key: ProfileKey) => p[key].trim() !== "";
  if (has("inn")) out.inn = innProblem(p.inn) ?? undefined;
  if (has("kpp")) out.kpp = kppProblem(p.kpp) ?? undefined;
  if (has("ogrn")) out.ogrn = ogrnProblem(p.ogrn) ?? undefined;
  if (has("bik")) out.bik = bikProblem(p.bik) ?? undefined;
  if (has("account")) out.account = accountProblem(p.account, p.bik) ?? undefined;
  if (has("corrAccount")) out.corrAccount = corrAccountProblem(p.corrAccount, p.bik) ?? undefined;

  // Организация и ИП различаются длиной ИНН — остальные номера должны ей соответствовать.
  const inn = clean(p.inn);
  const ogrn = clean(p.ogrn);
  if (!out.inn && inn.length === 12 && has("kpp")) out.kpp ??= "КПП бывает только у организации, а ИНН из 12 цифр — у ИП";
  if (!out.inn && !out.ogrn && inn.length === 10 && ogrn.length === 15) out.ogrn = "У организации (ИНН из 10 цифр) — ОГРН из 13 цифр, а здесь ОГРНИП";
  if (!out.inn && !out.ogrn && inn.length === 12 && ogrn.length === 13) out.ogrn = "У ИП (ИНН из 12 цифр) — ОГРНИП из 15 цифр, а здесь ОГРН";
  for (const key of Object.keys(out) as ProfileKey[]) if (!out[key]) delete out[key];
  return out;
}
