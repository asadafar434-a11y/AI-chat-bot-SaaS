import logo from '../assets/logo-128.png';

// Знак «Тендекс» — синий квадрат с белой «Т» (комплект — design-system/logo/, значок 1024 — design-system/logo.png; 29.10.2026). Картинка 128 px: хватает на 36 px даже на экранах с тройной плотностью.
export function BrandMark({ className }: { className?: string }) {
  // Название стоит рядом текстом, поэтому для экранного диктора картинка пустая.
  return <img src={logo} alt="" aria-hidden="true" className={className} draggable={false} />;
}
