import { AUTO_TOTAL, gaps, requiredDocs, type CheckStatus, type Gap, type RequiredDoc } from './data';

// Состояние одной заявки в прототипе. В приложении то же хранится в закупке (web/src/lib/purchase.ts).
export type Fixes = Record<string, string>;

export type Remark = { tone: 'ok' | 'warn' | 'danger'; text: string; gapId?: string };
export type Specialist = { status: 'sent' | 'replied'; read: boolean; remarks: Remark[] };

export type AppState = {
  // Что участник вписал, выбрал, приложил или подтвердил: id поля → значение.
  fixes: Fixes;
  paid: boolean;
  // Оплачена заявкой из купленного пакета, а не отдельно.
  fromPackage?: boolean;
  // Сколько раз запускали полный повторный разбор ИИ и по каким данным — последний раз.
  rechecks: number;
  checkedKey: string | null;
  // Сколько пакетов «ещё 3 пересчёта за 99 ₽» куплено для этой заявки.
  recheckPacks: number;
  // Версия документов: 1 — первая генерация.
  generation: number;
  specialist: Specialist | null;
  // Снижение от НМЦК, %.
  discount: number;
};

export const freshApp = (): AppState => ({
  fixes: {},
  paid: false,
  rechecks: 0,
  checkedKey: null,
  recheckPacks: 0,
  generation: 1,
  specialist: null,
  discount: 6.5,
});

export type GapState = 'open' | 'invalid' | 'done';

// «Скорость печати МФУ» → «скорость печати МФУ»: аббревиатуры не трогаем.
export const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

const toNum = (s: string) => Number((/\d+(?:[.,]\d+)?/.exec(s)?.[0] ?? '').replace(',', '.'));

export function gapState(gap: Gap, fixes: Fixes): GapState {
  const v = fixes[gap.id]?.trim();
  if (!v) return 'open';
  if (gap.kind === 'choice') return gap.choices!.find((c) => c.label === v)?.ok ? 'done' : 'open';
  if (gap.min !== undefined) {
    const n = toNum(v);
    if (!Number.isFinite(n) || n === 0 || n < gap.min) return 'invalid';
  }
  return 'done';
}

// Почему вписанное не подходит — как в карте полей приложения: «25 — по ТЗ не меньше 30».
export function gapProblem(gap: Gap, fixes: Fixes): string | null {
  if (gapState(gap, fixes) !== 'invalid') return null;
  const n = toNum(fixes[gap.id] ?? '');
  return Number.isFinite(n) && n > 0 ? `${n} — по ТЗ не меньше ${gap.min}` : `нужно число, по ТЗ не меньше ${gap.min}`;
}

export const isResolved = (gap: Gap, fixes: Fixes) => gapState(gap, fixes) === 'done';
export const openGaps = (fixes: Fixes) => gaps.filter((g) => !isResolved(g, fixes));

// Оценка риска отклонения — сумма весов открытых пунктов: критичное — 35, важное — 10–18, уточнение — 3–7.
// Это не вероятность, а шкала: чем больше незакрытого, тем выше.
export function riskOf(fixes: Fixes) {
  const open = openGaps(fixes);
  const weight = open.reduce((s, g) => s + g.weight, 0);
  const pct = weight === 0 ? 3 : Math.min(74, weight + 2);
  return {
    pct,
    level: pct >= 30 ? 'высокий' : pct >= 10 ? 'средний' : 'низкий',
    critical: open.some((g) => g.severity === 'high'),
    open,
  };
}

// Сводка «Заполнение заявки»: сколько заполнено само, что подтвердить, что вписать, что не определено.
export function fieldCounts(fixes: Fixes) {
  const openOf = (kind: Gap['field']) => gaps.filter((g) => g.field === kind && !isResolved(g, fixes)).length;
  const resolved = gaps.filter((g) => isResolved(g, fixes)).length;
  const total = AUTO_TOTAL + gaps.length;
  const done = AUTO_TOTAL + resolved;
  return {
    auto: AUTO_TOTAL,
    confirm: openOf('confirm'),
    manual: openOf('manual'),
    unknown: openOf('unknown'),
    invalid: gaps.filter((g) => gapState(g, fixes) === 'invalid').length,
    sign: 1,
    done,
    total,
    share: done / total,
  };
}

// Статус документа из «Анализа» с учётом того, что уже исправлено на «Проверке».
const DOC_GAPS: Record<string, string[]> = {
  goods: ['poz2-storage', 'poz3-speed', 'poz4-power', 'country'],
  cert: ['cert-poz3'],
  registry: ['registry'],
  guarantee: ['guarantee'],
  deal: ['deal'],
};

export function docStatus(doc: RequiredDoc, fixes: Fixes): CheckStatus {
  const ids = DOC_GAPS[doc.id];
  if (!ids) return doc.status;
  const done = ids.every((id) => isResolved(gaps.find((g) => g.id === id)!, fixes));
  return done ? 'ok' : doc.status;
}

