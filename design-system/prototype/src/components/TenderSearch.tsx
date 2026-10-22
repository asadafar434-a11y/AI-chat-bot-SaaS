import { Plus, Search } from '../lib/icons';
import { Button, Card, Soon } from './ui';

// «Поиск закупок» — пока заглушка (решение владельца 14.10.2026: без выдуманных закупок). Настоящий поиск по площадкам появится,
// когда будет доступ к данным ЕИС; до тех пор закупку добавляют загрузкой документов.
export function TenderSearch({ onNew }: { onNew: () => void }) {
  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Поиск закупок</h1>
          <Soon />
        </div>
      </div>

      <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <span className="grid size-10 place-items-center rounded-full bg-secondary text-muted-foreground">
          <Search className="size-5" />
        </span>
        <p className="max-w-md text-sm text-muted-foreground">
          Поиск по площадкам — в разработке. Пока закупку добавляют загрузкой документов: скачайте их с площадки и загрузите.
        </p>
        <Button onClick={onNew}>
          <Plus className="size-4" /> Новая закупка
        </Button>
      </Card>
    </div>
  );
}
