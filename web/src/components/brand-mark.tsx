import Image from "next/image";
import logo from "@/assets/logo-128.png";

// Логотип «Тендерный юрист» — медаль с хрустальными весами. Источник — Figma NDctJTjd4iyzeT9zWg3WwZ, узел 8064:410;
// исходник — design-system/logo.png. Картинки 128 px хватает на 36 px даже на экранах с тройной плотностью.
// Размер задаёт className, например size-7. Файл отдаётся из /_next/static — страница входа видит его без пароля.
export function BrandMark({ className = "" }: { className?: string }) {
  return <Image src={logo} alt="" aria-hidden="true" unoptimized className={`flex-none ${className}`} />;
}
