import { useEffect, useMemo, useState } from 'react';
import { describeCondition } from '@/lib/conditions';
import { onDataChanged } from '@/lib/db';
import { createLocator, describeSource, type Located } from '@/lib/doc-locate';
import { fieldsOf } from '@/lib/fields';
import { fulfillmentOf, type PlanStatus } from '@/lib/fulfillment';
import { participantFromPlatform } from '@/lib/law-kind';
import { getProfile } from '@/lib/me-store';
import { EMPTY_PROFILE, type Profile } from '@/lib/profile';
import { requirementViews, STATUS_TEXT, type Offer, type RequirementView } from '@/lib/requirement-offers';
import { MANDATORY_TEXT, TYPE_TEXT } from '@/lib/requirements';
import type { CheckStatus } from '../lib/data';
import type { RequirementRowView } from '../components/RequirementsList';
import { StepAnalysis, type AnalysisRow } from '../components/StepAnalysis';
import { usePurchase } from './purchase-provider';

const STATUS: Record<Exclude<PlanStatus, 'none'>, CheckStatus> = { done: 'ok', confirm: 'warn', todo: 'missing' };

const MANDATORY_TONE = { required: 'neutral', optional: 'success', conditional: 'warn', scored: 'info', unclear: 'neutral' } as const;

// Что сказать про предложение участника: что вписано, что ждёт значения, что подобрал ИИ.
function offerNote(o: Offer): string {
  const bits = [
    o.open > 0 && `ждёт вашего значения: ${o.open}`,
    o.filled > 0 && `вы вписали: ${o.filled}`,
    o.confirm > 0 && 'значение подобрал ИИ — подтвердите на шаге «Проверка»',
  ].filter(Boolean);
  return bits.length > 0 ? bits.join(' · ') : 'ИИ написал ответ словами — проверьте его на шаге «Проверка»';
}

function toRow(v: RequirementView, whereOf: (quote: string) => string | undefined): RequirementRowView {
  return {
    id: v.id,
    group: v.group,
    text: v.text,
    mandatory: { text: MANDATORY_TEXT[v.mandatory], tone: MANDATORY_TONE[v.mandatory] },
    type: TYPE_TEXT[v.type],
    conditions: v.numbers.map((c) => ({ text: describeCondition(c), kind: c.term ? 'term' : c.op === 'exact' ? 'exact' : 'choice' })),
    deadline: v.deadline,
    status: v.status,
    statusText: STATUS_TEXT[v.status],
    source: v.source,
    quote: v.quote,
    quoteFound: v.verified,
    where: v.quote ? whereOf(v.quote) : undefined,
    check: v.checkText,
    evidence: v.evidence,
    issues: v.issues,
    ...(v.offer && { offer: { text: v.offer.rows.map((r) => r.text).join('\n'), note: offerNote(v.offer), problems: v.offer.problems } }),
  };
}

// Реквизиты участника: из «Профиля компании»; перечитываются, когда их правят.
export function useProfile(): Profile {
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  useEffect(() => {
    let alive = true;
    const load = () => getProfile().then((p) => alive && setProfile(p), () => {});
    void load();
    const off = onDataChanged(() => void load());
    return () => {
      alive = false;
      off();
    };
  }, []);
  return profile;
}

// Шаг «Анализ» на настоящей закупке: пункты «Что подать» и способ их выполнить.
export function PurchaseAnalysis({ onNext, onBack, onFix }: { onNext: () => void; onBack: () => void; onFix: (at: 'review' | 'package') => void }) {
  const { purchase, documents } = usePurchase();
  const profile = useProfile();
  // Где в файлах закупки стоит цитата каждого пункта — страница, таблица, строка, пункт (lib/doc-locate.ts).
  const locator = useMemo(() => createLocator(documents), [documents]);
  const { rows, hidden, requirements } = useMemo(() => {
    const fields = fieldsOf({ purchase, profile });
    const plans = fulfillmentOf(purchase, { profile, fields });
    // Место каждой цитаты находится один раз: оно нужно и строке «Что подать», и списку требований, и привязке ТП к требованию.
    const found = new Map<string, Located | null>();
    const locate = (quote: string) => {
      if (!found.has(quote)) found.set(quote, quote ? locator.locate(quote) : null);
      return found.get(quote)!;
    };
    const whereOf = (quote: string) => {
      const place = locate(quote);
      return place ? describeSource(place) : undefined;
    };
    const requirements = requirementViews(purchase, { locate, fields, plans }).map((v) => toRow(v, whereOf));
    const rows: AnalysisRow[] = plans
      .filter((p) => p.status !== 'none')
      .map((p, i) => {
        const place = p.item.quote ? locate(p.item.quote) : null;
        return {
          id: `plan-${i}`,
          title: p.title,
          ref: p.basis,
          status: STATUS[p.status as Exclude<PlanStatus, 'none'>],
          note: p.todo,
          auto: p.mode === 'compose',
          file: p.mode === 'compose' || p.mode === 'upload',
          source: p.item.source,
          quote: p.item.quote,
          quoteFound: p.item.verified,
          ...(place && { where: describeSource(place) }),
          fixAt: p.mode === 'compose' ? 'review' : 'package',
        } satisfies AnalysisRow;
      });
    return { rows, hidden: plans.length - rows.length, requirements };
  }, [purchase, profile, locator]);

  const way = purchase.kind.split('·').slice(1).join('·').trim();
  return (
    <StepAnalysis
      rows={rows}
      requirements={requirements}
      kindText={way}
      fromPlatform={participantFromPlatform(purchase.kind)}
      hidden={hidden}
      onNext={onNext}
      onBack={onBack}
      onFix={onFix}
    />
  );
}
