import { useMemo, useState } from 'react';
import { castHistory, castLeaks } from '@/lib/cast';
import { applyField, completeness, fieldsOf } from '@/lib/fields';
import { samplesOf } from '@/lib/me-store';
import { plural } from '@/lib/plural';
import { identityValues } from '@/lib/profile';
import { aiHeaders } from '@/lib/purchase';
import { scanWarning } from '@/lib/read-documents';
import { sampleTp } from '@/lib/sample-purchase';
import type { TpResult } from '@/lib/tp';
import { SAMPLE_CAST_HISTORY, SAMPLE_CAST_LIST } from '@/lib/tp-sample';
import { usePurchases } from '@/lib/use-purchases';
import { Button, Card } from '../components/ui';
import { Loader2, AlertTriangle } from '../lib/icons';
import { CastCard } from '../components/CastCard';
import { OwnCheck } from '../components/OwnCheck';
import { StepReview } from '../components/StepReview';
import { useProfile } from './analysis';
import { useMyDocs } from './hooks';
import { usePurchase } from './purchase-provider';

// Составить документы заявки: ИИ находит в документах закупки форму заявки и заполняет её — техническое предложение,
// декларацию, цену. Это платный запрос к ИИ, по кнопке. В примере — заготовка без запроса.
function ComposeCard({ onDone }: { onDone: () => void }) {
  const { purchase, documents, update } = usePurchase();
  const my = useMyDocs();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const samples = samplesOf(my.docs, 'tp');

  async function compose() {
    setWorking(true);
    setError('');
    try {
      let next: TpResult;
      if (purchase.sample) {
        next = sampleTp();
      } else {
        const res = await fetch('/api/tp', {
          method: 'POST',
          headers: aiHeaders(purchase.id),
          body: JSON.stringify({ documents, samples: samples.map(({ name, text }) => ({ name, text })) }),
        });
        if (!res.ok) throw new Error((await res.text()) || 'Не удалось составить черновик.');
        next = await res.json();
      }
      // Черновик ИИ хранится отдельно: по нему карта полей видит, какие жёлтые места участник уже вписал.
      update({ tp: next, tpDraft: next });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Проверка перед подачей</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Документы заявки ещё не составлены.</p>
      </div>
      <Card className="space-y-3 p-5">
        {working ? (
          <p className="flex items-center gap-2.5 text-sm">
            <Loader2 className="size-4 animate-spin" /> ИИ читает ТЗ и составляет документы заявки — до минуты…
          </p>
        ) : (
          <>
            <p className="text-sm font-medium">Составить документы заявки</p>
            <p className="max-w-[70ch] text-[13px] text-muted-foreground">
              Найду в документах закупки форму заявки и заполню её, как тендерный юрист: техническое предложение с товарами и
              предложением по пунктам ТЗ, а если их требует заказчик — декларацию, цену и анкету. Вам останется вписать то,
              что знаете только вы, — здесь же, по списку.
            </p>
            <p className="text-[12px] text-muted-foreground">
              {purchase.sample
                ? 'В примере — готовая заготовка, запроса к ИИ не будет.'
                : samples.length > 0
                  ? `Пишу по вашим техническим предложениям: ${samples.length} из «Профиля компании».`
                  : 'Черновик будет в общем стиле. Загрузите свои прошлые заявки в «Профиле компании» — и ТП будет написано так, как пишете вы.'}
            </p>
            {error && (
              <p className="flex items-start gap-2 rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> <span className="min-w-0 break-words">{error}</span>
              </p>
            )}
            <Button onClick={() => void compose()}>Составить документы</Button>
          </>
        )}
      </Card>
    </div>
  );
}

// Шаг «Проверка» на настоящей закупке: карта полей заявки, вписанное сразу уходит в документы.
export function PurchaseReview({
  onGo,
  onOpenProfile,
  onNext,
  onBack,
}: {
  onGo: (step: number) => void;
  onOpenProfile: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { purchase, documents, update } = usePurchase();
  // Составы других закупок — подсказки при наборе фамилии в составе исполнителей.
  const { purchases } = usePurchases();
  const profile = useProfile();
  const my = useMyDocs();
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const tp = purchase.tp;

  const fields = useMemo(
    () =>
      fieldsOf({
        purchase,
        profile,
        evidence: {
          experience: my.docs.filter((d) => d.kinds.includes('experience')).length,
          staff: my.docs.filter((d) => d.kinds.includes('staff')).length,
        },
      }),
    [purchase, profile, my.docs],
  );
  const final = useMemo(() => completeness(purchase, fields), [purchase, fields]);

  // Что не попадёт в карту полей, но может стоить заявки: ТП подают анонимно, цитаты сверяют, сканы читаются неточно.
  const warnings = useMemo(() => {
    if (!tp) return [];
    // Всё, что уйдёт в техническое предложение: в нём не должно быть ничего, что раскрывает участника.
    const tpText = [tp.form.consent, ...tp.goods.flatMap((g) => [g.name, g.characteristics]), ...tp.items.map((it) => it.offer)].join(' ');
    const leaks = identityValues(profile).filter((value) => tpText.includes(value));
    const ownLeaks = castLeaks(tp.cast, profile.signer);
    const unverified = [...tp.goods, ...tp.items].filter((row) => !row.verified).length;
    return [
      leaks.length > 0 &&
        `В техническом предложении есть ваши данные: ${leaks.map((v) => `«${v}»`).join(', ')}. Уберите их — ТП подают в первую часть заявки анонимно, иначе заявку отклонят.`,
      ownLeaks.length > 0 &&
        `Среди исполнителей — ${ownLeaks.map((v) => `«${v}»`).join(', ')}, как в подписи заявки. ТП подают в первую часть заявки анонимно: прежде чем подавать, уточните у юриста, не раскроет ли это участника.`,
      unverified > 0 &&
        `В ${unverified} ${plural(unverified, 'строке', 'строках', 'строках')} цитата не найдена в документах дословно — сверьте их вручную.`,
      scanWarning(documents),
    ].filter((w): w is string => Boolean(w));
  }, [tp, profile, documents]);

  if (!purchase.tp) return <ComposeCard onDone={() => window.scrollTo({ top: 0 })} />;
  if (!my.ready) return <p className="text-sm text-muted-foreground">Сверяю документы с реквизитами…</p>;

  return (
    <StepReview
      purchase={purchase}
      fields={fields}
      final={final}
      warnings={warnings}
      before={
        tp?.cast ? (
          <CastCard
            cast={tp.cast}
            history={[...castHistory(purchases ?? [], purchase.id), ...(purchase.sample ? SAMPLE_CAST_HISTORY : [])]}
            sample={purchase.sample ? SAMPLE_CAST_LIST : undefined}
            onChange={(cast) => update({ tp: { ...tp, cast } })}
          />
        ) : undefined
      }
      after={<OwnCheck />}
      focusKey={focusKey}
      onFocus={setFocusKey}
      onSave={(key, value) => {
        const patch = applyField(purchase, key, value);
        if (patch) update(patch);
      }}
      onGo={onGo}
      onOpenProfile={onOpenProfile}
      onNext={onNext}
      onBack={onBack}
    />
  );
}
