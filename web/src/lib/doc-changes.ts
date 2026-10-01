import { fingerprint } from "@/lib/fingerprint";

// Что изменилось в документах закупки с тех пор, как по ним составили техническое предложение. Документы закупки меняют:
// заказчик выпускает изменения в документацию, участник добавляет файл или заменяет его новой версией. ТП, составленное по
// прежним документам, тогда нужно проверить заново — иначе в заявку уйдёт то, чего заказчик уже не требует.
//
// Снимок документов — имя и короткий отпечаток содержимого каждого: по двум снимкам видно, что добавили, убрали или заменили.
export type DocStamp = { name: string; key: string };

export const stampsOf = (documents: { name: string; text: string }[]): DocStamp[] =>
  documents
    .map((d) => ({ name: d.name, key: fingerprint(d.text) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

export type DocChanges = { added: string[]; removed: string[]; changed: string[] };

export function docChanges(before: DocStamp[], after: DocStamp[]): DocChanges {
  const was = new Map(before.map((d) => [d.name, d.key]));
  const now = new Map(after.map((d) => [d.name, d.key]));
  return {
    added: after.filter((d) => !was.has(d.name)).map((d) => d.name),
    removed: before.filter((d) => !now.has(d.name)).map((d) => d.name),
    // Файл с тем же именем, но другим содержимым — новая версия документа.
    changed: after.filter((d) => was.has(d.name) && was.get(d.name) !== d.key).map((d) => d.name),
  };
}

export const isChanged = (c: DocChanges) => c.added.length + c.removed.length + c.changed.length > 0;

// docs — документы закупки сейчас, tpDocs — документы, по которым составлено ТП. Чего-то из двух нет (закупка сохранена
// до этой проверки, ТП ещё не составлено) — сказать нечего: null, ничего не помечаем.
export function tpChanges(p: { tp?: unknown; docs?: DocStamp[]; tpDocs?: DocStamp[] }): DocChanges | null {
  if (!p.tp || !p.docs || !p.tpDocs) return null;
  const changes = docChanges(p.tpDocs, p.docs);
  return isChanged(changes) ? changes : null;
}

// Первые имена файлов, остальное — «и ещё N»: длинный список заявке не нужен, полный — на шаге «Загрузка».
const SHOWN = 3;
const names = (list: string[]) =>
  list.slice(0, SHOWN).map((name) => `«${name}»`).join(", ") + (list.length > SHOWN ? ` и ещё ${list.length - SHOWN}` : "");

// Что изменилось, словами: «добавлен файл «Изменения.pdf»; изменён файл «ТЗ.docx»».
export function changesText(c: DocChanges): string {
  const line = (list: string[], one: string, many: string) => (list.length ? `${list.length === 1 ? one : many} ${names(list)}` : "");
  return [
    line(c.added, "добавлен файл", "добавлены файлы"),
    line(c.changed, "изменён файл", "изменены файлы"),
    line(c.removed, "убран файл", "убраны файлы"),
  ]
    .filter(Boolean)
    .join("; ");
}
