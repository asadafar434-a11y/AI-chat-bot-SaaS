import { checkCounts } from "@/lib/check";
import { fieldsOf } from "@/lib/fields";
import { requiredItems } from "@/lib/fulfillment";
import { plural } from "@/lib/plural";
import { EMPTY_PROFILE, type Profile } from "@/lib/profile";
import type { Purchase } from "@/lib/purchase";
import { REQ_GROUP_KEYS } from "@/lib/requirements";
import { formatRubles, parseRubles } from "@/lib/rub-words";
import { partsOf } from "@/lib/tp-parts";

// Подготовка заявки по закупке — пять шагов, как в прототипе (design-system/prototype): загрузить документы
// закупки, разобрать их, выбрать цену, дописать и проверить заявку, скачать пакет. Потом участник подаёт заявку
// на электронной площадке. Отдельного шага ТП нет (решение владельца 29.09.2026): техническое предложение —
// документ пакета, его составляет ИИ в начале «Проверки», там же дописываются пропуски.
export type StepKey = "upload" | "analysis" | "price" | "review" | "package";
export type StepState = "done" | "fix" | "todo";
export type Tone = "ok" | "warn" | "bad" | "brand" | "calm";

export type Step = {
  key: StepKey;
  n: number;
  title: string;
  href: string;
  // Страницы шага: на них шаг в шапке выбран. ТП открывается из «Пакета» — и считается его страницей.
  paths: string[];
  state: StepState;
  status: string;
  tone: Tone;
};

const count = (n: number, one: string, few: string, many: string) => `${n} ${plural(n, one, few, many)}`;
const rubText = (value: number) => `${formatRubles(value).replace(/,00$/, "")} ₽`;

// Поля самой заявки: жёлтые места ТП, исполнители, строки анкеты заказчика. Реквизиты сюда не входят — они общие
// для всех закупок, их правят в «Реквизитах»; цена — на шаге «Цена». Тот же счёт — у «Вписать» на шаге «Проверка».
export const isOwnField = (key: string) => /^(tp|cast|anketa):/.test(key);

// Что осталось по самой заявке. price — форма заказчика требует цену, а её нет или она выше начальной.
export function reviewGaps(p: Purchase): { empty: number; invalid: number; price: boolean } {
  if (!p.tp) return { empty: 0, invalid: 0, price: false };
  const fields = fieldsOf({ purchase: p, profile: EMPTY_PROFILE });
  const own = fields.filter((f) => isOwnField(f.key));
  const price = fields.find((f) => f.key === "confirm:price");
  return {
    empty: own.filter((f) => f.status === "needs_input").length,
    invalid: own.filter((f) => f.status === "invalid").length,
    price: Boolean(price?.required && price.status !== "filled"),
  };
}

// profile — реквизиты участника: по ним видно, что ИП устав не нужен. Без них такие пункты считаются нужными.
export function stepsOf(p: Purchase, profile?: Profile): Step[] {
  const base = `/p/${p.id}`;
  const docs = p.files.length;
  const reqs = REQ_GROUP_KEYS.reduce((n, key) => n + p.requirements[key].length, 0);
  const price = p.tpPrice ?? p.priceCalc?.price ?? null;
  const nmck = parseRubles(p.price);
  const gaps = reviewGaps(p);
  // Своя заявка, проверенная файлом: ошибки в ней тоже держат шаг «Проверка» открытым.
  const bad = p.check ? checkCounts(p.check).bad : 0;
  // Только то, что держит подачу: площадка передаст сама, «не требуется» и «по желанию» отметки не ждут.
  const asked = requiredItems(p, profile);
  const ready = asked.filter((d) => (p.submitReady ?? []).includes(d.text)).length;
  const files = p.tp ? partsOf(p.tp.form, p.criteria, p.kind).length : 0;

  const upload: Step = {
    key: "upload",
    n: 1,
    title: "Загрузка",
    href: `${base}/files`,
    paths: [`${base}/files`],
    ...(p.unreadable.length
      ? { state: "fix" as const, status: `не прочитано: ${p.unreadable.length}`, tone: "warn" as const }
      : { state: "done" as const, status: count(docs, "документ", "документа", "документов"), tone: "calm" as const }),
  };

  const analysis: Step = {
    key: "analysis",
    n: 2,
    title: "Анализ",
    href: base,
    paths: [base],
    state: "done",
    status: reqs ? `выписаны: ${count(reqs, "пункт", "пункта", "пунктов")}` : "не нашлись в документах",
    tone: reqs ? "calm" : "warn",
  };

  const priceStep: Step = {
    key: "price",
    n: 3,
    title: "Цена",
    href: `${base}/price`,
    paths: [`${base}/price`],
    ...(!price
      ? { state: "todo" as const, status: "не выбрана", tone: "calm" as const }
      : nmck && price > nmck
        ? { state: "fix" as const, status: "выше начальной", tone: "bad" as const }
        : { state: "done" as const, status: rubText(price), tone: "ok" as const }),
  };

  const review: Step = {
    key: "review",
    n: 4,
    title: "Проверка",
    href: `${base}/check`,
    paths: [`${base}/check`],
    ...(!p.tp
      ? { state: "todo" as const, status: "не составлена", tone: "calm" as const }
      : gaps.invalid
        ? { state: "fix" as const, status: `исправьте ${count(gaps.invalid, "поле", "поля", "полей")}`, tone: "bad" as const }
        : gaps.empty
          ? { state: "fix" as const, status: `впишите ${count(gaps.empty, "поле", "поля", "полей")}`, tone: "warn" as const }
          : bad
            ? { state: "fix" as const, status: count(bad, "ошибка", "ошибки", "ошибок"), tone: "bad" as const }
            : gaps.price
              ? { state: "fix" as const, status: "нужна цена", tone: "warn" as const }
              : { state: "done" as const, status: "заполнена", tone: "ok" as const }),
  };

  const pack: Step = {
    key: "package",
    n: 5,
    title: "Пакет",
    href: `${base}/package`,
    paths: [`${base}/package`, `${base}/tp`],
    ...(!p.tp
      ? { state: "todo" as const, status: "нет документов", tone: "calm" as const }
      : review.state !== "done"
        ? { state: "todo" as const, status: count(files, "файл", "файла", "файлов"), tone: "calm" as const }
        : ready < asked.length
          ? { state: "fix" as const, status: `соберите ${asked.length - ready} из ${asked.length}`, tone: "warn" as const }
          : { state: "done" as const, status: "можно подавать", tone: "ok" as const }),
  };

  return [upload, analysis, priceStep, review, pack];
}

export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-[var(--ok)]",
  warn: "text-[var(--warn)]",
  bad: "text-destructive",
  brand: "text-primary",
  calm: "text-[var(--ink-3)]",
};
