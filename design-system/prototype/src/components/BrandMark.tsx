import { useId } from 'react';

// Логотип «Тендерный юрист» — индиго-круг с белыми весами. Источник — Figma NDctJTjd4iyzeT9zWg3WwZ,
// узел 8062:406; вектор — design-system/logo.svg. Градиент — как у --logo-gradient в brand.css.
export function BrandMark({ className }: { className?: string }) {
  // У каждого логотипа на странице — свой id градиента, иначе при нескольких копиях ссылка может потеряться.
  const id = 'tl-logo-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="Тендерный юрист">
      <defs>
        <linearGradient id={id} x1="0.1005" y1="-0.0705" x2="0.8995" y2="1.0705">
          <stop offset="0" stopColor="#312e81" />
          <stop offset="0.55" stopColor="#4338ca" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="50" fill={`url(#${id})`} />
      <g
        transform="translate(10.76 9.73) scale(3.27)"
        fill="none"
        stroke="#fff"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3v18" />
        <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
        <path d="m5 7-2.5 7c.83.6 1.75.93 2.5.93S6.67 14.6 7.5 14L5 7Z" />
        <path d="m19 7-2.5 7c.83.6 1.75.93 2.5.93s1.67-.33 2.5-.93L19 7Z" />
        <path d="M8 21h8" />
      </g>
    </svg>
  );
}
