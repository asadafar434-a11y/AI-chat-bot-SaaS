import { lawText, procedureOf, progressOf, statusOf } from '@/lib/dashboard';
import type { Profile } from '@/lib/profile';
import { titleOf, type Purchase } from '@/lib/purchase';
import { parseRubles } from '@/lib/rub-words';
import { stepsOf } from '@/lib/steps';
import type { Procedure, TenderCard } from '../lib/data';

// Закупка из хранилища → карточка списка «Мои закупки» в виде прототипа. Статус и готовность считаются из самой закупки.
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export function dateText(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

export function procedureKind(p: Purchase): Procedure {
  const kind = p.kind.toLowerCase();
  if (/котировк/.test(kind)) return 'quotation';
  if (/конкурс|запрос предложений/.test(kind)) return 'contest';
  if (/единственн/.test(kind)) return 'single';
  return 'auction';
}

// profile — реквизиты участника: по ним видно, что ИП устав не нужен, и готовность закупки в списке совпадает с «Пакетом».
export function toTender(p: Purchase, profile?: Profile): TenderCard {
  const steps = stepsOf(p, profile);
  return {
    id: p.id,
    title: titleOf(p),
    customer: p.customer,
    nmck: parseRubles(p.price) ?? 0,
    law: lawText(p),
    procedure: procedureKind(p),
    procedureLabel: procedureOf(p),
    deadline: dateText(p.deadline.date),
    status: statusOf(p, steps),
    progress: progressOf(steps, p.submitted),
    docsLoaded: p.files.length,
    docsTotal: p.files.length + p.unreadable.length,
    sample: p.sample,
  };
}
