import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, HelpCircle, Info, XCircle } from '../lib/icons';
import { Badge, Button, Card, Tooltip, cx, type Tone } from './ui';

// Требования заказчика, как их выписал разбор документов: текст, обязательность, тип, срок, числа, как проверить, чем
// подтвердить — и, если участник уже работает с ТП, что он предлагает. Заказчик и участник — две разные стороны: границу
// заказчика («не менее 150 мест») ИИ за участника не заполняет; значение вписывает он сам на шаге «Проверка».
// Вид — прототипа, данные — настоящие: их считает приложение (web/src/lib/requirement-engine.ts, requirement-offers.ts).

export type ReqGroupView = 'who' | 'submit' | 'scope' | 'terms' | 'criteria';
export type ReqStatusView = 'unverified' | 'open' | 'check' | 'met' | 'violated' | 'info';

export type RequirementRowView = {
  id: string;
  group: ReqGroupView;
  text: string;
  mandatory: { text: string; tone: Tone };
  type: string;
  // Числовые условия заказчика: choice — значение выбирает участник, term — срок заказчика, exact — точное значение.
  conditions: { text: string; kind: 'choice' | 'term' | 'exact' }[];
  deadline: string;
  status: ReqStatusView;
  statusText: string;
  source: string;
  quote: string;
  quoteFound: boolean;
  // Где цитата в файлах закупки (doc-locate.ts); нет — не нашлась или карты нет.
  where?: string;
  check: string;
  evidence: string[];
  issues: string[];
  // Что предложено в ТП по этому требованию: текст со «[…]» на месте значений участника, что с ним и что не подходит.
  offer?: { text: string; note: string; problems: string[] };
};

const GROUPS: { key: ReqGroupView | 'all'; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'who', label: 'Кто участвует' },
  { key: 'submit', label: 'Что подать' },
  { key: 'scope', label: 'ТЗ' },
  { key: 'terms', label: 'Сроки и деньги' },
  { key: 'criteria', label: 'Оценка' },
];

const STATUS: Record<ReqStatusView, { tone: Tone; hint: string; icon: typeof Info }> = {
  unverified: { tone: 'warn', hint: 'Цитата не найдена в документах дословно или в пункте есть числа, которых нет в цитате. Сверьте с документом.', icon: AlertTriangle },
  open: { tone: 'info', hint: 'Нужно ваше значение или документ. Заказчик назвал только границу — что предложить, решаете вы.', icon: HelpCircle },
  check: { tone: 'warn', hint: 'В заявке есть ответ, но его проверяет человек: ИИ ответ не утверждает.', icon: AlertTriangle },
  met: { tone: 'success', hint: 'Значение, которое вписали вы, подходит под требование заказчика.', icon: CheckCircle2 },
  violated: { tone: 'danger', hint: 'Вписанное значение не подходит под требование заказчика — заявку могут отклонить.', icon: XCircle },
  info: { tone: 'neutral', hint: 'Условие заказчика: вписывать нечего, достаточно знать.', icon: Info },
};

const CONDITION_HINT = {
  choice: 'Заказчик назвал границу. Значение выбираете вы, ИИ его не подставляет.',
  term: 'Срок или условие заказчика. Участник принимает его как написано.',
  exact: 'Точное значение, которое называет заказчик.',
};

const PAGE = 15;

// «Зал на [число, не меньше 150] мест» — места, которые вписывает участник, выделены.
function Offer({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\])/).filter(Boolean);
  return (
    <p className="whitespace-pre-wrap break-words rounded-md bg-secondary/60 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
      {parts.map((part, i) => (/^\[[^\]]+\]$/.test(part) ? <mark key={i} className="highlight">{part}</mark> : <span key={i}>{part}</span>))}
    </p>
  );
}

