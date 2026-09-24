import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";

// Строка меню на экранах-развилках: название, под ним — что там сейчас, стрелка справа.
export function MenuRow({ href, title, sub }: { href: string; title: string; sub: ReactNode }) {
  return (
    <li className="border-t border-border first:border-t-0">
      <Link
        href={href}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-5 hover:bg-muted"
      >
        <span className="text-[17px] font-bold leading-6">{title}</span>
        <ChevronRightIcon className="row-span-2 size-5 text-muted-foreground" />
        <span className="text-[15px] leading-[22px] text-muted-foreground">{sub}</span>
      </Link>
    </li>
  );
}
