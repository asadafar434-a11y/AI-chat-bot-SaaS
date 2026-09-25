import type { ReactNode } from "react";

export function PageTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h1
      className={`font-heading text-[clamp(24px,5vw,32px)] font-bold leading-[1.15] tracking-[-0.02em] text-balance ${className}`}
    >
      {children}
    </h1>
  );
}
