import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Сборка прототипа без плагинов Figma Make: относительные пути — страница открывается из любой папки
// и публикуется одним файлом (scripts/one-page.mjs).
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { port: 4174 },
})
