import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Интерфейс продукта. Вид — этот прототип; логика — общий код приложения из web/src (хранилище закупок, план требований,
// карта полей, расчёт цены): «@/…» — это web/src. Документы читает и ИИ вызывает сервер из папки web: запросы /api идут к нему
// (по умолчанию он на порту 3001; API_ORIGIN меняет адрес).
const web = path.resolve(import.meta.dirname, '../../web/src')
const mine = (pkg: string) => path.resolve(import.meta.dirname, 'node_modules', pkg)
const api = process.env.API_ORIGIN ?? 'http://localhost:3001'

export default defineConfig({
  base: './',
  // Картинки (логотип) — внутрь сборки: прототип публикуется одной страницей.
  build: { assetsInlineLimit: 100_000 },
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
})
