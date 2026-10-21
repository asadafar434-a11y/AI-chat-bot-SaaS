import type { ReactNode } from 'react';
import { Card } from './ui';

// Рамка блока раздела «Аналитика»: сам по себе блок — карточка с заголовком; внутри раскрывающегося раздела (embedded) — без карточки и без названия: название уже в заголовке раздела.
export function Frame({ embedded, children }: { embedded?: boolean; children: ReactNode }) {
  return embedded ? <div>{children}</div> : <Card className="p-0">{children}</Card>;
}

export const frameHead = (embedded?: boolean) =>
  embedded ? 'flex flex-wrap items-center gap-2 pb-2' : 'flex flex-wrap items-center gap-2 border-b border-border px-4 py-3';

export const frameBody = (embedded?: boolean, space = 'space-y-3') => (embedded ? `${space} text-[13px]` : `${space} px-4 py-3 text-[13px]`);
