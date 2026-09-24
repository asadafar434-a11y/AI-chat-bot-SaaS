import Link from "next/link";
import type { ReactNode } from "react";

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="mt-3 inline-flex max-w-full items-center gap-1.5 text-[15px] font-medium text-muted-foreground hover:text-foreground"
    >
      <span aria-hidden>←</span>
      <span className="truncate">{children}</span>
    </Link>
  );
}
