import { useEffect, useMemo, useState } from 'react';
import { onDataChanged } from '@/lib/db';
import { createLocator, describeSource } from '@/lib/doc-locate';
import { fieldsOf } from '@/lib/fields';
import { fulfillmentOf, type PlanStatus } from '@/lib/fulfillment';
import { participantFromPlatform } from '@/lib/law-kind';
import { getProfile } from '@/lib/me-store';
import { EMPTY_PROFILE, type Profile } from '@/lib/profile';
import type { CheckStatus } from '../lib/data';
import { StepAnalysis, type AnalysisRow } from '../components/StepAnalysis';
import { usePurchase } from './purchase-provider';

const STATUS: Record<Exclude<PlanStatus, 'none'>, CheckStatus> = { done: 'ok', confirm: 'warn', todo: 'missing' };

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
  const { rows, hidden } = useMemo(() => {
    const plans = fulfillmentOf(purchase, { profile, fields: fieldsOf({ purchase, profile }) });
    const rows: AnalysisRow[] = plans
      .filter((p) => p.status !== 'none')
      .map((p, i) => {
        const place = p.item.quote ? locator.locate(p.item.quote) : null;
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
    return { rows, hidden: plans.length - rows.length };
  }, [purchase, profile, locator]);

  const way = purchase.kind.split('·').slice(1).join('·').trim();
  return (
    <StepAnalysis
      rows={rows}
      kindText={way}
      fromPlatform={participantFromPlatform(purchase.kind)}
      hidden={hidden}
      onNext={onNext}
      onBack={onBack}
      onFix={onFix}
    />
  );
}
