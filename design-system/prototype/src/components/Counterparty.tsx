import { notFound, SOURCE_NAMES, thousandsText, type CounterpartyReport, type Tone as ReportTone } from '@/lib/counterparty';
import { Search } from '../lib/icons';
import { CertaintyBadge } from './Certainty';
import { Badge, Button, Card, cx, Dot, HelpTip, type Tone } from './ui';

// «Проверка контрагента по ИНН» в «Аналитике» (23–25.10.2026, владелец: «начни с проверки по ИНН»): организация, статус и отчётность из открытых реестров — ЕГРЮЛ, Федресурс, ГИР БО ФНС (lib/counterparty.ts).
// Показываем то, что написал реестр, с датой; вывода «надёжен» нет. Чего без капчи не взять (суды, приставы, реестр недобросовестных) — ссылки на ручную проверку.

const TONE: Record<ReportTone, Tone> = { good: 'success', warn: 'warn', danger: 'danger', muted: 'neutral' };
const inputClass =
  'h-9 w-full rounded-md border border-border bg-background px-3 text-[13px] font-mono outline-none transition-colors placeholder:font-sans placeholder:text-muted-foreground/60 focus:border-foreground';

const when = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function Money({ valueK }: { valueK: number | null }) {
  return <span className={cx('font-mono', valueK !== null && valueK < 0 && 'text-danger')}>{thousandsText(valueK)}</span>;
}

export function CounterpartyReportView({ report }: { report: CounterpartyReport }) {
  const failed = Object.entries(report.sources).flatMap(([, s]) => (s.ok ? [] : [s.reason]));
  const empty = notFound(report);
  return (
    <div className="space-y-3">
      {empty ? (
        <p className="text-[13px]">
          <span className="font-semibold">Организации с ИНН {report.inn} в реестрах не нашлось.</span> Проверьте цифры ИНН: контрольная сумма сходится, но такой записи нет.
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="break-words text-[14px] font-bold">{report.name}</p>
              {report.status && (
                <Badge tone={TONE[report.status.tone]} wrap>
                  {report.status.text}
                </Badge>
              )}
              <CertaintyBadge kind="confirmed" />
            </div>
            <p className="break-words font-mono text-[12px] text-muted-foreground">
              ИНН {report.inn}
              {report.identity?.ogrn && ` · ОГРН ${report.identity.ogrn}`}
              {report.identity?.kpp && ` · КПП ${report.identity.kpp}`}
            </p>
            {(report.address || report.identity?.region) && <p className="break-words text-[12px] text-muted-foreground">{report.address ?? report.identity?.region}</p>}
          </div>

          {report.facts.length > 0 && (
            <ul className="space-y-1 text-[13px]">
              {report.facts.map((f) => (
                <li key={f.id} className="flex items-start gap-2">
                  <span className="mt-1.5">
                    <Dot tone={TONE[f.tone]} />
                  </span>
                  <span className="min-w-0 break-words">
                    <span className="text-muted-foreground">{f.label}: </span>
                    <span className={cx(f.tone === 'danger' && 'font-semibold text-danger', f.tone === 'warn' && 'font-semibold')}>{f.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {report.statements.length > 0 && (
            <div className="overflow-x-auto">
              {/* Пять столбцов с суммами на телефоне не помещаются: таблица шире экрана листается внутри карточки, а цифры и год не ломаются посередине. */}
              <table className="w-full min-w-[520px] whitespace-nowrap text-[12px]">
                <caption className="pb-1 text-left text-muted-foreground">Бухгалтерская отчётность (ГИР БО ФНС)</caption>
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-1 pr-2 text-left font-medium">Год</th>
                    <th className="px-2 py-1 text-right font-medium">Выручка</th>
                    <th className="px-2 py-1 text-right font-medium">Чистая прибыль</th>
                    <th className="px-2 py-1 text-right font-medium">Активы</th>
                    <th className="py-1 pl-2 text-right font-medium">Капитал</th>
                  </tr>
                </thead>
                <tbody>
                  {report.statements.map((s) => (
                    <tr key={s.year} className="border-b border-border/60 last:border-0">
                      <td className="py-1 pr-2 font-mono">{s.year}</td>
                      <td className="px-2 py-1 text-right"><Money valueK={s.revenue} /></td>
                      <td className="px-2 py-1 text-right"><Money valueK={s.netProfit} /></td>
                      <td className="px-2 py-1 text-right"><Money valueK={s.assets} /></td>
                      <td className="py-1 pl-2 text-right"><Money valueK={s.equity} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {failed.length > 0 && (
        <p role="alert" className="text-[12px] text-danger">
          Не всё получилось: {failed.join('; ')}. Повторите проверку позже.
        </p>
      )}

      <div className="space-y-1.5 border-t border-border pt-3">
        <p className="text-[12px] font-medium">Проверить вручную <span className="font-normal text-muted-foreground">— без капчи эти реестры не отдают</span></p>
        <ul className="space-y-1 text-[12px]">
          {report.links.map((l) => (
            <li key={l.id} className="break-words">
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline underline-offset-2 hover:no-underline">
                {l.title}
              </a>
              <span className="text-muted-foreground"> — {l.hint}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[12px] text-muted-foreground">
        Данные {Object.values(SOURCE_NAMES).join(', ')} на {when(report.at)}. Это сведения реестров, а не заключение о надёжности.
      </p>
    </div>
  );
}

export type CounterpartyCardProps = {
  inn: string;
  onInn: (value: string) => void;
  onCheck: () => void;
  busy: boolean;
  /** Ошибка проверки ИНН или запроса — одной строкой. */
  error: string | null;
  report: CounterpartyReport | null;
};

export function CounterpartyCard({ inn, onInn, onCheck, busy, error, report }: CounterpartyCardProps) {
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Search className="size-4" />
        <p className="text-[14px] font-bold">Проверка контрагента по ИНН</p>
        <Badge tone="success">Бесплатно: без ИИ</Badge>
        <HelpTip
          align="start"
          content="Заказчик, поставщик, конкурент: впишите ИНН — программа за несколько секунд спросит открытые реестры (ЕГРЮЛ, Федресурс, бухгалтерская отчётность ГИР БО) и покажет, действует ли организация, нет ли банкротства и что с отчётностью. В реестры уходит только ИНН. Суды, приставы и реестр недобросовестных поставщиков отдают данные только после капчи — для них ссылки на ручную проверку."
        />
      </div>
      <form
        className="flex flex-wrap items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) onCheck();
        }}
      >
        <label className="min-w-[200px] flex-1 text-[12px]">
          <span className="sr-only">ИНН организации или ИП</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={inn}
            maxLength={16}
            onChange={(e) => onInn(e.target.value)}
            placeholder="ИНН: 10 цифр у организации, 12 у ИП"
            aria-invalid={error ? true : undefined}
            className={inputClass}
          />
        </label>
        <Button type="submit" disabled={busy}>
          {busy ? 'Проверяю…' : 'Проверить'}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      )}
      {busy && !report && (
        <p role="status" className="text-[12px] text-muted-foreground">
          Спрашиваю ЕГРЮЛ, Федресурс и ГИР БО — обычно несколько секунд…
        </p>
      )}
      {report && <CounterpartyReportView report={report} />}
    </Card>
  );
}
