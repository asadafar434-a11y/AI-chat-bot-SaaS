import { useCallback, useMemo, useState } from 'react';
import { buildReport, type BuildReport } from '@/lib/application-builder';
import { auditReport, type AuditReport } from '@/lib/submission-audit';
import { scoringReport, type ScoringReport } from '@/lib/scoring-engine';
import { validate } from '@/lib/validation-engine';
import { NO_CRITERIA } from '@/lib/criteria';
import { fileRows, submitItems, toggleReady } from '@/lib/application-files';
import { tpChanges } from '@/lib/doc-changes';
import { createLocator, describeSource } from '@/lib/doc-locate';
import { completeness, fieldsOf } from '@/lib/fields';
import { FILE_FORMATS, type FileFormat } from '@/lib/file-format';
import type { PartDoc } from '@/lib/part-doc';
import { filledCount, PROFILE_KEYS } from '@/lib/profile';
import { fulfillmentOf } from '@/lib/fulfillment';
import type { PartKey } from '@/lib/my-docs';
import { PART_TITLES, partsOf, type TpPart } from '@/lib/tp-parts';
import type { DetectedForm } from '@/lib/tp';
import { formPage } from '@/lib/form-pages';
import { useApplicationFilesOf } from '@/lib/use-application-files';
import { ApplicationText, MarkedText } from '../components/ApplicationPreview';
import { DocsChanged } from '../components/DocsChanged';
import { StepPackage, type PackagePreview, type PackageRow } from '../components/StepPackage';
import { AlertTriangle } from '../lib/icons';
import { useProfile } from './analysis';
import { useFacts, useMyDocs } from './hooks';
import { usePurchase } from './purchase-provider';

