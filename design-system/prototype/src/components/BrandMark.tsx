import logo from '../assets/logo-128.png';

// Логотип «Тендерный юрист» — медаль с хрустальными весами. Источник — Figma NDctJTjd4iyzeT9zWg3WwZ,
// узел 8064:410; исходник — design-system/logo.png. Это картинка: вектором её не повторить.
export function BrandMark({ className }: { className?: string }) {
  // Название стоит рядом текстом, поэтому для экранного диктора картинка пустая.
  return <img src={logo} alt="" aria-hidden="true" className={className} draggable={false} />;
}
