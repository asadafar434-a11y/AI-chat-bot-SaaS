// Собирает extract.js из той же функции, что работает в закладке «Скопировать закупки» (web/src/lib/eis-copy-script.ts): чтение страницы ЕИС в одном месте.
// Запуск: npm --prefix web run extension:build. Тест web/src/lib/eis-extension.test.ts следит, чтобы файл не отстал.
import { writeFileSync } from 'node:fs';
import { EIS_EXTRACT } from '../../web/src/lib/eis-copy-script.ts';

export const extractSource = () =>
  '// Файл собирается командой npm --prefix web run extension:build из web/src/lib/eis-copy-script.ts — руками не править.\n' +
  'globalThis.__tlEisExtract = ' + EIS_EXTRACT + ';\n';

// Запуск из командной строки пишет файл; при импорте из теста — только отдаёт текст.
if (process.argv[1] && process.argv[1].endsWith('build.mjs')) {
  writeFileSync(new URL('./extract.js', import.meta.url), extractSource());
  console.log('extract.js собран');
}