// Документ, который ИИ составил по форме заказчика: заголовок, абзацы и таблицы; пропуски «[…]» — жёлтые.
function PartBody({ doc }: { doc: PartDoc }) {
  return (
    <div className="space-y-3 text-[13px] leading-relaxed">
      <p className="text-center text-sm font-semibold">
        <MarkedText text={doc.title} />
      </p>
      {doc.blocks.map((b, i) => {
        if (b.type === 'table')
          return (
            <div key={i} className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <tbody>
                  {b.rows.map((row, r) => (
                    <tr key={r} className={r === 0 ? 'bg-secondary/40 font-medium' : ''}>
                      {row.map((cell, c) => (
                        <td key={c} className="border border-border px-2 py-1 align-top">
                          <MarkedText text={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        return (
          <p key={i} className={b.type === 'heading' ? 'text-center font-semibold' : 'whitespace-pre-wrap'}>
            <MarkedText text={b.text} />
          </p>
        );
      })}
    </div>
  );
}

// Оценка баллов и что не засчитают — для участника; в файл Word это не попадает.
const scoreOf = (doc: PartDoc) =>
  doc.score || doc.gaps?.length ? (
    <>
      {doc.score && (
        <p className="rounded-md bg-secondary px-3 py-2">
          <b className="font-medium">Баллы:</b> {doc.score}
        </p>
      )}
      {doc.gaps?.map((gap, i) => (
        <p key={i} className="flex items-start gap-1.5 text-warn-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {gap}
        </p>
      ))}
    </>
  ) : undefined;

// Шаг «Пакет» на настоящей закупке: файлы заявки — по одному и архивом, список «Что требует заказчик».
// Документы скачиваются бесплатно; оплаты и проверки специалистом пока нет.
export function PurchasePackage({ onBack, onFix, onTariffs }: { onBack: () => void; onFix: () => void; onTariffs: () => void }) {
  const source = usePurchase();
  const { purchase, update } = source;
  const files = useApplicationFilesOf(source);
  const profile = useProfile();
  const my = useMyDocs();
  const factsData = useFacts();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const tp = purchase.tp;
  // Word или PDF — выбор действует на все скачивания этого шага.
  const [format, setFormat] = useState<FileFormat>('docx');

  const evidence = useMemo(
    () => ({
      experience: my.docs.filter((d) => d.kinds.includes('experience')).length,
      staff: my.docs.filter((d) => d.kinds.includes('staff')).length,
    }),
    [my.docs],
  );
  const fields = useMemo(() => fieldsOf({ purchase, profile, evidence }), [purchase, profile, evidence]);
  // Где в файлах закупки стоит цитата пункта «Что требует заказчик» (lib/doc-locate.ts).
  const locator = useMemo(() => createLocator(source.documents), [source.documents]);
  // Страница заголовка каждого бланка — из текста документов (код), а не из ответа ИИ.
  const detectedForms = useMemo(
    () => (tp?.detectedForms ?? []).map((df) => ({ ...df, pages: formPage(locator, df.title) })),
    [tp?.detectedForms, locator],
  );
  const whereOf = (quote: string) => {
    const place = quote ? locator.locate(quote) : null;
    return place ? describeSource(place) : undefined;
  };
  const final = useMemo(() => completeness(purchase, fields, profile), [purchase, fields, profile]);

  const plans = useMemo(() => fulfillmentOf(purchase, { profile, fields }), [purchase, profile, fields]);
  const generatedParts = useMemo((): TpPart[] => {
    if (!purchase.tp) return [];
    return ['tp', ...(Object.keys(purchase.parts ?? {}) as TpPart[])];
  }, [purchase.tp, purchase.parts]);
  const appBuildReport = useMemo(
    (): BuildReport => buildReport({ plans, fields, final, hasTp: !!purchase.tp, generatedParts }),
    [plans, fields, final, purchase.tp, generatedParts]
  );
  const validationResult = useMemo(
    () => validate({ purchase, profile, facts: factsData.facts, fields, today }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [purchase, profile, factsData.facts, fields, today],
  );
  const appAuditReport = useMemo(
    (): AuditReport => auditReport({ final, plans, fields, validation: validationResult, today, deadline: purchase.deadline }),
    [final, plans, fields, validationResult, today, purchase.deadline],
  );
  const appScoringReport = useMemo(
    (): ScoringReport => scoringReport({ criteria: purchase.criteria ?? NO_CRITERIA, facts: factsData.facts }),
    [purchase.criteria, factsData.facts],
  );

  // Скачать один доп. бланк отдельным файлом: POST к /api/tp/{format} с part=application и только этим бланком.
  const downloadDetectedForm = useCallback(async (df: DetectedForm) => {
    const ext = FILE_FORMATS[format];
    try {
      const res = await fetch(`/api/tp/${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          part: 'application',
          subject: purchase.subject,
          form: { title: df.title, source: df.source, participantFields: [], consent: '', hasPrice: false, priceNote: '', smeDeclaration: '', goodsTableHeaders: [] },
          blankOnly: true,
          detectedForms: [df],
          goods: [],
          items: [],
        }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${df.title || 'Бланк'}.${ext.ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // скачивание упало — игнорируем тихо
    }
  }, [format, purchase.subject]);

  if (!my.ready || !files.meReady) return <p className="text-sm text-muted-foreground">Собираю пакет документов…</p>;

  const law = purchase.kind.match(/(?<!\d)(44|223)-ФЗ/)?.[0] ?? '';
  const common = {
    subtitle: [purchase.customer, law].filter(Boolean).join(' · '),
    head: `Электронная подача${law ? ` · ${law}` : ''}`,
    customer: purchase.customer,
  };

  function previewOf(part: TpPart): PackagePreview | null {
    if (!tp) return null;
    if (part === 'tp') {
      return {
        ...common,
        title: PART_TITLES.tp,
        body: <ApplicationText purchase={purchase} />,
        foot: ['без названия и реквизитов участника', 'первая часть заявки'],
      };
    }
    // application — бланк заказчика, не AI-документ: предпросмотра нет.
    if (part === 'application') return null;
    const key = part as PartKey;
    const made = purchase.parts?.[key];
    if (!made) return null;
    const basis = made.doc.basis.trim().replace(/\.$/, '');
    const note = [
      basis ? `Составлено ${basis}.` : '',
      files.isFresh(tp, key) ? '' : 'Реквизиты, цена или образцы изменились с тех пор — при скачивании документ будет составлен заново.',
    ]
      .filter(Boolean)
      .join(' ');
    return {
      ...common,
      title: PART_TITLES[part],
      note,
      body: <PartBody doc={made.doc} />,
      foot: [profile.shortName.trim() || profile.fullName.trim() || 'участник закупки', 'подпись — на площадке'],
      extra: scoreOf(made.doc),
    };
  }

  const rows: PackageRow[] = fileRows(purchase, {
    missing: files.profile ? PROFILE_KEYS.length - filledCount(files.profile) : 0,
    evidence: {
      experience: files.myDocs.filter((d) => d.kinds.includes('experience')).length,
      staff: files.myDocs.filter((d) => d.kinds.includes('staff')).length,
    },
    writing: files.writing,
  }).map((row) => ({
    ...row,
    preview: previewOf(row.part),
    canRedo: row.part !== 'tp' && row.part !== 'application' && !purchase.sample && purchase.parts?.[row.part as PartKey] !== undefined,
  }));

  // Документы закупки изменились после составления ТП — участник проверяет и подтверждает, как на шаге «Проверка».
  const changes = tpChanges(purchase);

  return (
    <StepPackage
      hasTp={!!tp}
      notice={changes && <DocsChanged changes={changes} onConfirm={() => update({ tpDocs: purchase.docs })} />}
      format={format}
      onFormat={setFormat}
      final={final}
      rows={rows}
      count={tp ? partsOf(tp.form, purchase.criteria, purchase.kind).length : 1}
      items={submitItems(purchase, profile)}
      whereOf={whereOf}
      downloading={files.downloading}
      writing={files.writing}
      busy={files.downloading !== null}
      error={files.error}
      note={files.note}
      onToggleReady={(text) => update({ submitReady: toggleReady(purchase, text) })}
      onDownload={(part) => tp && void files.downloadPart(tp, part, { format })}
      onRedo={(part) => tp && void files.downloadPart(tp, part, { redo: true, format })}
      onDownloadAll={() => tp && void files.downloadAll(tp, format)}
      onFix={onFix}
      onTariffs={onTariffs}
      onBack={onBack}
      buildReport={appBuildReport}
      validation={validationResult}
      auditReport={appAuditReport}
      scoringReport={appScoringReport}
      tpForm={tp?.form}
      detectedForms={detectedForms}
      onDownloadForm={downloadDetectedForm}
    />
  );
}
