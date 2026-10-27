import type { CustomerTemplate } from '@/lib/customer-templates';
import { plural } from '@/lib/plural';
import { FileText } from '../lib/icons';
import { Badge, Card, HelpTip } from './ui';

// «Шаблоны заказчика»: файлы документации, которые заказчик дал как образцы для заполнения. Список находит код по названию и тексту файла (lib/customer-templates.ts), без ИИ, сразу после загрузки.
// Заполненные копии стоят ниже, в «Составе пакета»; здесь — что заказчик прислал.

const blanksText = (n: number) => `${n} ${plural(n, 'пустое место', 'пустых места', 'пустых мест')}`;

export function CustomerTemplates({ templates }: { templates: CustomerTemplate[] }) {
  if (templates.length === 0) return null;
  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="flex items-center gap-1.5 text-[15px] font-bold">
          Шаблоны заказчика · {templates.length}
          <HelpTip
            align="start"
            content="Файлы из документов закупки, которые заказчик дал как образцы для заполнения. Подать нужно по его форме — заполненные копии собраны ниже, в «Составе пакета»."
          />
        </span>
      </div>
      <ul>
        {templates.map((t) => (
          <li key={t.name} className="flex items-start gap-3 border-b border-border px-4 py-2.5 last:border-0">
            <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="min-w-0 flex-1 break-words text-[13px] font-medium">{t.name}</p>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              <Badge tone="neutral">{t.label}</Badge>
              {t.excel && <Badge tone="info">Excel</Badge>}
              {t.blanks > 0 && <Badge tone="warn">{blanksText(t.blanks)}</Badge>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
