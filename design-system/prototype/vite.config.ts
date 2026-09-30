import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Сборка прототипа без плагинов Figma Make: относительные пути — страница открывается из любой папки
// и публикуется одним файлом (scripts/one-page.mjs).
export default defineConfig({
  base: './',
  // Картинки (логотип) — внутрь сборки: прототип публикуется одной страницей.
  build: { assetsInlineLimit: 100_000 },
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { port: 4174 },
})
