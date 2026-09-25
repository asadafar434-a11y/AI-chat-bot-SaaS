// Скачивает 44-ФЗ и 223-ФЗ в действующей редакции с официального портала правовой информации
// (pravo.gov.ru) и режет их по статьям в src/data/laws/*.json. Законы меняются обычно с 1 января
// и 1 сентября — тогда скрипт запускают заново:
//   node scripts/fetch-laws.mjs
import { mkdir, writeFile } from "node:fs/promises";

const IPS = "http://pravo.gov.ru/proxy/ips/";
const OUT = new URL("../src/data/laws/", import.meta.url);

// nd — номер документа в банке «Законодательство России» на портале.
const LAWS = [
  { id: "44-fz", name: "44-ФЗ", nd: "102164547" },
  { id: "223-fz", name: "223-ФЗ", nd: "102149420" },
];

async function fetchBytes(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (attempt === 3) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

const cp1251 = new TextDecoder("windows-1251");

// Действующая редакция — та, что портал открывает по умолчанию.
async function currentEdition(nd) {
  const page = cp1251.decode(await fetchBytes(`${IPS}?docbody=&nd=${nd}`));
  const rdk = /doc_itself=&nd=\d+&page=1&rdk=(\d+)/.exec(page)?.[1];
  if (!rdk) throw new Error(`не нашёл редакцию документа ${nd}`);
  const label = new RegExp(`<option id="s1o\\d+" value="${rdk}">([^<]*)`).exec(page)?.[1]?.trim() ?? "";
  const m = /от (\d\d\.\d\d\.\d{4})(?:\s*№\s*([^\s(]+))?/.exec(label);
  return { rdk, label, date: m?.[1] ?? "", by: m?.[2] ?? "" };
}

// «Сохранить в RTF» на портале отдаёт веб-страницу в одном файле: HTML в quoted-printable, cp1251.
function htmlFromMhtml(bytes) {
  const s = Buffer.from(bytes).toString("latin1");
  const part = s.indexOf("Content-Type: text/html");
  const body = s.indexOf("\r\n\r\n", part) + 4;
  const qp = s.slice(body, s.indexOf("------=_NextPart", body)).replace(/=\r?\n/g, "");
  const out = [];
  for (let i = 0; i < qp.length; i++) {
    if (qp[i] === "=" && /^[0-9A-F]{2}$/i.test(qp.substr(i + 1, 2))) {
      out.push(parseInt(qp.substr(i + 1, 2), 16));
      i += 2;
    } else out.push(qp.charCodeAt(i) & 255);
  }
  return cp1251.decode(Uint8Array.from(out));
}

const ENTITIES = { nbsp: " ", laquo: "«", raquo: "»", quot: '"', amp: "&", lt: "<", gt: ">", mdash: "—", ndash: "–", sect: "§" };

function linesFromHtml(html) {
  return html
    .replace(/<head[\s\S]*?<\/head>|<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "")
    // Номера вставленных статей и частей набраны верхним индексом: 111<sup>4</sup> — это 111.4.
    // Иногда основная часть номера закрыта в своём span: «§ 3</span><span class="W9">1</span>».
    .replace(/(\d)((?:<\/span>)?)<span class="W\d+">(\d+)<\/span>/g, "$1$2.$3")
    .replace(/<\/(p|div|tr|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|[a-z]+);/gi, (m, e) => (e[0] === "#" ? String.fromCharCode(Number(e.slice(1))) : ENTITIES[e] ?? m))
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const HEADING = {
  chapter: /^Глава (\d+(?:\.\d+)*)\.? ?(.*)$/,
  section: /^§ ?(\d+(?:\.\d+)*)\.? ?(.*)$/,
  article: /^Статья (\d+(?:\.\d+)*)\. ?(.*)$/,
};

function splitArticles(lines) {
  const articles = [];
  // Утратившие силу главы и параграфы портал даёт одной строкой: «§ 5. (Статьи 84 - 92)» и пометка.
  const repealed = [];
  let chapter = "";
  let section = "";
  let current = null;
  let heading = "";
  const header = [];
  for (const line of lines) {
    const art = line.length < 400 && HEADING.article.exec(line);
    if (art) {
      current = { num: art[1], title: art[2], chapter, ...(section && { section }), lines: [] };
      articles.push(current);
      heading = "";
      continue;
    }
    if (line.length < 400 && (HEADING.chapter.test(line) || HEADING.section.test(line))) {
      if (HEADING.chapter.test(line)) {
        chapter = line;
        section = "";
      } else section = line;
      current = null;
      heading = line;
      continue;
    }
    if (current) current.lines.push(line);
    else if (heading && /утрат/i.test(line)) repealed.push(`${heading} ${line}`);
    else if (!articles.length) header.push(line);
  }
  return {
    header,
    repealed,
    articles: articles.map(({ lines, ...a }) => ({ ...a, text: lines.join("\n") })),
  };
}

for (const law of LAWS) {
  const edition = await currentEdition(law.nd);
  const html = htmlFromMhtml(await fetchBytes(`${IPS}?savertf=&nd=${law.nd}&page=all&rdk=${edition.rdk}`));
  const { header, repealed, articles } = splitArticles(linesFromHtml(html));
  const title = header.find((l) => /^О /.test(l)) ?? "";
  const amendedBy = header.find((l) => /^\(В редакции/.test(l)) ?? "";
  const data = {
    id: law.id,
    name: law.name,
    title,
    edition,
    source: `${IPS}?docbody=&nd=${law.nd}&rdk=${edition.rdk}`,
    fetchedAt: new Date().toISOString().slice(0, 10),
    amendedBy,
    repealed,
    articles,
  };
  await mkdir(OUT, { recursive: true });
  await writeFile(new URL(`${law.id}.json`, OUT), JSON.stringify(data, null, 1));
  const chars = articles.reduce((n, a) => n + a.text.length, 0);
  console.log(`${law.name}: ${articles.length} статей, ${chars.toLocaleString("ru-RU")} знаков, редакция «${edition.label}»`);
}
