import type { BadgeInfo } from "@/lib/home";
import { plural } from "@/lib/plural";
import { titleOf, type Purchase } from "@/lib/purchase";
import type { ReqItem } from "@/lib/requirements";
import { fieldsOf } from "@/lib/fields";
import { EMPTY_PROFILE } from "@/lib/profile";
import { PART_TITLES, partsOf, type TpPart } from "@/lib/tp-parts";

// Документы заявки. Состав заявки у каждой закупки свой — его задаёт заказчик в «Что подать». Часть файлов пишет
// приложение: ТП, анкету (кроме 44-ФЗ — там сведения об участнике передаёт площадка), декларацию, цену, сведения
// об опыте и о специалистах. Остальное — выписки, лицензии, обеспечение — участник собирает сам и отмечает, что готово.

// Короткий отпечаток данных: по нему видно, что часть заявки составлена из тех же реквизитов, цены и образцов.
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = (hash * 33 + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

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
// требования выписали заново — отметки остаются у тех пунктов, что не изменились.
export type SubmitItem = ReqItem & { ready: boolean };

export const submitItems = (p: Purchase): SubmitItem[] =>
  p.requirements.submit.map((item) => ({ ...item, ready: (p.submitReady ?? []).includes(item.text) }));

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
