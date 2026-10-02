import { useMemo, useState } from 'react';
import { buildReport, type BuildReport } from '@/lib/application-builder';
import { fileRows, submitItems, toggleReady } from '@/lib/application-files';
import { tpChanges } from '@/lib/doc-changes';
import { createLocator, describeSource } from '@/lib/doc-locate';
import { completeness, fieldsOf } from '@/lib/fields';
import type { FileFormat } from '@/lib/file-format';
import type { PartDoc } from '@/lib/part-doc';
import { filledCount, PROFILE_KEYS } from '@/lib/profile';
import { fulfillmentOf } from '@/lib/fulfillment';
import { PART_TITLES, partsOf, type TpPart } from '@/lib/tp-parts';
import { useApplicationFilesOf } from '@/lib/use-application-files';
import { ApplicationText, MarkedText } from '../components/ApplicationPreview';
import { DocsChanged } from '../components/DocsChanged';
import { StepPackage, type PackagePreview, type PackageRow } from '../components/StepPackage';
import { AlertTriangle } from '../lib/icons';
import { useProfile } from './analysis';
import { useMyDocs } from './hooks';
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
    const made = purchase.parts?.[part];
    if (!made) return null;
    const basis = made.doc.basis.trim().replace(/\.$/, '');
    const note = [
      basis ? `Составлено ${basis}.` : '',
      files.isFresh(tp, part) ? '' : 'Реквизиты, цена или образцы изменились с тех пор — при скачивании документ будет составлен заново.',
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
    canRedo: row.part !== 'tp' && !purchase.sample && purchase.parts?.[row.part] !== undefined,
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
    />
  );
}
