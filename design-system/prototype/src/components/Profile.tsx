import { useState } from 'react';
import { Building2, Check, Pencil, Sparkles, ShieldCheck, FileText, Plus } from '../lib/icons';
import { Button, Card, Badge, Tooltip } from './ui';
import { company, samples, type CompanyField } from '../lib/data';

const groups: { id: CompanyField['group']; title: string; hint: string }[] = [
  { id: 'org', title: 'Организация', hint: 'Подставляется в заявку, декларацию СМП и контракт' },
  { id: 'bank', title: 'Банковские реквизиты', hint: 'Используются для обеспечения заявки и оплаты' },
  { id: 'contact', title: 'Контакты', hint: 'Для уведомлений и связи с заказчиком' },
];

export function Profile() {
  const [fields, setFields] = useState<CompanyField[]>(company.fields);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CompanyField[]>(company.fields);
  const [saved, setSaved] = useState(false);

  const start = () => {
    setDraft(fields);
    setEditing(true);
    setSaved(false);
  };
  const save = () => {
    setFields(draft);
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const source = editing ? draft : fields;

  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Профиль компании</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            Заполните реквизиты один раз — ИИ будет автоматически подставлять их в каждую заявку,
            декларацию и контракт. Не придётся вводить одни и те же данные для каждой закупки.
          </p>
        </div>
        {editing ? (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Отмена
            </Button>
            <Button onClick={save}>
              <Check className="size-4" /> Сохранить изменения
            </Button>
          </div>
        ) : (
          <Button onClick={start}>
            <Pencil className="size-4" /> Редактировать профиль
          </Button>
        )}
      </div>

      {/* Company header card */}
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <div className="flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Building2 className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold">{company.name}</p>
          <p className="font-mono text-[12px] text-muted-foreground">
            ИНН {source.find((f) => f.key === 'inn')?.value} · КПП{' '}
            {source.find((f) => f.key === 'kpp')?.value}
          </p>
        </div>
        <Tooltip content="Категория субъекта МСП — из профиля. Нужна для закупок только у малого бизнеса." align="end">
          <Badge tone="success">
            <ShieldCheck className="size-3" /> {company.sme}
          </Badge>
        </Tooltip>
        {saved && (
          <span className="inline-flex items-center gap-1.5 text-xs text-success">
            <Check className="size-3.5" /> Сохранено
          </span>
        )}
      </Card>

      {/* How it works */}
      <Card className="flex gap-3 bg-secondary/40 p-4">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-[13px] leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">Как это работает: </span>
          когда ИИ составляет документы заявки, он берёт эти реквизиты и вставляет их в нужные поля
          автоматически — у каждого поля на шаге «Проверка» видно, что оно взято из профиля. Если данные изменятся (например, новый расчётный счёт) —
          обновите их здесь один раз, и все будущие заявки подхватят новое значение.
        </p>
      </Card>

      {/* Fields by group */}
      <div className="space-y-4">
        {groups.map((g) => (
          <Card key={g.id} className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-medium">{g.title}</span>
              <span className="hidden font-mono text-[11px] text-muted-foreground sm:block">
                {g.hint}
              </span>
            </div>
            <div className="divide-y divide-border">
              {source
                .filter((f) => f.group === g.id)
                .map((f) => (
                  <div
                    key={f.key}
                    className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[220px_1fr] sm:items-center sm:gap-4"
                  >
                    <span className="text-[13px] text-muted-foreground">{f.label}</span>
                    {editing ? (
                      <input
                        value={f.value}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev.map((p) => (p.key === f.key ? { ...p, value: e.target.value } : p)),
                          )
                        }
                        className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-foreground focus:ring-2 focus:ring-ring/20"
                      />
                    ) : (
                      <span className="font-mono text-[13px] tabular-nums">{f.value}</span>
                    )}
                  </div>
                ))}
            </div>
          </Card>
        ))}
      </div>

      {/* Образцы и документы компании */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <span className="text-sm font-medium">Образцы и документы</span>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Прошлые заявки, прайсы, исполненные контракты. По ним ИИ пишет новые документы так же, как ваши.
            </p>
          </div>
          <Button size="sm" variant="secondary">
            <Plus className="size-3.5" /> Добавить
          </Button>
        </div>
        <div className="divide-y divide-border">
          {samples.map((d) => (
            <div key={d.name} className="flex items-start gap-3 px-4 py-3">
              <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{d.name}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">{d.note}</p>
              </div>
              <Badge>{d.kind}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
