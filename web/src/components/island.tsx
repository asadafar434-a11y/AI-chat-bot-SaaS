import type { ReactNode } from "react";

type IslandProps = {
  title: ReactNode;
  count?: ReactNode;
  // Подпись под названием: зачем этот блок.
  sub?: ReactNode;
  // Одно действие справа от названия.
  action?: ReactNode;
  level?: 2 | 3;
  id?: string;
  className?: string;
  children: ReactNode;
};

// Остров с названием — один смысловой блок экрана: дела на сегодня, группа требований, банковские реквизиты.
// Название без черты под ним, содержимое — сразу следом.
export function Island({ title, count, sub, action, level = 2, id, className = "", children }: IslandProps) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby={id} className={`island ${className}`}>
      <div className="island-head">
        <div className="grid min-w-0 gap-0.5">
          <Heading id={id} className="t-section flex items-baseline gap-2">
            {title}
            {count !== undefined && <span className="count">{count}</span>}
          </Heading>
          {sub && <p className="t-caption text-[var(--ink-3)]">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
