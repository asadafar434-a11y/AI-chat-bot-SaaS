import type { Locator } from "@/lib/doc-locate";

// Страницу заголовка бланка берёт код по тексту документов; заголовок, найденный больше одного раза, не привязываем к странице.
export function formPage(locator: Pick<Locator, "locate">, title: string): string | undefined {
  const quote = title.trim();
  if (!quote) return undefined;
  const hit = locator.locate(quote);
  if (!hit || hit.page === undefined || hit.more > 0) return undefined;
  return hit.pageApprox ? `≈ ${hit.page}` : String(hit.page);
}
