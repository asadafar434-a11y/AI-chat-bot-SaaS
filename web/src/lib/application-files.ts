import type { BadgeInfo } from "@/lib/home";
import { plural } from "@/lib/plural";
import { titleOf, type Purchase } from "@/lib/purchase";
import type { ReqItem } from "@/lib/requirements";
import { fieldsOf } from "@/lib/fields";
import { contextOf, holdsSubmission, ruleOf } from "@/lib/fulfillment";
import { EMPTY_PROFILE, type Profile } from "@/lib/profile";
import { PART_TITLES, partsOf, type TpPart } from "@/lib/tp-parts";

// Документы заявки. Состав заявки у каждой закупки свой — его задаёт заказчик в «Что подать». Часть файлов пишет
// приложение: ТП, анкету (кроме 44-ФЗ — там сведения об участнике передаёт площадка), декларацию, цену, сведения
// об опыте и о специалистах. Остальное — выписки, лицензии, обеспечение — участник собирает сам и отмечает, что готово.

// Короткий отпечаток данных — lib/fingerprint.ts; здесь он нужен давно, поэтому остаётся доступным и отсюда.
export { fingerprint } from "@/lib/fingerprint";

export type FileRow = { part: TpPart; title: string; sub: string; badge: BadgeInfo; action: "download" | "compose" };

export type FilesState = {
  // Сколько полей «Реквизитов» не заполнено: в анкете и декларации они будут жёлтыми.
  missing: number;
  // Сколько документов участника для сведений об опыте и о специалистах.
  evidence: { experience: number; staff: number };
  // Какую часть сейчас пишет ИИ.
  writing: TpPart | null;
};

const WRITING: BadgeInfo = { tone: "calm", text: "пишу документ…" };

// Файлы, которые пишет приложение, — по порядку частей заявки, со статусом и тем, что сделать.
// Документы составляются на шаге «Проверка»: пока их нет, у ТП — «Составить».
export function fileRows(p: Purchase, state: FilesState): FileRow[] {
  // Сколько полей ТП вписать или исправить — тем же счётом, что у шага «Проверка»: жёлтые места и исполнители.
  const fill = p.tp
    ? fieldsOf({ purchase: p, profile: EMPTY_PROFILE }).filter((f) => f.part === "tp" && (f.status === "needs_input" || f.status === "invalid")).length
    : 0;
  const rows: FileRow[] = [
    {
      part: "tp",
      title: PART_TITLES.tp,
      sub: "первая часть заявки — без названия и реквизитов участника",
      badge: !p.tp
        ? { tone: "calm", text: "не составлено" }
        : fill
          ? { tone: "warn", text: `впишите ${fill} ${plural(fill, "поле", "поля", "полей")}`, icon: "pen" }
          : { tone: "ok", text: "готово", icon: "check" },
      action: p.tp ? "download" : "compose",
    },
  ];
  if (!p.tp) return rows;

  for (const part of partsOf(p.tp.form, p.criteria, p.kind).filter((x) => x !== "tp")) {
    const row = (sub: string, badge: BadgeInfo) =>
      rows.push({ part, title: PART_TITLES[part], sub, badge: state.writing === part ? WRITING : badge, action: "download" });
    if (p.sample) {
      row("в примере — по стандартному шаблону", { tone: "calm", text: "пример" });
    } else if (part === "experience" || part === "staff") {
      const n = state.evidence[part];
      row(
        n
          ? `из ${n} ${plural(n, "документа", "документов", "документов")} в «Образцах и реквизитах» · за них дают баллы`
          : "загрузите документы в «Образцы и реквизиты» — без них баллов не будет",
        n ? { tone: "brand", text: "за них баллы" } : { tone: "warn", text: "нет документов", icon: "alert" }
      );
    } else if (part === "price") {
      row(
        p.tpPrice ? "цена — с шага «Цена»" : "цену ставят в заявку на шаге «Цена»",
        p.tpPrice ? { tone: "ok", text: "цена вписана", icon: "check" } : { tone: "warn", text: "впишите цену", icon: "pen" }
      );
    } else {
      row(
        state.missing
          ? `в «Реквизитах» не хватает ${state.missing} ${plural(state.missing, "поля", "полей", "полей")} — в файле они жёлтые`
          : "реквизиты — из «Реквизитов»",
        state.missing ? { tone: "warn", text: "впишите реквизиты", icon: "pen" } : { tone: "ok", text: "готово", icon: "check" }
      );
    }
  }
  return rows;
}

// Что требует заказчик — пункты «Что подать» из требований; готовые участник отмечает сам. Пункт узнаётся по тексту:
// требования выписали заново — отметки остаются у тех пунктов, что не изменились (и у тех, что ИИ переписал на той же цитате).
// required — пункт держит подачу; у остальных (площадка передаст, «не требуется», «по желанию») note объясняет, почему не держит.
export type SubmitItem = ReqItem & { ready: boolean; required: boolean; note?: string };

export function submitItems(p: Purchase, profile?: Profile): SubmitItem[] {
  const ctx = contextOf(p, profile);
  return p.requirements.submit.map((item) => {
    const plan = ruleOf(item, ctx).plan;
    const required = holdsSubmission(plan);
    return { ...item, ready: (p.submitReady ?? []).includes(item.text), required, ...(!required && { note: plan.todo }) };
  });
}

const normalized = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Одна и та же цитата из документов: слово в слово или одна целиком внутри другой (не короче 40 знаков — иначе совпадёт случайно).
function sameQuote(a: string, b: string): boolean {
  const x = normalized(a);
  const y = normalized(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 40 && long.includes(short);
}

// Требования выписаны заново — документов стало больше. ИИ при этом нередко переписывает пункт другими словами, и отметка
// «готово» по тексту пропала бы. Отметка остаётся у пункта с тем же текстом и у пункта на той же цитате из документов.
// Отметок у пунктов, которых больше нет, не остаётся.
export function carryReady(before: ReqItem[], ready: string[], after: ReqItem[]): string[] {
  const marked = new Set(ready);
  const was = before.filter((item) => marked.has(item.text));
  return [...new Set(after.filter((item) => marked.has(item.text) || was.some((old) => sameQuote(old.quote, item.quote))).map((item) => item.text))];
}

export function toggleReady(p: Purchase, text: string): string[] {
  const ready = new Set(p.submitReady ?? []);
  if (ready.has(text)) ready.delete(text);
  else ready.add(text);
  // Отметки у пунктов, которых в требованиях уже нет, не копятся.
  return p.requirements.submit.map((item) => item.text).filter((t) => ready.has(t));
}

// Имя архива — по закупке, без расширения: «Праздник «День учителя» — заявка».
export const archiveName = (p: Purchase) =>
  `${titleOf(p).replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100)} — заявка`;
