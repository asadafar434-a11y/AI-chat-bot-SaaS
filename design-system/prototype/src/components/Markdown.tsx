import { Fragment, type ReactNode } from 'react';
import { isSafeLink } from '@/lib/safe-link';

// Ответы ассистента приходят разметкой Markdown: абзацы, списки, жирный, ссылки на статьи закона, цитаты, таблицы.
// Здесь только то, что ассистент реально пишет; HTML в тексте не исполняется — React выводит его как текст.

// **жирный**, _курсив_ и *курсив*, `код`, [текст](ссылка)
function Inline({ text }: { text: string }) {
  const parts = text
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s<>"'\])]+|(?<![\w*])_[^_]+_(?![\w*])|(?<![\w*])\*[^*\s][^*]*\*(?![\w*]))/g)
    .filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
          return (
            <code key={i} className="rounded bg-background/60 px-1 py-px font-mono text-[12px]">
              {part.slice(1, -1)}
            </code>
          );
        const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
        if (link)
          return isSafeLink(link[2]) ? (
            <a key={i} href={link[2]} target="_blank" rel="noreferrer" className="text-blue-600 underline underline-offset-2 dark:text-blue-400">
              {link[1]}
            </a>
          ) : (
            <Fragment key={i}>{link[1]}</Fragment>
          );
        // Голый адрес без разметки [текст](ссылка) — модель так тоже пишет; делаем кликабельным отдельно.
        // Конечную пунктуацию предложения («.», «,» …) из адреса не берём — это не часть ссылки.
        if (/^https?:\/\//.test(part)) {
          const m = /^(.*?)([.,;:!?]*)$/.exec(part)!;
          const [, href, trail] = m;
          return isSafeLink(href) ? (
            <Fragment key={i}>
              <a href={href} target="_blank" rel="noreferrer" className="break-all text-blue-600 underline underline-offset-2 dark:text-blue-400">
                {href}
              </a>
              {trail}
            </Fragment>
          ) : (
            <Fragment key={i}>{part}</Fragment>
          );
        }
        if ((part.startsWith('_') && part.endsWith('_') && part.length > 2) || (part.startsWith('*') && part.endsWith('*') && part.length > 2))
          return <em key={i}>{part.slice(1, -1)}</em>;
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

const isRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isSeparator = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <p key={key++} className="font-semibold">
          <Inline text={heading[2]} />
        </p>,
      );
      i++;
      continue;
    }

    if (isRow(line) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={key++} className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {head.map((h, c) => (
                  <th key={c} className="border border-border px-2 py-1 text-left font-medium">
                    <Inline text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border border-border px-2 py-1 align-top">
                      <Inline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(
        <blockquote key={key++} className="border-l-2 border-border pl-2.5 text-muted-foreground">
          <Inline text={quote.join(' ')} />
        </blockquote>,
      );
      continue;
    }

    const bullet = /^\s*[-*•]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const re = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) {
        let item = lines[i++].replace(re, '');
        // Продолжение пункта — строки с отступом.
        while (i < lines.length && lines[i].trim() && /^\s{2,}/.test(lines[i]) && !bullet.test(lines[i]) && !numbered.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(item);
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={key++} className={ordered ? 'list-decimal space-y-1 pl-5' : 'list-disc space-y-1 pl-5'}>
          {items.map((item, n) => (
            <li key={n}>
              <Inline text={item} />
            </li>
          ))}
        </List>,
      );
      continue;
    }

    // Абзац: строки подряд, пока не пустая и не начало другого блока.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4}\s|\s*>|\s*[-*•]\s|\s*\d+[.)]\s)/.test(lines[i]) &&
      !(isRow(lines[i]) && i + 1 < lines.length && isSeparator(lines[i + 1]))
    )
      para.push(lines[i++]);
    // Страховка от зацикливания: строка, которую не взял ни один блок, — обычный абзац.
    if (!para.length) para.push(lines[i++]);
    blocks.push(
      <p key={key++} className="whitespace-pre-wrap">
        <Inline text={para.join('\n')} />
      </p>,
    );
  }

  return <div className="space-y-2">{blocks}</div>;
}
