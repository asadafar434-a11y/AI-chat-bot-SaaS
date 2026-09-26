// Состав исполнителей: ТЗ требует назвать в заявке людей — артистов, музыкантов, ведущих — с ФИО и званием.
// Кто нужен (позиции, сколько человек, звание), выписывает ИИ; людей участник вписывает под каждую закупку:
// состав от закупки к закупке свой, поэтому справочника нет. Фамилии ИИ не нужны — они в него не уходят.
// Модуль без зависимостей: его проверяют тесты без сборки (npm test).

export type CastRank = "none" | "honored" | "people";

// Заготовка от ИИ — как в TpDraftSchema.cast.
export type CastGroupDraft = { title: string; one: string; acc: string; count: number; rank: CastRank; match: string[] };
export type CastDraft = {
  clause: string;
  requirement: string;
  quote: string;
  groups: CastGroupDraft[];
  replace: { rule: string; source: string; quote: string };
};

export type CastGroup = CastGroupDraft & { key: string };
export type CastRow = { id: string; group: string; name: string; title: string };
export type TpCast = Omit<CastDraft, "groups" | "replace"> & {
  verified: boolean;
  groups: CastGroup[];
  rows: CastRow[];
  replace: CastDraft["replace"] & { verified: boolean };
};

// Как в plural.ts: модуль без зависимостей.
const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};

const LEVEL: Record<CastRank, number> = { none: 0, honored: 1, people: 2 };
export const RANK_NEED: Record<CastRank, string> = {
  none: "",
  honored: "«Заслуженный артист Российской Федерации»",
  people: "«Народный артист Российской Федерации»",
};
const RANK_SHORT: Record<CastRank, string> = { none: "", honored: "заслуженного артиста", people: "народного артиста" };

// Обычные почётные звания — подсказки в поле «Звание».
export const CAST_TITLES = [
  "Народный артист России",
  "Народная артистка России",
  "Заслуженный артист России",
  "Заслуженная артистка России",
  "Лауреат международного конкурса",
  "Лауреат всероссийского конкурса",
];

// Звание — по словам: «народный артист» выше «заслуженного». Другие звания требованию «не ниже заслуженного
// артиста» не засчитываются: такое сверяет человек.
export const rankOf = (title: string) => (/народн\S*\s+артист/i.test(title) ? 2 : /заслуж\S*\s+артист/i.test(title) ? 1 : 0);

// Заготовка из ответа ИИ: пустые строки по числу людей, которое требует ТЗ. Называть людей не требуется — состава нет.
export function castFromDraft(draft: CastDraft, verify: (quote: string) => boolean): TpCast | undefined {
  const groups = draft.groups
    .filter((g) => g.title.trim())
    .map((g, i) => ({
      ...g,
      key: `g${i}`,
      count: Math.min(Math.max(Math.round(g.count) || 1, 1), 50),
      match: g.match.map((m) => m.trim().toLowerCase()).filter(Boolean),
    }));
  if (!groups.length) return undefined;
  return {
    clause: draft.clause,
    requirement: draft.requirement,
    quote: draft.quote,
    verified: verify(draft.quote),
    groups,
    rows: groups.flatMap((g) => Array.from({ length: g.count }, (_, i) => ({ id: `${g.key}-${i}`, group: g.key, name: "", title: "" }))),
    replace: { ...draft.replace, verified: draft.replace.rule.trim() ? verify(draft.replace.quote) : false },
  };
}

export const rowsOf = (cast: TpCast, key: string) => cast.rows.filter((r) => r.group === key);

// Что требует ТЗ по позиции — под её названием.
export const needLine = (g: CastGroup) =>
  `${g.count === 1 ? "1 человек" : `не менее ${g.count} ${plural(g.count, "человека", "человек", "человек")}`}${
    g.rank !== "none" ? ` · звание не ниже ${RANK_NEED[g.rank]}` : ""
  }`;

export type CastCheck = { ok: boolean; rankFail: boolean; text: string };

// Сверка с ТЗ по каждой позиции: хватает ли людей и нужного звания.
export function castCheck(cast: TpCast): CastCheck[] {
  return cast.groups.map((g) => {
    const named = rowsOf(cast, g.key).filter((r) => r.name.trim());
    const need = LEVEL[g.rank];
    const fit = need ? named.filter((r) => rankOf(r.title) >= need).length : named.length;
    const head = `${g.title}${need ? ` со званием не ниже ${RANK_SHORT[g.rank]}` : ""}`;
    const one = g.count === 1;
    if (fit >= g.count) {
      return { ok: true, rankFail: false, text: `${head} — ${one ? "есть" : `${fit} ${plural(fit, "человек", "человека", "человек")}, по ТЗ не менее ${g.count}`}` };
    }
    if (named.length < g.count) {
      const text = one
        ? "не указан"
        : named.length
          ? `вписано ${named.length}, по ТЗ не менее ${g.count}`
          : `по ТЗ не менее ${g.count} ${plural(g.count, "человека", "человек", "человек")}`;
      return { ok: false, rankFail: false, text: `${head} — ${text}` };
    }
    const blank = named.every((r) => !r.title.trim());
    const text = one ? (blank ? "впишите звание" : "у вписанного нет такого звания") : `с таким званием ${fit}, по ТЗ не менее ${g.count}`;
    return { ok: false, rankFail: true, text: `${head} — ${text}` };
  });
}

