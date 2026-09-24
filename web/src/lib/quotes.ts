const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»“”„"]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[­​]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Цитата засчитывается, только если каждый её фрагмент (между многоточиями) есть в тексте документов:
// так модель не может выдать пересказ или выдумку за слова заказчика.
export function quoteFound(quote: string, documents: string[]): boolean {
  const fragments = quote
    .split(/\.{3}|…/)
    .map(normalize)
    .filter((f) => f.length >= 8);
  if (fragments.length === 0) return false;
  const texts = documents.map(normalize);
  return fragments.every((f) => texts.some((t) => t.includes(f)));
}
