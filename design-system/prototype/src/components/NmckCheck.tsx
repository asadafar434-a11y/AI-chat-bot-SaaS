import type { NmckCalc } from '@/lib/nmck-check';
import { AlertTriangle, CheckCircle2, Info } from '../lib/icons';
import { CertaintyBadge } from './Certainty';
import { Frame, frameBody, frameHead } from './Frame';
import { Badge, HelpTip } from './ui';

// «Расчёт цены у заказчика»: программа находит в документах его обоснование начальной цены (цены трёх поставщиков, средняя, вариация), пересчитывает и показывает,
// где расчёт не сходится. Сама ничего не ищет: расчёт — lib/nmck-check.ts.

const SHOWN = 6;
const num = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replace(/[  ]/g, ' ');
const pct = (n: number) => `${n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace(/[  ]/g, ' ')} %`;

function Row({ calc }: { calc: NmckCalc }) {
  return (
    <li className="rounded-lg border border-border px-3 py-2.5 text-[12px]">
      <p className="break-words text-[13px] font-medium">{calc.name}</p>
      <p className="mt-1 break-words font-mono text-muted-foreground">
        цены поставщиков: {calc.offers.map(num).join(' · ')} → средняя {num(calc.mean)}, вариация {pct(calc.stats.cv * 100)}
      </p>
      {calc.issues.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {calc.issues.map((issue) => (
            <li key={issue.kind} className={`flex items-start gap-1.5 ${issue.level === 'warn' ? 'text-warn-foreground' : 'text-muted-foreground'}`}>
              {issue.level === 'warn' ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> : <Info className="mt-0.5 size-3.5 shrink-0" />}
              <span>{issue.text}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function NmckCheck({ calcs, embedded }: { calcs: NmckCalc[]; embedded?: boolean }) {
  const flagged = calcs.filter((c) => c.issues.some((i) => i.level === 'warn'));
  const rest = calcs.filter((c) => !flagged.includes(c));
  return (
    <Frame embedded={embedded}>
      <div className={frameHead(embedded)}>
        {!embedded && <span className="text-sm font-medium">Расчёт цены у заказчика</span>}
        <HelpTip
          align="start"
          content="Программа нашла в документах заказчика расчёт начальной цены по предложениям поставщиков и пересчитала его: среднюю, отклонение и коэффициент вариации. Эти цены дал заказчику его поставщик, поэтому для вашего РИЦ они не независимы — свои цены-аналоги добавляйте в блоке ниже."
        />
        {calcs.length > 0 && <CertaintyBadge kind="confirmed" />}
        {calcs.length > 0 && (
          <Badge tone={flagged.length > 0 ? 'warn' : 'success'}>
            {flagged.length > 0 ? <AlertTriangle className="size-3" /> : <CheckCircle2 className="size-3" />}
            {flagged.length > 0 ? `замечаний: ${flagged.length} из ${calcs.length}` : `${calcs.length} из ${calcs.length} сходятся`}
          </Badge>
        )}
      </div>
      <div className={frameBody(embedded)}>
        {calcs.length === 0 ? (
          <p className="text-muted-foreground">
            В документах не нашёл расчёт начальной цены по предложениям поставщиков (таблицу со средней ценой и коэффициентом вариации). Если он есть в файле другого вида, добавьте цены вручную в блоке ниже.
          </p>
        ) : (
          <>
            {flagged.length > 0 && (
              <ul className="space-y-2">
                {flagged.slice(0, SHOWN).map((c, i) => (
                  <Row key={`${c.name}-${i}`} calc={c} />
                ))}
              </ul>
            )}
            {flagged.length > SHOWN && <p className="text-[12px] text-muted-foreground">…и ещё {flagged.length - SHOWN} с такими же замечаниями.</p>}
            {rest.length > 0 && (
              <details className="text-[12px]">
                <summary className="cursor-pointer text-muted-foreground">
                  {flagged.length > 0 ? 'Остальные позиции' : 'Позиции расчёта'}: {rest.length}
                </summary>
                <ul className="mt-2 space-y-2">
                  {rest.slice(0, 20).map((c, i) => (
                    <Row key={`${c.name}-${i}`} calc={c} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </Frame>
  );
}
