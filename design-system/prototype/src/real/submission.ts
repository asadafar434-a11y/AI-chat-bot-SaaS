import { useMemo } from 'react';
import { completeness, fieldsOf } from '@/lib/fields';
import { fulfillmentOf } from '@/lib/fulfillment';
import type { MyDocument } from '@/lib/me-store';
import type { Profile } from '@/lib/profile';
import type { Purchase } from '@/lib/purchase';
import { registryView } from '@/lib/registry-fill';
import { auditReport, type AuditReport } from '@/lib/submission-audit';
import { validate } from '@/lib/validation-engine';
import type { Fact } from '@/lib/evidence-base';

// Единый расчёт «что с заявкой»: карта полей, итоговая проверка, замечания и риск отклонения. Нужен и шагу «Проверка», и шагу «Пакет» —
// считается в одном месте, чтобы на двух шагах риск и замечания не расходились. ТП берётся таким, как оно уйдёт в файлы (с реестровыми номерами).
export function useSubmission(input: { purchase: Purchase; documents: { name: string; text: string }[]; profile: Profile; myDocs: MyDocument[]; facts: Fact[] }) {
  const { purchase, documents, profile, myDocs, facts } = input;
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const evidence = useMemo(
    () => ({
      experience: myDocs.filter((d) => d.kinds.includes('experience')).length,
      staff: myDocs.filter((d) => d.kinds.includes('staff')).length,
    }),
    [myDocs],
  );
  const registryDocs = useMemo(() => documents.map((d) => ({ name: d.name, text: d.text })), [documents]);
  const shown = useMemo(() => {
    const view = registryView(purchase, registryDocs);
    return view ? { ...purchase, tp: view.tp, tpDraft: view.tpDraft } : purchase;
  }, [purchase, registryDocs]);
  const fields = useMemo(() => fieldsOf({ purchase: shown, profile, evidence }), [shown, profile, evidence]);
  const final = useMemo(() => completeness(shown, fields, profile), [shown, fields, profile]);
  const plans = useMemo(() => fulfillmentOf(purchase, { profile, fields }), [purchase, profile, fields]);
  const validation = useMemo(
    () => validate({ purchase, profile, facts, fields, today, documents }),
    [purchase, profile, facts, fields, today, documents],
  );
  const audit = useMemo(
    (): AuditReport => auditReport({ final, plans, fields, validation, today, deadline: purchase.deadline }),
    [final, plans, fields, validation, today, purchase.deadline],
  );
  return { today, evidence, shown, fields, final, plans, validation, audit };
}
