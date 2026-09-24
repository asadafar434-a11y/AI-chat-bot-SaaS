import Link from "next/link";
import type { ReactNode } from "react";
import { ScaleIcon, UserRoundIcon } from "lucide-react";

export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="flex items-center gap-2.5 px-4 py-3">
      <Link href="/" className="flex items-center gap-2.5" aria-label="Тендерный юрист — на главную">
        <span className="grid size-8 place-items-center rounded-[11px] bg-primary text-primary-foreground">
          <ScaleIcon className="size-4" />
        </span>
        <span className="font-heading text-[17px] font-bold tracking-[-0.03em]">Тендерный юрист</span>
      </Link>
      {children}
      <Link
        href="/me"
        className="ml-auto flex shrink-0 items-center gap-1.5 rounded-[var(--r-pill)] px-3 py-1.5 text-[14px] font-semibold text-[var(--ink-2)] hover:bg-muted"
      >
        <UserRoundIcon className="size-4" />
        Мои данные
      </Link>
    </header>
  );
}
