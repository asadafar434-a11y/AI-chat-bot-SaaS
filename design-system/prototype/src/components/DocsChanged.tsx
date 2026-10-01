import { changesText, type DocChanges } from '@/lib/doc-changes';
import { AlertTriangle } from '../lib/icons';
import { Button } from './ui';

// Документы закупки изменились после того, как по ним составили ТП: участник проверяет, что ТП и документы заявки всё ещё
// соответствуют извещению и ТЗ, и подтверждает. Пока не подтвердил, закупка не считается готовой (lib/doc-changes.ts).
export function DocsChanged({ changes, onConfirm }: { changes: DocChanges; onConfirm: () => void }) {
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/40 bg-warn-surface/30 p-4">
      {/* Текст не уже 16rem: на телефоне кнопка уходит под него, а не сжимает его в узкую колонку. */}
      <div className="flex min-w-0 flex-[1_1_16rem] items-start gap-2.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Документы закупки изменились после составления ТП</p>
          <p className="mt-0.5 break-words text-[13px] text-muted-foreground">
            {changesText(changes)}. Проверьте, что ТП и документы заявки всё ещё соответствуют извещению и ТЗ: если заказчик
            изменил требования, поправьте жёлтые места. Пока вы не подтвердите, закупка не считается готовой.
          </p>
        </div>
      </div>
      <Button size="sm" variant="secondary" onClick={onConfirm}>
        Проверил — всё верно
      </Button>
    </div>
  );
}
