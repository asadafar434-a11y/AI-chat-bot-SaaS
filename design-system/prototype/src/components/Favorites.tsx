import { useState } from 'react';
import type { Favorite } from '@/lib/tender-favorites';
import type { TenderListing } from '@/lib/tender-search';
import { plural } from '@/lib/plural';
import { Heart } from '../lib/icons';
import { EmptyState } from './data';
import { Button } from './ui';
import { ScreenHeader } from './ScreenHeader';
import { TenderCard, TenderModal } from './TenderSearch';

// «Избранное»: закупки, отмеченные сердечком в «Поиске закупок». Те же карточки и то же окно закупки; сердечко здесь убирает закупку из списка.
// Закупка хранится такой, какой была при отметке: закончившиеся по сроку сервер из поиска убирает, а здесь они остаются с пометкой «приём закончился».

export function Favorites({
  items,
  ready,
  today,
  onToggle,
  onSearch,
}: {
  items: Favorite[];
  /** Избранное прочитано из браузера. До этого — не пустой экран, а ожидание. */
  ready: boolean;
  today: string;
  onToggle: (l: TenderListing) => void;
  /** Перейти в «Поиск закупок». */
  onSearch: () => void;
}) {
  const [opened, setOpened] = useState<TenderListing | null>(null);
  const hint = items.length > 0 ? `${items.length} ${plural(items.length, 'закупка', 'закупки', 'закупок')} · новые сверху` : 'Отмечайте закупки сердечком, чтобы вернуться к ним позже';
  return (
    <div className="animate-fade-up space-y-4">
      <ScreenHeader
        icon="favorites"
        title="Избранное"
        hint={hint}
        aside={
          items.length > 0 ? (
            <Button variant="secondary" size="sm" onClick={onSearch}>
              Найти закупки
            </Button>
          ) : undefined
        }
      />
      {!ready ? (
        <p className="text-ui text-muted-foreground" role="status">
          Читаю избранное…
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Heart className="size-5" />}
          title="В избранном пока пусто"
          action={
            <Button size="sm" onClick={onSearch}>
              Перейти к поиску закупок
            </Button>
          }
        >
          Нажмите сердечко на карточке закупки в «Поиске закупок» — она появится здесь.
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {items.map(({ listing }) => (
            <TenderCard key={listing.id} l={listing} today={today} onOpen={() => setOpened(listing)} favorite={{ on: true, toggle: () => onToggle(listing) }} />
          ))}
        </ul>
      )}
      {opened && <TenderModal l={opened} today={today} onClose={() => setOpened(null)} favorite={{ on: items.some((f) => f.listing.id === opened.id), toggle: () => onToggle(opened) }} />}
    </div>
  );
}