// Сначала то, без чего заявку отклонят, потом — что требует внимания, готовое — вниз.
const ORDER: Record<CheckStatus, number> = { missing: 0, warn: 1, ok: 2 };
export const sortedDocs = (fixes: Fixes) =>
  requiredDocs
    .map((doc, i) => ({ doc, i, status: docStatus(doc, fixes) }))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.i - b.i);

const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 100;
  const b = n % 10;
  return `${n} ${a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many}`;
};

// Итоговая проверка перед скачиванием — ни одного пустого обязательного поля. Тексты — как в приложении
// (web/src/lib/fields.ts, completeness). Подпись сервис не ставит: комплект готов, когда осталось подписать.
export function completeness(fixes: Fixes) {
  const need = gaps.filter((g) => g.field === 'manual' || g.field === 'unknown');
  const confirms = gaps.filter((g) => g.field === 'confirm');
  const empty = need.filter((g) => gapState(g, fixes) === 'open').length;
  const invalid = gaps.filter((g) => gapState(g, fixes) === 'invalid').length;
  const confirmed = confirms.filter((g) => isResolved(g, fixes)).length;
  const files = requiredDocs.filter((d) => d.file);
  const readyFiles = files.filter((d) => docStatus(d, fixes) === 'ok').length;
  const blocking = [
    ...(empty ? [`не заполнено обязательных полей: ${empty}`] : []),
    ...(invalid ? [`с ошибкой: ${plural(invalid, 'поле', 'поля', 'полей')}`] : []),
    ...(confirms.length - confirmed ? [`не подтверждено: ${confirms.length - confirmed}`] : []),
    ...(files.length - readyFiles ? [`не готово документов: ${files.length - readyFiles} из ${files.length}`] : []),
  ];
  const ready = blocking.length === 0;
  return {
    fields: { required: AUTO_TOTAL + need.length, filled: AUTO_TOTAL + need.length - empty - invalid, empty, invalid },
    documents: { required: files.length, ready: readyFiles },
    confirmations: { required: confirms.length, done: confirmed },
    signatures: { required: 1, done: 0 },
    ready,
    text: ready
      ? 'Формальный комплект заявки сформирован. Осталось подписать его электронной подписью и подать на площадке.'
      : `Заявка ещё не готова к подаче: ${blocking.join(', ')}.`,
  };
}

// Отпечаток данных заявки: если с прошлого пересчёта ничего не менялось, ИИ не вызывается —
// показывается сохранённый результат, попытка не списывается.
export const checkKey = (fixes: Fixes) => JSON.stringify(Object.entries(fixes).sort());

// Замечания специалиста — по тому, что было открыто, когда пакет ушёл на проверку, и то, чего ИИ не видит.
export function expertRemarks(fixes: Fixes): Remark[] {
  const open = openGaps(fixes);
  const has = (id: string) => open.some((g) => g.id === id);
  const out: Remark[] = [];
  if (has('cert-poz3')) out.push({ tone: 'danger', text: 'Приложите сертификат соответствия на МФУ — без него заявку отклонят.', gapId: 'cert-poz3' });
  if (has('guarantee')) out.push({ tone: 'warn', text: 'Подтвердите, что 42 800 ₽ лежат на спецсчёте, до подачи.', gapId: 'guarantee' });
  if (has('registry')) out.push({ tone: 'warn', text: 'Впишите номера реестровых записей для МФУ и ИБП или отметьте товар иностранным.', gapId: 'registry' });
  if (has('file-unread')) out.push({ tone: 'warn', text: 'Прочитайте стр. 4–5 «Приложения 3 к ТЗ»: там может быть требование к заявке.', gapId: 'file-unread' });
  const chars = open.filter((g) => ['poz2-storage', 'poz3-speed', 'poz4-power'].includes(g.id));
  if (chars.length) out.push({ tone: 'warn', text: `Допишите характеристики: ${chars.map((g) => lcFirst(g.label)).join('; ')}.`, gapId: chars[0].id });
  const confirms = open.filter((g) => g.field === 'confirm' && g.id !== 'guarantee');
  if (confirms.length) out.push({ tone: 'warn', text: `Подтвердите: ${confirms.map((g) => lcFirst(g.label)).join('; ')}.`, gapId: confirms[0].id });
  out.push({ tone: 'warn', text: 'Проверьте срок действия сертификата: он должен действовать на дату поставки.', gapId: 'cert-poz3' });
  if (open.length === 0) out.unshift({ tone: 'ok', text: 'Заявка соответствует требованиям извещения — можно подписывать и подавать.' });
  return out;
}

export const expertConclusion = (remarks: Remark[]) =>
  remarks.some((r) => r.tone === 'danger')
    ? 'Заключение: подавать можно только после устранения критичного замечания.'
    : remarks.some((r) => r.tone === 'warn' && r.gapId && r.text.startsWith('Проверьте') === false)
      ? 'Заключение: заявку можно подавать после устранения замечаний.'
      : 'Заключение: замечаний по составу нет, заявку можно подписывать.';
