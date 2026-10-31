import { useId, type ReactNode } from 'react';
import { cx } from './ui';

export type SectionIconName = 'analytics' | 'calculator' | 'cart' | 'company' | 'history' | 'search' | 'settings' | 'tariffs';

// Значки разделов — синее «стекло» с мягким объёмом: свет сверху, глубокий синий снизу.
// Рисуем сами, чтобы набор выглядел одинаково, не зависел от системных эмодзи и шрифтов и совпадал с брендом.
const icon = (blue: string, light: string): Record<SectionIconName, ReactNode> => ({
  cart: (
    <>
      <path d="M7 10h4.2l3.1 13.2h19.4" fill="none" stroke={blue} strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.3 23.2h18.4l-2.1 8.6H16.4l-2.1-8.6Z" fill={blue} />
      <path d="M16.8 26.2h11.8" stroke="#fff" strokeOpacity=".34" strokeWidth="2" strokeLinecap="round" />
      <circle cx="19.2" cy="37" r="3.2" fill={blue} />
      <circle cx="31.6" cy="37" r="3.2" fill={blue} />
      <ellipse cx="17" cy="19" rx="2.2" ry="3.4" fill={light} opacity=".7" />
    </>
  ),
  analytics: (
    <>
      <rect x="8" y="27" width="7.6" height="14" rx="3.8" fill={blue} opacity=".68" />
      <rect x="20.2" y="18" width="7.6" height="23" rx="3.8" fill={blue} opacity=".86" />
      <rect x="32.4" y="9" width="7.6" height="32" rx="3.8" fill={blue} />
      <rect x="10" y="28.6" width="3.6" height="4" rx="1.8" fill={light} />
      <rect x="22.2" y="19.6" width="3.6" height="4" rx="1.8" fill={light} />
      <rect x="34.4" y="10.6" width="3.6" height="4" rx="1.8" fill={light} />
    </>
  ),
  calculator: (
    <>
      <rect x="10" y="6" width="28" height="36" rx="7" fill={blue} />
      <rect x="14" y="10" width="20" height="8" rx="3" fill="#fff" opacity=".9" />
      <circle cx="17.5" cy="26" r="2.2" fill="#fff" opacity=".88" />
      <circle cx="24" cy="26" r="2.2" fill="#fff" opacity=".88" />
      <circle cx="30.5" cy="26" r="2.2" fill="#fff" opacity=".88" />
      <circle cx="17.5" cy="33" r="2.2" fill="#fff" opacity=".88" />
      <circle cx="24" cy="33" r="2.2" fill="#fff" opacity=".88" />
      <rect x="28" y="31" width="5" height="4" rx="2" fill="#fff" opacity=".88" />
      <ellipse cx="17" cy="12" rx="2.2" ry="1.3" fill={light} />
    </>
  ),
  search: (
    <>
      <circle cx="21" cy="21" r="12" fill="none" stroke={blue} strokeWidth="6" />
      <circle cx="21" cy="21" r="8.2" fill="#fff" fillOpacity=".08" />
      <path d="M15.8 17.2a6.4 6.4 0 0 1 6-3.2" fill="none" stroke="#fff" strokeOpacity=".52" strokeWidth="2.4" strokeLinecap="round" />
      <path d="m30 30 8.2 8.2" fill="none" stroke={blue} strokeWidth="6" strokeLinecap="round" />
      <path d="m31.4 31.4 4.6 4.6" fill="none" stroke="#fff" strokeOpacity=".2" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  history: (
    <>
      <circle cx="24" cy="24" r="16" fill={blue} />
      <circle cx="24" cy="24" r="12" fill="#fff" fillOpacity=".08" />
      <path d="M24 14v10l6.8 4" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="24" r="2.2" fill="#fff" />
      <path d="M14 13.5a13.2 13.2 0 0 1 8-4.3" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="2.5" strokeLinecap="round" />
    </>
  ),
  tariffs: (
    <>
      <rect x="7" y="12" width="34" height="24" rx="6" fill={blue} />
      <path d="M7 18h34" stroke="#123c9e" strokeWidth="3.2" opacity=".55" />
      <rect x="12" y="27" width="10" height="3.6" rx="1.8" fill="#fff" opacity=".88" />
      <circle cx="33" cy="29" r="3" fill="#fff" opacity=".7" />
      <path d="M12 15h8" stroke="#fff" strokeOpacity=".38" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  settings: (
    <>
      <g fill={blue}>
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <rect key={angle} x="21.8" y="4.5" width="4.4" height="9" rx="2.2" transform={`rotate(${angle} 24 24)`} />
        ))}
        <circle cx="24" cy="24" r="11.8" />
      </g>
      <circle cx="24" cy="24" r="4.6" fill="#123c9e" opacity=".92" />
      <circle cx="22.2" cy="22.2" r="1.4" fill="#fff" opacity=".32" />
    </>
  ),
  company: (
    <>
      <rect x="20.8" y="19" width="6.4" height="9" rx="3.2" fill={blue} />
      <circle cx="24" cy="15" r="7.4" fill={blue} />
      <circle cx="21" cy="12.8" r="2" fill="#fff" opacity=".32" />
      <path d="M9.6 40.4c0-8.4 6.4-14.2 14.4-14.2s14.4 5.8 14.4 14.2v1.4H9.6v-1.4Z" fill={blue} />
      <path d="m20 27.6 4 5.2 4-5.2c-2.4-1-5.6-1-8 0Z" fill="#fff" opacity=".9" />
      <path d="M13 38.2c1-4 4-6.3 7-7.2" fill="none" stroke="#fff" strokeOpacity=".24" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
});

export function SectionIcon({ name, className = 'size-8' }: { name: SectionIconName; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const blue = `url(#${uid}-blue)`;
  const light = `url(#${uid}-light)`;
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={cx('shrink-0 drop-shadow-sm', className)}>
      <defs>
        <linearGradient id={`${uid}-blue`} x1="12" y1="6" x2="36" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8cc8ff" />
          <stop offset=".45" stopColor="#4b93ff" />
          <stop offset="1" stopColor="#1e4fd8" />
        </linearGradient>
        <linearGradient id={`${uid}-light`} x1="24" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {icon(blue, light)[name]}
    </svg>
  );
}
