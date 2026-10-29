import Image from "next/image";
import logo from "@/assets/logo-128.png";

// Знак «Тендекс» — синий квадрат с белой «Т» (комплект — design-system/logo/, значок 1024 — design-system/logo.png; 29.10.2026).
// Картинки 128 px хватает на 36 px даже на экранах с тройной плотностью.
// Размер задаёт className, например size-7. Файл отдаётся из /_next/static — страница входа видит его без пароля.
export function BrandMark({ className = "" }: { className?: string }) {
  return <Image src={logo} alt="" aria-hidden="true" unoptimized className={`flex-none ${className}`} />;
}
