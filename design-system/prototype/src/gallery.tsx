import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { Alert, DataTable, EmptyState, Progress, Select, Skeleton, SkeletonText, Stat, TBody, TFoot, THead, Td, Th, Tr, type SortState } from './components/data';
import { Badge, Button, Card, Checkbox, Chip, fieldClass, HelpTip, IconButton, Modal, Soon, Tabs, Tooltip, type Tone } from './components/ui';
import { Download, FileQuestion, Plus, Search, Trash2 } from './lib/icons';

// Витрина общих компонентов: проверка вида в светлой и тёмной теме и во всех состояниях. Служебная, в продукт не входит.

const TOKENS = ['background', 'card', 'secondary', 'surface-sunken', 'accent', 'border', 'border-strong', 'foreground', 'foreground-secondary', 'muted-foreground', 'primary', 'primary-hover', 'primary-soft', 'success', 'success-surface', 'warn', 'warn-surface', 'danger', 'danger-surface', 'info', 'info-surface'];
const SCALE: [string, string, string][] = [
  ['text-display', 'Display 30', '12,4 млн ₽'],
  ['text-2xl', 'Шаг закупки 24', 'Загрузка документации'],
  ['text-xl', 'Заголовок экрана 20', 'Аналитика'],
  ['text-subtitle', 'Заголовок карточки 15', 'Финансовые показатели'],
  ['text-sm', 'Основной текст 14', 'Организация действует, судов и долгов не найдено.'],
  ['text-ui', 'Плотный интерфейс 13', 'Выручка за 2025 год выросла на 18,4 % к 2024.'],
  ['text-caption', 'Подпись 12', 'По данным ГИР БО ФНС на 04.11.2026'],
  ['text-micro', 'Бейдж 11', 'Подтверждено'],
  ['text-nano', 'Метка 10', 'СКОРО'],
];
const ROWS = [
  { year: 2025, revenue: 140930138, profit: 1200000, assets: 161324221 },
  { year: 2024, revenue: 120394401, profit: 900000, assets: 145863094 },
  { year: 2023, revenue: 98100500, profit: -420000, assets: 145317541 },
];
const money = (n: number) => (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('ru-RU') + ' ₽';
const TONES: Tone[] = ['neutral', 'info', 'success', 'warn', 'danger'];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-subtitle font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Gallery() {
  const [dark, setDark] = useState(false);
  const [tab, setTab] = useState('a');
  const [chip, setChip] = useState(true);
  const [sort, setSort] = useState<SortState>('desc');
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(true);
  document.documentElement.classList.toggle('dark', dark);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Витрина компонентов</h1>
        <Button variant="secondary" size="sm" onClick={() => setDark(!dark)}>
          {dark ? 'Светлая тема' : 'Тёмная тема'}
        </Button>
      </div>

      <Section title="Слои и цвета">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
          {TOKENS.map((t) => (
            <div key={t} className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="h-10" style={{ background: `var(--${t})` }} />
              <p className="truncate px-2 py-1 font-mono text-nano text-muted-foreground">{t}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Шкала шрифта">
        <Card className="divide-y divide-border">
          {SCALE.map(([cls, name, sample]) => (
            <div key={cls} className="flex items-baseline gap-4 px-4 py-2.5">
              <span className="w-44 shrink-0 text-caption text-muted-foreground">{name}</span>
              <span className={cls + ' min-w-0 font-medium'}>{sample}</span>
            </div>
          ))}
        </Card>
      </Section>

      <Section title="Кнопки">
        <div className="flex flex-wrap items-center gap-2">
          {(['primary', 'secondary', 'ghost', 'warn', 'danger', 'ai'] as const).map((v) => (
            <Button key={v} variant={v}>
              {v}
            </Button>
          ))}
          <Button variant="primary" loading>
            Сохраняю
          </Button>
          <Button variant="secondary" disabled>
            Недоступно
          </Button>
          <Button size="sm" variant="secondary">
            <Download className="size-3.5" /> Скачать
          </Button>
          <IconButton label="Удалить">
            <Trash2 className="size-4" />
          </IconButton>
          <Tooltip content="Подсказка: тёмная плашка поверх любого фона">
            <Button variant="ghost">Наведите</Button>
          </Tooltip>
          <HelpTip content="Пояснение внутри значка ⓘ" />
        </div>
      </Section>

      <Section title="Поля">
        <div className="grid gap-3 sm:grid-cols-3">
          <input className={fieldClass()} placeholder="ИНН, ОГРН, название или фамилия" />
          <input className={fieldClass('md', 'border-danger')} defaultValue="1434031364" aria-invalid />
          <Select defaultValue="1">
            <option value="1">Организация</option>
            <option value="2">ИП</option>
          </Select>
          <input className={fieldClass('sm')} placeholder="Компактное поле" />
          <input className={fieldClass()} disabled placeholder="Отключено" />
          <Checkbox checked={checked} onChange={setChecked}>
            Галочка с подписью
          </Checkbox>
        </div>
      </Section>

      <Section title="Бейджи, плашки-фильтры, вкладки">
        <div className="flex flex-wrap items-center gap-2">
          {TONES.map((t) => (
            <Badge key={t} tone={t} dot>
              {t}
            </Badge>
          ))}
          <Badge tone="success">Подтверждено</Badge>
          <Soon />
          <Chip label="Действующие" on={chip} onClick={() => setChip(!chip)} count={12} />
          <Chip label="ИП" on={false} onClick={() => {}} />
          <Chip label="Свой пункт" on onClick={() => {}} onRemove={() => {}} />
        </div>
        <Tabs idPrefix="g" active={tab} onChange={setTab} items={[{ key: 'a', label: 'Реквизиты' }, { key: 'b', label: 'Финансы', badge: <Badge tone="info">3</Badge> }, { key: 'c', label: 'Суды' }]} />
      </Section>

      <Section title="Предупреждения и прогресс">
        <div className="grid gap-3 lg:grid-cols-2">
          <Alert tone="info" title="Источник: Checko">Данные реестров на 04.11.2026. Это сведения, а не заключение о надёжности.</Alert>
          <Alert tone="success" title="Всё готово к подаче">Критических замечаний нет.</Alert>
          <Alert tone="warn" title="Осталось 2 пункта">Проверьте срок действия лицензии.</Alert>
          <Alert tone="danger" title="Организация в реестре недобросовестных поставщиков" action={<Button size="sm" variant="secondary">Открыть</Button>}>
            Запись от 12.03.2026.
          </Alert>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Progress value={72} label="Заполнено" showValue />
          <Progress value={100} label="Готово" tone="success" showValue />
          <Progress value={18} label="Риск" tone="danger" showValue />
        </div>
      </Section>

      <Section title="Показатели и таблица данных">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Выручка 2025" value="140,9 млрд ₽" delta={{ value: '+17,1 %', direction: 'up', good: true }} hint="к 2024" />
          <Stat label="Чистая прибыль" value="1,2 млн ₽" tone="success" delta={{ value: '+33 %', direction: 'up', good: true }} />
          <Stat label="Приставы" value="88 дел" tone="warn" hint="долг 14,2 млн ₽" />
          <Stat label="Просроченный долг" value="−420 тыс. ₽" tone="danger" delta={{ value: '−12 %', direction: 'down', good: false }} />
        </div>
        <DataTable caption="Бухгалтерская отчётность по годам">
          <THead>
            <tr>
              <Th sort={sort} onSort={() => setSort(sort === 'desc' ? 'asc' : 'desc')}>Год</Th>
              <Th align="right">Выручка</Th>
              <Th align="right">Чистая прибыль</Th>
              <Th align="right">Активы</Th>
            </tr>
          </THead>
          <TBody>
            {(sort === 'asc' ? [...ROWS].reverse() : ROWS).map((r) => (
              <Tr key={r.year} selected={r.year === 2025}>
                <Td strong>{r.year}</Td>
                <Td num>{money(r.revenue)}</Td>
                <Td num tone={r.profit < 0 ? 'danger' : 'neutral'}>{money(r.profit)}</Td>
                <Td num tone="muted">{money(r.assets)}</Td>
              </Tr>
            ))}
          </TBody>
          <TFoot>
            <tr>
              <Td>Итого за три года</Td>
              <Td num>{money(ROWS.reduce((a, r) => a + r.revenue, 0))}</Td>
              <Td num>{money(ROWS.reduce((a, r) => a + r.profit, 0))}</Td>
              <Td />
            </tr>
          </TFoot>
        </DataTable>
      </Section>

      <Section title="Загрузка, пустое состояние, окна">
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="space-y-3 p-4" >
            <Skeleton className="h-4 w-1/3" />
            <SkeletonText lines={3} />
          </Card>
          <EmptyState icon={<FileQuestion className="size-5" />} title="Закупок пока нет" action={<Button size="sm"><Plus className="size-3.5" /> Загрузить закупку</Button>}>
            Загрузите документы закупки — здесь появится разбор и расчёт.
          </EmptyState>
        </div>
        <Card tone="sunken" className="p-4 text-ui text-foreground-secondary">Вложенная группа без второй рамки (Card tone=&quot;sunken&quot;).</Card>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setOpen(true)}>
            <Search className="size-4" /> Открыть окно
          </Button>
        </div>
        <Modal open={open} onClose={() => setOpen(false)} title="Окно" subtitle="Подпись окна" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Отмена</Button><Button onClick={() => setOpen(false)}>Готово</Button></>}>
          <p className="p-5 text-sm">Содержимое окна. Фон затемнён и слегка размыт, тень глубокая.</p>
        </Modal>
      </Section>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Gallery />
  </React.StrictMode>,
);
