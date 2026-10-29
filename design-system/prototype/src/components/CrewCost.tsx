import type { CrewCost, CrewLine } from '@/lib/crew-cost';
import type { SavedRates } from '@/lib/rate-cache';
import type { ResourceNeed } from '@/lib/resource-need';
import { CertaintyBadge } from './Certainty';
import { Badge, Card, cx, HelpTip } from './ui';

// «Себестоимость по составу работ» (27.10.2026, владелец: «зарплаты и расценки ищи в интернете, и чтобы это было ко всем тендерам»): состав из документов заказчика — сколько каких специалистов и сколько техники, срок —
// и найденные в интернете зарплаты и аренда (lib/rate-extract.ts, lib/crew-cost.ts). Чего не нашли — названо красным, в сумму не входит. Это оценка по рынку, не смета.

const glue = (t: string) => t.replace(/[  ]/g, ' ');
const rub = (n: number) => glue(`${Math.round(n).toLocaleString('ru-RU')} ₽`);
const day = (iso: string) => iso.slice(0, 10).split('-').reverse().join('.');
const plural = (n: number, one: string, few: string, many: string) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);

export type CrewCardProps = {
  need: ResourceNeed;
  cost: CrewCost;
  state: 'searching' | 'off' | 'failed' | 'done';
  saved: SavedRates | null;
  error: string | null;
  /** Единица объёма в родительном падеже: «тонну», «м²» — для строки «за …». */
  perUnitLabel?: string;
};

function Sources({ line }: { line: CrewLine }) {
  if (line.sources.length === 0) return <span className="text-danger">не найдено</span>;
  const shown = line.sources.slice(0, 2);
  return (
    <span className="break-words">
      {shown.map((s, i) => (
        <span key={`${s.host}-${s.monthly}`}>
          {i > 0 && ', '}
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:no-underline" title={s.quote}>
            {s.host}
          </a>
        </span>
      ))}
      {line.sources.length > shown.length && ` и ещё ${line.sources.length - shown.length}`}
      {line.basis === 'other' && <span className="text-warn-foreground"> · не по региону закупки</span>}
    </span>
  );
}

function Table({ title, lines, unit }: { title: string; lines: CrewLine[]; unit: string }) {
  if (lines.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[12px]">
        <caption className="pb-1 text-left text-muted-foreground">{title}</caption>
        <thead className="text-muted-foreground">
          <tr className="border-b border-border">
            <th className="py-1 pr-2 text-left font-medium">{unit === 'чел.' ? 'Должность' : 'Техника'}</th>
            <th className="px-2 py-1 text-right font-medium whitespace-nowrap">{unit}</th>
            <th className="px-2 py-1 text-right font-medium whitespace-nowrap">В месяц на {unit === 'чел.' ? '1 чел.' : '1 ед.'}</th>
            <th className="px-2 py-1 text-right font-medium whitespace-nowrap">Всего в месяц</th>
            <th className="py-1 pl-2 text-left font-medium">Источники</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key} className="border-b border-border/60 align-top last:border-0">
              <td className="py-1 pr-2">{l.name}</td>
              <td className="px-2 py-1 text-right font-mono">{l.count}</td>
              <td className={cx('px-2 py-1 text-right font-mono whitespace-nowrap', l.monthly === null && 'text-danger')}>{l.monthly === null ? '—' : rub(l.monthly)}</td>
              <td className="px-2 py-1 text-right font-mono whitespace-nowrap">{l.total === null ? '—' : rub(l.total)}</td>
              <td className="py-1 pl-2">
                <Sources line={l} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CrewCostCard({ need, cost, state, saved, error, perUnitLabel }: CrewCardProps) {
  const people = need.staff.reduce((s, r) => s + r.count, 0);
  const machines = need.equipment.reduce((s, r) => s + r.count, 0);
  const found = cost.monthTotal > 0;
  const [sf, st] = cost.covered.staff;
  const [ef, et] = cost.covered.equipment;
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[15px] font-bold">Себестоимость по составу работ</p>
        <CertaintyBadge kind="unchecked" />
        <HelpTip
          align="start"
          content={`Состав — из таблиц заказчика (${need.doc}): ${people} ${plural(people, 'человек', 'человека', 'человек')} и ${machines} ${plural(machines, 'единица техники', 'единицы техники', 'единиц техники')}. Зарплаты и аренда техники найдены в интернете: цитата со страницы проверена кодом, но это не предложение работодателя. Зарплаты — до налогов (если на странице «на руки», пересчитано делением на 0,87); взносы ${cost.contributionsPct.toLocaleString('ru-RU')} % включены (у малого бизнеса ниже). Не включено: накладные расходы, прибыль, обучение, форма, расходные материалы и непредвиденное. Это оценка по рынку, не смета.`}
        />
      </div>

      {state === 'searching' && !found && (
        <p role="status" className="text-[12px] text-muted-foreground">
          Ищу зарплаты и аренду техники в интернете: {people} {plural(people, 'человек', 'человека', 'человек')}, {need.staff.length} {plural(need.staff.length, 'должность', 'должности', 'должностей')}, {need.equipment.length} {plural(need.equipment.length, 'вид техники', 'вида техники', 'видов техники')} — обычно пара минут…
        </p>
      )}
      {state === 'off' && !found && <p className="text-[12px] text-muted-foreground">ИИ выключен — зарплаты и аренда в интернете не искались. Состав из документов виден ниже.</p>}
      {state === 'failed' && !found && (
        <p role="alert" className="text-[12px] text-danger">
          Не удалось найти зарплаты: {error}. Повторю через десять минут.
        </p>
      )}

      {found && (
        <div className="space-y-1">
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {cost.perUnit !== null ? (
              <span className="font-mono text-2xl font-bold tracking-tight">≈ {rub(cost.perUnit)} за {perUnitLabel ?? 'единицу объёма'}</span>
            ) : (
              <span className="font-mono text-2xl font-bold tracking-tight">≈ {rub(cost.monthTotal)} в месяц</span>
            )}
          </p>
          <p className="text-[12px] text-muted-foreground">
            {rub(cost.monthTotal)} в месяц
            {cost.termTotal !== null && cost.months !== null && ` · ${rub(cost.termTotal)} за ${cost.months} ${plural(cost.months, 'месяц', 'месяца', 'месяцев')}`} · из них взносы {cost.contributionsPct.toLocaleString('ru-RU')} % — {rub(cost.contributionsMonth)}
          </p>
          {!cost.complete && (
            <Badge tone="danger" wrap>
              Ставки найдены по {sf} из {st} {plural(st, 'должности', 'должностей', 'должностей')}
              {et > 0 && ` и по ${ef} из ${et} видов техники`}: сумма неполная, ненайденное в неё не входит
            </Badge>
          )}
        </div>
      )}

      <Table title="Персонал (зарплата до налогов)" lines={cost.staff} unit="чел." />
      <Table title="Техника (аренда как оценка стоимости владения)" lines={cost.equipment} unit="ед." />

      <p className="border-t border-border pt-3 text-[12px] text-muted-foreground">
        Не включено: накладные расходы, прибыль, обучение, форма, расходные материалы{saved ? ` · цифры из интернета на ${day(saved.at)}` : ''}.
      </p>
    </Card>
  );
}
