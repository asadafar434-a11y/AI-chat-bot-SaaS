// Слова → признаки и векторы для поиска по базе знаний. Без внешнего API: эмбеддинги платных моделей
// требуют отдельного «да» по цене (см. правило про платные запросы), поэтому по умолчанию — локальный вектор.
//
// Что он умеет: слова с разными окончаниями («гарантия», «гарантии», «гарантией») дают близкие векторы,
// потому что сравниваются основы слов и триграммы внутри слова. Чего не умеет: понимать синонимы
// («обеспечение заявки» и «залог участника» будут далеки). Для синонимов нужен настоящий эмбеддер — он
// подключается через интерфейс Embedder без изменения поиска и хранилища.

export const EMBED_DIMS = 512;
export const LOCAL_EMBEDDER_ID = "hashed-ngrams-512-v1";

// Служебные слова: по ним поиск не ищет — иначе «и», «в», «по» совпадают почти везде.
const STOP = new Set(
  "и в во на с со по для или не что как а но к ко из от за о об при у же бы это эти так то все его её их быть был была были если также либо над под без до после ли ни".split(
    " ",
  ),
);

/** Основа слова: у коротких слов не режем, у длинных отбрасываем окончание. Так «гарантия» и «гарантии» совпадают. */
export const stemOf = (word: string): string => (word.length <= 3 ? word : word.length <= 5 ? word.slice(0, -1) : word.slice(0, -2));

/** Текст → основы слов (без служебных). Числа остаются целиком: «44» не должно стать «4». */
export function tokensOf(text: string): string[] {
  const words = text.toLowerCase().replace(/ё/g, "е").match(/[\p{L}\p{N}]+/gu) ?? [];
  const out: string[] = [];
  for (const word of words) {
    if (STOP.has(word)) continue;
    if (/^\p{N}+$/u.test(word)) out.push(word);
    else if (word.length >= 2) out.push(stemOf(word));
  }
  return out;
}

function fnv1a(text: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Текст → вектор длиной EMBED_DIMS, нормированный к единице. Одинаковый текст всегда даёт одинаковый вектор. */
export function embedText(text: string): number[] {
  const vec = new Array<number>(EMBED_DIMS).fill(0);
  const add = (feature: string, weight: number) => {
    const index = fnv1a(feature, 0) % EMBED_DIMS;
    const sign = fnv1a(feature, 0x9e3779b9) & 1 ? 1 : -1;
    vec[index] += sign * weight;
  };
  for (const token of tokensOf(text)) {
    add(`w:${token}`, 1);
    const padded = `^${token}$`;
    for (let i = 0; i + 3 <= padded.length; i++) add(`g:${padded.slice(i, i + 3)}`, 0.5);
  }
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? vec : vec.map((x) => x / norm);
}

/** Косинусное сходство. Векторы нормированы, поэтому это скалярное произведение; нулевой вектор ни с чем не похож. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("разная размерность векторов");
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** Эмбеддер: id нужен, чтобы векторы разных моделей не смешивались при сравнении и переиспользовании. */
export type Embedder = { id: string; embed(texts: string[]): Promise<number[][]> };

export const localEmbedder: Embedder = {
  id: LOCAL_EMBEDDER_ID,
  async embed(texts) {
    return texts.map(embedText);
  },
};
