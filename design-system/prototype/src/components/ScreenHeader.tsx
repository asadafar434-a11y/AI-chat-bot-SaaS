import { type ReactNode } from 'react';
import { SectionIcon, type SectionIconName } from './SectionIcon';

// Шапка экрана меню — одна на всех (владелец, 03.11.2026: «такой же дизайн на других экранах»): значок раздела, заголовок 20, строка пояснения, справа — действия.
export function ScreenHeader({ icon, title, hint, aside }: { icon: SectionIconName; title: string; hint?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <SectionIcon name={icon} className="size-8" />
          {title}
        </h1>
        {hint && <div className="mt-1 text-[13px] text-muted-foreground">{hint}</div>}
      </div>
      {aside && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
    </div>
  );
}
