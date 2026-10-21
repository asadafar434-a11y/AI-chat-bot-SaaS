import type { ContractRisk, RiskKind } from '@/lib/contract-risks';
import { AlertTriangle, Info } from '../lib/icons';
import { CertaintyBadge } from './Certainty';
import { Badge, Card, HelpTip } from './ui';

// «Риски и расходы из договора»: что участник берёт на себя, подписав проект договора. Код читает договор без ИИ (lib/contract-risks.ts); каждая находка — с цитатой и пунктом.
// Метка «Подтверждено»: условие и число есть в тексте документа. Чего в тексте нет, код не угадывает.

const SHOWN = 8;

const GROUP: Record<RiskKind, string> = {
  penalty: 'Неустойка',
  cost: 'Расходы за ваш счёт',
  payment: 'Оплата заказчиком',
  price: 'Цена и её изменение',
  advance: 'Аванс',
  security: 'Обеспечение исполнения',
  volume: 'Изменение объёма',
};

function Item({ risk }: { risk: ContractRisk }) {
  const mine = risk.party === 'you';
  return (
    <li className="rounded-lg border border-border px-3 py-2.5 text-[12px]">
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        {risk.level === 'warn' ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn-foreground" /> : <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
        <p className="min-w-0 flex-1 break-words text-[13px] font-medium">{risk.title}</p>
        <Badge tone="neutral">{GROUP[risk.kind]}</Badge>
        {risk.kind === 'penalty' && <Badge tone={mine ? 'warn' : 'info'}>{mine ? 'платите вы' : 'платит заказчик'}</Badge>}
        {risk.heavy && <Badge tone="danger">крупная</Badge>}
      </div>
      <details className="mt-1.5 text-muted-foreground">
        <summary className="cursor-pointer">Цитата</summary>
        <p className="mt-1 break-words">
          «{risk.quote}»
          <span className="ml-1 font-mono text-[11px]">
            {risk.clause && `п. ${risk.clause} · `}
            {risk.doc}
          </span>
        </p>
      </details>
    </li>
  );
}

export function ContractRisks({ risks, hasContract }: { risks: ContractRisk[]; hasContract: boolean }) {
  const attention = risks.filter((r) => r.level === 'warn');
  const rest = risks.filter((r) => r.level !== 'warn');
  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <span className="text-sm font-medium">Риски и расходы из договора</span>
        <HelpTip
          align="start"
          content="Программа прочитала проект договора и выписала условия с цифрами: неустойку (кто платит и сколько), срок оплаты, аванс, обеспечение, расходы, которые договор кладёт на исполнителя, и право заказчика менять объём. У каждого условия — цитата и пункт. Чего в тексте нет, программа не додумывает."
        />
        <CertaintyBadge kind={risks.length > 0 ? 'confirmed' : 'unchecked'} />
        {risks.length > 0 && (
          <Badge tone={attention.length > 0 ? 'warn' : 'success'}>
            {attention.length > 0 ? <AlertTriangle className="size-3" /> : <Info className="size-3" />}
            {attention.length > 0 ? `требуют внимания: ${attention.length}` : 'условий для внимания нет'}
          </Badge>
        )}
      </div>
      <div className="space-y-3 px-4 py-3 text-[13px]">
        {!hasContract ? (
          <p className="text-muted-foreground">Проект договора в документах не нашёл, поэтому риски из договора показать не могу. Загрузите договор или его приложение.</p>
        ) : risks.length === 0 ? (
          <p className="text-muted-foreground">
            В договоре не нашёл условий с цифрами (неустойка, срок оплаты, аванс, обеспечение, расходы исполнителя). Это не значит, что их нет: прочитайте раздел об ответственности сторон.
          </p>
        ) : (
          <>
            {attention.length > 0 && (
              <ul className="space-y-2">
                {attention.slice(0, SHOWN).map((r, i) => (
                  <Item key={`${r.kind}-${r.title}-${i}`} risk={r} />
                ))}
              </ul>
            )}
            {attention.length > SHOWN && <p className="text-[12px] text-muted-foreground">…и ещё {attention.length - SHOWN} таких же условий в документах.</p>}
            {rest.length > 0 && (
              <details className="text-[12px]">
                <summary className="cursor-pointer text-muted-foreground">Остальные условия: {rest.length}</summary>
                <ul className="mt-2 space-y-2">
                  {rest.slice(0, 20).map((r, i) => (
                    <Item key={`${r.kind}-${r.title}-${i}`} risk={r} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
