// Прототип одной страницей: стили и скрипт сборки — внутрь HTML. Так его можно открыть двойным щелчком
// и опубликовать ссылкой. dist/prototype.html — полный документ, dist/fragment.html — без <html> и <head>
// (для публикации: обёртку страницы добавляет площадка).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const dir = new URL('../dist/assets/', import.meta.url)
const files = readdirSync(dir)
const read = (ext) => readFileSync(new URL(files.find((f) => f.endsWith(ext)), dir), 'utf8')
const css = read('.css')
const js = read('.js')
if (/<\/script/i.test(js) || /<\/style/i.test(css)) throw new Error('В сборке есть закрывающий тег — встроить нельзя')

const title = 'Тендерный юрист — прототип'
// Значок вкладки — логотип 64 px (public/favicon.png из design-system/logo.png), встроенный в страницу.
const favicon = `data:image/png;base64,${readFileSync(new URL('../public/favicon.png', import.meta.url)).toString('base64')}`
const body = `<style>\n${css}\n</style>\n<div id="root"></div>\n<script type="module">\n${js}\n</script>\n`
writeFileSync(new URL('../dist/fragment.html', import.meta.url), `<title>${title}</title>\n${body}`)
writeFileSync(
  new URL('../dist/prototype.html', import.meta.url),
  `<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>${title}</title>\n<link rel="icon" type="image/png" href="${favicon}">\n</head>\n<body>\n${body}</body>\n</html>\n`,
)
console.log(`dist/prototype.html — ${Math.round((css.length + js.length) / 1024)} КБ`)
