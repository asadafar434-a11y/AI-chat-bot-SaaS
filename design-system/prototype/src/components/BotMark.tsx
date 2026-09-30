import { useId } from 'react';
import { cx } from './ui';

// ИИ-ассистент — робот с «AI» на экране. Голова — фирменный градиент (как у кнопки чата), экран — тёмное стекло,
// буквы светятся бирюзовым. Рисунок векторный, буквы — линии: шрифт не нужен, на любом размере одинаково.
// live — на кнопке чата: экран моргает, антенна мигает (при «уменьшить движение» робот стоит спокойно).
export function BotMark({ className, live = false }: { className?: string; live?: boolean }) {
  // У каждой копии — свои id градиентов, иначе при нескольких роботах на странице ссылка может потеряться.
  const id = 'bot-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const letters = (
    <>
      <path d="M14 26 17.8 18 21.6 26M15.3 23.4h5" />
      <path d="M26 18v8" />
    </>
  );
  return (
    <svg viewBox="0 0 40 40" className={cx(live && 'bot-live', className)} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-head`} x1="5" y1="9" x2="35" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4f46e5" />
          <stop offset=".45" stopColor="#6366f1" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
        <linearGradient id={`${id}-gloss`} x1="0" y1="9" x2="0" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".3" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="14" x2="0" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1b2150" />
          <stop offset="1" stopColor="#0b0f2a" />
        </linearGradient>
        <filter id={`${id}-glow`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation=".9" />
        </filter>
      </defs>
      {/* Антенна и уши */}
      <path d="M20 9V5" stroke={`url(#${id}-head)`} strokeWidth={2.2} strokeLinecap="round" />
      <circle className="bot-antenna" cx="20" cy="4.2" r="2.6" fill="#67e8f9" />
      <rect x="2" y="17" width="4.5" height="10" rx="2.2" fill="#4f46e5" />
      <rect x="33.5" y="17" width="4.5" height="10" rx="2.2" fill="#3b82f6" />
      {/* Голова с бликом сверху */}
      <rect x="5" y="9" width="30" height="27" rx="9" fill={`url(#${id}-head)`} />
      <rect x="5" y="9" width="30" height="27" rx="9" fill={`url(#${id}-gloss)`} />
      {/* Экран: стекло, блик и светящиеся «AI» */}
      <rect x="9" y="14" width="22" height="16" rx="6" fill={`url(#${id}-glass)`} />
      <path d="M12 16.6c1.2-.8 2.6-1 4.2-1" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth={1.2} strokeLinecap="round" />
      <g className="bot-eyes" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <g stroke="#67e8f9" strokeWidth={3.2} opacity=".9" filter={`url(#${id}-glow)`}>
          {letters}
        </g>
        <g stroke="#ecfeff" strokeWidth={2.4}>
          {letters}
        </g>
      </g>
    </svg>
  );
}
