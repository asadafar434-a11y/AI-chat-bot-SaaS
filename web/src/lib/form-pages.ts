import type { Locator } from "@/lib/doc-locate";
import type { DetectedForm } from "@/lib/tp";

type Hit = { doc: string; from: number; page: number; approx: boolean };

// Место цитаты, только если она встречается в документах ровно один раз.
function uniqueHit(locator: Pick<Locator, "locate">, quote: string): Hit | undefined {
  const hit = locator.locate(quote);
  if (!hit || hit.page === undefined || hit.more > 0) return undefined;
  return { doc: hit.doc, from: hit.from, page: hit.page, approx: hit.pageApprox === true };
}

// Страницы бланка от заголовка до последней строки; конец — только если строка однозначно стоит после заголовка в том же документе.
export function formPages(locator: Pick<Locator, "locate">, form: Pick<DetectedForm, "title" | "fields">): string | undefined {
  const title = form.title.trim();
  if (!title) return undefined;
  const start = uniqueHit(locator, title);
  if (!start) return undefined;
  const labels = form.fields.map((f) => f.label.trim()).filter(Boolean);
  const lastLabel = labels[labels.length - 1];
  const end = lastLabel ? uniqueHit(locator, lastLabel) : undefined;
  const to = end && end.doc === start.doc && end.from > start.from && end.page >= start.page ? end.page : undefined;
  const phrase = to === undefined ? `с стр. ${start.page}` : to === start.page ? `стр. ${start.page}` : `стр. ${start.page}–${to}`;
  return start.approx || end?.approx ? `≈ ${phrase}` : phrase;
}