// Сколько позиций ещё не закрыто — для «впишите N пунктов».
export const castTodo = (cast: TpCast | undefined) => (cast ? castCheck(cast).filter((c) => !c.ok).length : 0);

// Пометка под строкой: звание не подходит к требованию ТЗ или не вписано.
export function castNote(g: CastGroup, r: CastRow, rankFail: boolean): string {
  const need = LEVEL[g.rank];
  if (!need || !rankFail || !r.name.trim() || rankOf(r.title) >= need) return "";
  return `${r.title.trim() ? "Не вижу нужного звания" : "Впишите звание"}: по ТЗ — не ниже ${RANK_NEED[g.rank]}`;
}

const fold = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");

// Если среди исполнителей тот, кто подписывает заявку, его фамилия в ТП может выдать участника.
export function castLeaks(cast: TpCast | undefined, signer: string): string[] {
  const surname = signer.trim().split(/\s+/)[0] ?? "";
  if (!cast || surname.length < 4) return [];
  return cast.rows.some((r) => fold(r.name.trim().split(/\s+/)[0] ?? "") === fold(surname)) ? [surname] : [];
}

export type CastPerson = { name: string; title: string; rest: string };

const TITLE_WORDS = /артист|лауреат|дипломант|деятел|заслуж|народн|звани/i;

// Список из сообщения или таблицы: человек в строке — ФИО, дальше через запятую роль и звание.
export function parseCast(text: string): CastPerson[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:\d+\s*[.)]|[-–—•*])\s*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s*[,;\t]\s*|\s+[—–-]\s+/).map((x) => x.trim()).filter(Boolean);
      const name = (parts.shift() ?? "").replace(/\s+/g, " ");
      const title = parts.filter((x) => TITLE_WORDS.test(x)).join(", ");
      return { name, title: title.charAt(0).toUpperCase() + title.slice(1), rest: fold(parts.join(" ")) };
    })
    .filter((x) => x.name);
}

// Раскладка по позициям — без ИИ: по роли, если она названа; человек со званием — туда, где звание нужно;
// остальные по порядку в свободные строки позиций без звания, лишние — новыми строками. Кто уже в составе, пропускается.
export function spreadCast(cast: TpCast, text: string, newId: () => string): { cast: TpCast; added: number } {
  const rows = cast.rows.map((r) => ({ ...r }));
  const taken = new Set(rows.map((r) => fold(r.name)).filter(Boolean));
  const people = parseCast(text).filter((x) => {
    const key = fold(x.name);
    if (taken.has(key)) return false;
    taken.add(key);
    return true;
  });
  const empty = (g: CastGroup) => rows.filter((r) => r.group === g.key && !r.name.trim());
  const put = (g: CastGroup, x: CastPerson) => {
    const slot = empty(g)[0];
    if (slot) Object.assign(slot, { name: x.name, title: x.title });
    else rows.push({ id: newId(), group: g.key, name: x.name, title: x.title });
  };
  const left: CastPerson[] = [];
  for (const x of people) {
    const g = cast.groups.find((gr) => gr.match.some((m) => x.rest.includes(fold(m))));
    if (g) put(g, x);
    else left.push(x);
  }
  for (const g of cast.groups.filter((gr) => LEVEL[gr.rank])) {
    for (const slot of empty(g)) {
      const i = left.findIndex((x) => rankOf(x.title) >= LEVEL[g.rank]);
      if (i < 0) break;
      const [x] = left.splice(i, 1);
      Object.assign(slot, { name: x.name, title: x.title });
    }
  }
  const plain = cast.groups.filter((gr) => !LEVEL[gr.rank]);
  const fallback = plain.at(-1) ?? cast.groups[cast.groups.length - 1];
  for (const x of left) put(plain.find((g) => empty(g).length > 0) ?? fallback, x);
  return { cast: { ...cast, rows }, added: people.length };
}

export type CastHint = { name: string; title: string; from: string };

// Люди из составов других закупок — подсказки при наборе фамилии.
export const castHistory = (purchases: { id: string; short: string; tp?: { cast?: TpCast } }[], currentId: string): CastHint[] =>
  purchases
    .filter((p) => p.id !== currentId)
    .flatMap((p) => (p.tp?.cast?.rows ?? []).filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), title: r.title.trim(), from: p.short })));

// По началу любого слова ФИО: «Сок», «Мария», «Соколова М». Кто уже в составе, не предлагается.
export function castHints(history: CastHint[], cast: TpCast, query: string, limit = 6): CastHint[] {
  const q = fold(query);
  if (!q) return [];
  const taken = new Set(cast.rows.map((r) => fold(r.name)));
  const seen = new Set<string>();
  return history
    .filter((h) => {
      const key = fold(h.name);
      if (!key || taken.has(key) || seen.has(key)) return false;
      seen.add(key);
      const words = key.split(" ");
      return words.some((_, i) => words.slice(i).join(" ").startsWith(q));
    })
    .slice(0, limit);
}

// Звания — обычные почётные, по вписанному тексту.
export const titleHints = (query: string) => {
  const q = fold(query);
  return CAST_TITLES.filter((t) => fold(t).includes(q) && fold(t) !== q);
};