export function RequirementsList({
  rows,
  onFix,
  initialOpen = null,
}: {
  rows: RequirementRowView[];
  // Перейти на шаг «Проверка» — вписать свои значения.
  onFix: () => void;
  initialOpen?: string | null;
}) {
  const [group, setGroup] = useState<ReqGroupView | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(initialOpen);
  const [limit, setLimit] = useState(PAGE);
  if (rows.length === 0) return null;

  const count = (key: ReqGroupView | 'all') => (key === 'all' ? rows.length : rows.filter((r) => r.group === key).length);
  const shown = rows.filter((r) => group === 'all' || r.group === group);
  const open = rows.filter((r) => r.status === 'open' || r.status === 'violated').length;
  const doubt = rows.filter((r) => r.status === 'unverified').length;

  return (
    <section aria-labelledby="req-title" className="space-y-3">
      <div>
        <h2 id="req-title" className="text-lg font-semibold tracking-tight">
          Требования заказчика
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Что заказчик требует по документам — с обязательностью, сроком, числами и тем, как это проверят. Что предложите вы — отдельно: заказчик
          называет границу («не менее 150»), а значение выбираете вы, ИИ его не подставляет.
          {open > 0 && <> Ждут ваших данных: {open}.</>}
          {doubt > 0 && <> Сверить с документом: {doubt}.</>}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Группы требований">
        {GROUPS.filter((g) => count(g.key) > 0).map((g) => (
          <button
            key={g.key}
            type="button"
            aria-pressed={group === g.key}
            onClick={() => {
              setGroup(g.key);
              setLimit(PAGE);
            }}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors',
              group === g.key ? 'border-foreground bg-secondary text-foreground' : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
          >
            {g.label}
            <span className="font-mono font-semibold tabular-nums text-foreground">{count(g.key)}</span>
          </button>
        ))}
      </div>

      <ul className="space-y-2" aria-label="Требования заказчика">
        {shown.slice(0, limit).map((r) => {
          const meta = STATUS[r.status];
          const Icon = meta.icon;
          const expanded = openId === r.id;
          return (
            <li key={r.id} className={cx('rounded-lg border bg-card transition-all duration-300', expanded ? 'border-foreground/30' : 'border-border')}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpenId(expanded ? null : r.id)}
                className="flex w-full items-start gap-3 rounded-lg p-3.5 text-left transition-colors hover:bg-secondary/40"
              >
                <Icon
                  className={cx(
                    'mt-0.5 size-4 shrink-0',
                    meta.tone === 'success' ? 'text-success' : meta.tone === 'danger' ? 'text-danger' : meta.tone === 'warn' ? 'text-warn' : meta.tone === 'info' ? 'text-info' : 'text-muted-foreground',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-[13px] font-medium leading-snug">{r.text}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge tone={r.mandatory.tone}>{r.mandatory.text}</Badge>
                    <Badge tone="neutral">{r.type}</Badge>
                    {/* Срок заказчика уже виден строкой «срок: …» словами документа — второй раз цифрами не повторяем. */}
                    {r.conditions.filter((c) => !(c.kind === 'term' && r.deadline)).map((c, i) => (
                      <Tooltip key={i} content={CONDITION_HINT[c.kind]} align="start">
                        <span
                          className={cx(
                            'rounded-md border px-1.5 py-0.5 font-mono text-[11px]',
                            c.kind === 'choice' ? 'border-info/40 bg-info/10 text-info' : 'border-border bg-secondary/60 text-muted-foreground',
                          )}
                        >
                          {c.text}
                        </span>
                      </Tooltip>
                    ))}
                    {r.deadline && <span className="break-words text-[11px] text-muted-foreground">срок: {r.deadline}</span>}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="hidden sm:block">
                    <Tooltip content={meta.hint} align="end">
                      <Badge tone={meta.tone}>{r.statusText}</Badge>
                    </Tooltip>
                  </span>
                  <ChevronRight className={cx('size-4 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
                </span>
              </button>

              {expanded && (
                <div className="animate-fade-up space-y-2.5 border-t border-border px-3.5 py-3 pl-10 text-[13px] leading-snug">
                  {/* На телефоне значок статуса справа скрыт — слово о статусе здесь. */}
                  <p className="break-words text-muted-foreground">
                    <span className="font-medium text-foreground">Статус: </span>
                    {r.statusText} — {meta.hint}
                  </p>
                  <p className="break-words text-muted-foreground">
                    <span className="font-medium text-foreground">Где написано: </span>
                    {r.source || 'в документах закупки'}
                    {r.quote && <> — «{r.quote}»</>}
                    {!r.quoteFound && r.quote && <span className="text-warn-foreground"> · цитата не найдена в документах дословно — сверьте вручную</span>}
                  </p>
                  {r.where && (
                    <p className="break-words text-muted-foreground">
                      <span className="font-medium text-foreground">Место в файле: </span>
                      {r.where}
                    </p>
                  )}
                  {r.check && (
                    <p className="break-words text-muted-foreground">
                      <span className="font-medium text-foreground">Как проверят: </span>
                      {r.check}
                    </p>
                  )}
                  {r.evidence.length > 0 && (
                    <p className="break-words text-muted-foreground">
                      <span className="font-medium text-foreground">Чем подтвердить: </span>
                      {r.evidence.join('; ')}
                    </p>
                  )}
                  {r.issues.length > 0 && (
                    <ul className="space-y-1 rounded-md bg-warn-surface/40 px-2.5 py-2 text-warn-foreground">
                      {r.issues.map((issue) => (
                        <li key={issue} className="flex items-start gap-1.5">
                          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                          <span className="min-w-0 break-words">{issue}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {r.group === 'scope' && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="min-w-0 rounded-md border border-border p-2.5">
                        <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Требует заказчик</p>
                        <p className="mt-1 break-words">
                          {r.conditions.length > 0 ? r.conditions.map((c) => c.text).join('; ') : r.text}
                        </p>
                      </div>
                      <div className="min-w-0 rounded-md border border-border p-2.5">
                        <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Предлагаете вы</p>
                        {r.offer ? (
                          <div className="mt-1 space-y-1.5">
                            <Offer text={r.offer.text} />
                            <p className="break-words text-[12px] text-muted-foreground">{r.offer.note}</p>
                            {r.offer.problems.map((p) => (
                              <p key={p} className="break-words text-[12px] text-danger">
                                {p}
                              </p>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-1 text-muted-foreground">
                            {r.status === 'info' ? 'ТП ещё не составлено — предложение появится на шаге «Проверка».' : 'В ТП нет строки по этому требованию — проверьте на шаге «Проверка».'}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {r.group === 'scope' && (r.status === 'open' || r.status === 'violated' || r.status === 'check') && (
                    <div>
                      <Button size="sm" variant="secondary" onClick={onFix}>
                        Вписать своё значение →
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {shown.length > limit && (
        <Card className="p-3 text-center">
          <Button size="sm" variant="ghost" onClick={() => setLimit(limit + PAGE)}>
            Показать ещё {Math.min(PAGE, shown.length - limit)}
            {shown.length - limit > PAGE && <> (осталось {shown.length - limit})</>}
          </Button>
        </Card>
      )}
    </section>
  );
}
