import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Экран продукта (design-system/prototype) собирается в public/product командой `npm run build:host`. Есть сборка — главная
// страница отдаёт его, и у продукта один адрес: экран, /api, вход по паролю, правовые страницы. Нет сборки (первый запуск,
// автопроверка) или идёт next dev — остаётся прежняя главная страница приложения. Это решается при сборке сервера
// (next build), поэтому экран собирают до него.
const HAS_PRODUCT_SCREEN = !isDev && existsSync(path.join(process.cwd(), "public", "product", "index.html"));

// Политика содержимого (CSP) — без nonce, как в руководстве Next.js «Content Security Policy», раздел «Without Nonces»:
// с nonce все страницы пришлось бы рендерить на каждый запрос. Встроенным скриптам Next.js нужен 'unsafe-inline',
// но главное закрыто: чужие скрипты, запросы и картинки с других сайтов (ссылка-картинка в ответе ИИ не унесёт
// данные на чужой сервер), встраивание во фрейм, подмена <base> и отправка форм на чужой адрес.
// 'unsafe-eval' — только в next dev: он нужен React для отладки. upgrade-insecure-requests нет: приложение работает
// и по http на своём компьютере, а https на хостинге включает сам хостинг.
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  // Для старых браузеров, не знающих frame-ancestors.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Адреса страниц (в них номера закупок) на другие сайты не уходят.
  { key: "Referrer-Policy", value: "same-origin" },
  // Камера, микрофон и местоположение приложению не нужны.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // pdfmake и pdfkit читают свои шрифты и таблицы с диска рядом с собой — их нельзя склеивать в общий файл сборки.
  serverExternalPackages: ["pdf-parse", "mammoth", "pdfmake", "pdfkit"],
  // Заголовок «X-Powered-By: Next.js» подсказывает, какие уязвимости пробовать.
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // Файлы экрана названы по содержимому (index-AbC123.js): изменились — имя другое, поэтому браузер хранит их год.
      // private: общий кеш (прокси, CDN) файлы закрытой ссылки не хранит.
      { source: "/product/assets/:path*", headers: [{ key: "Cache-Control", value: "private, max-age=31536000, immutable" }] },
    ];
  },
  async rewrites() {
    return HAS_PRODUCT_SCREEN ? { beforeFiles: [{ source: "/", destination: "/product/index.html" }] } : [];
  },
  experimental: {
    // Прокси входа (src/proxy.ts) держит тело запроса в памяти, по умолчанию — только первые 10 МБ,
    // и больший файл приходил обрезанным. Файлы идут по одному, каждый — до 40 МБ (MAX_FILE_MB).
    proxyClientMaxBodySize: "45mb",
  },
};

export default nextConfig;
