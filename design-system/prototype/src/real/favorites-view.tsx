import { useMemo } from 'react';
import { Favorites } from '../components/Favorites';
import { useFavorites } from './favorites';

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// «Избранное» с настоящими данными: список лежит в браузере (lib/tender-favorites.ts), общий с «Поиском закупок».
export function RealFavorites({ onSearch }: { onSearch: () => void }) {
  const fav = useFavorites();
  const today = useMemo(todayIso, []);
  return <Favorites items={fav.items} ready={fav.ready} today={today} onToggle={fav.toggle} onSearch={onSearch} />;
}
