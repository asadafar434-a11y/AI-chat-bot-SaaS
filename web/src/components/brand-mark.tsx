// Логотип «Тендерный юрист» — индиго-круг с белыми весами. Источник — Figma NDctJTjd4iyzeT9zWg3WwZ, узел 8062:406;
// вектор — design-system/logo.svg. Градиент — фоном круга, а не SVG: у логотипа нет id, его можно ставить
// на странице сколько угодно раз. Размер задаёт className, например size-7.
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`grid flex-none place-items-center rounded-full bg-[linear-gradient(145deg,#312e81_0%,#4338ca_55%,#6366f1_100%)] ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-[78.5%] -translate-y-[1.3%]"
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
      </svg>
    </span>
  );
}
