import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Интерфейс продукта. Вид — этот прототип; логика — общий код приложения из web/src (хранилище закупок, план требований,
// карта полей, расчёт цены): «@/…» — это web/src. Документы читает и ИИ вызывает сервер из папки web: запросы /api идут к нему
// (по умолчанию он на порту 3001; API_ORIGIN меняет адрес).
const web = path.resolve(import.meta.dirname, '../../web/src')
const mine = (pkg: string) => path.resolve(import.meta.dirname, 'node_modules', pkg)
const api = process.env.API_ORIGIN ?? 'http://localhost:3001'

export default defineConfig(({ mode }) => {
  // Сборка для сервера — vite build --mode host. Готовый интерфейс кладётся в web/public/product, а главная страница сервера
  // отдаёт его (rewrites в web/next.config.ts): у продукта один адрес — экран, /api, вход по паролю и правовые страницы.
  // Пути в нём идут от /product/. Шрифты остаются отдельными файлами: политика содержимого сервера не пускает шрифты из data:.
  const host = mode === 'host'
  // Где хранятся закупки: server — в базе на сервере, вход по почте и паролю (так будет на настоящем хостинге); browser — только в
  // браузере, без входа. Для сборки на сервер (host) по умолчанию server; в паре для правок экрана — browser. Меняется PRODUCT_STORAGE
  // в окружении или в web/.env.local (npm run build:host читает оба).
  const stored = process.env.PRODUCT_STORAGE ?? loadEnv(mode, path.resolve(import.meta.dirname, '../../web'), '').PRODUCT_STORAGE
  const storage = stored === 'server' || stored === 'browser' ? stored : host ? 'server' : 'browser'
  return {
    base: host ? '/product/' : './',
    build: host
      ? {
          outDir: path.resolve(import.meta.dirname, '../../web/public/product'),
          emptyOutDir: true,
          assetsInlineLimit: (file: string, content: Buffer) => !/\.woff2?$/.test(file) && content.length < 100_000,
        }
      : // Картинки (логотип) и шрифты — внутрь сборки: прототип публикуется одной страницей.
        { assetsInlineLimit: 100_000 },
    // server: чтение закупок с сервера и запись на сервер (после записи в браузер, как задумано в S5); browser: только IndexedDB.
    define:
      storage === 'server'
        ? { 'process.env.NEXT_PUBLIC_SERVER_READS': JSON.stringify('1'), 'process.env.NEXT_PUBLIC_SERVER_WRITES': JSON.stringify('1') }
        : { 'process.env.NEXT_PUBLIC_SERVER_READS': JSON.stringify('0'), 'process.env.NEXT_PUBLIC_SERVER_WRITES': JSON.stringify('0') },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: [
        { find: '@', replacement: web },
        // Одна копия React на весь интерфейс: общий код из web/src не приносит свою.
        { find: /^react$/, replacement: mine('react') },
        { find: /^react\/(.*)$/, replacement: mine('react') + '/$1' },
        { find: /^react-dom$/, replacement: mine('react-dom') },
        { find: /^react-dom\/(.*)$/, replacement: mine('react-dom') + '/$1' },
      ],
      dedupe: ['react', 'react-dom'],
    },
    server: {
      port: 4174,
      fs: { allow: [path.resolve(import.meta.dirname, '../..')] },
      proxy: {
        '/api': { target: api, changeOrigin: true, timeout: 600000, proxyTimeout: 600000 },
        // Правовые страницы: политика, согласия, условия, контакты — с их стилями и шрифтами.
        '^/(consent|consent-transfer|privacy|terms|contacts|help)/?$': { target: api, changeOrigin: true },
        '/_next': { target: api, changeOrigin: true, ws: true },
      },
    },
  }
})
