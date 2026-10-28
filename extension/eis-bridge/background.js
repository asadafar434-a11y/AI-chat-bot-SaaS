// Фоновая часть: по просьбе страницы «Тендерного юриста» открывает поиск ЕИС в фоновой вкладке, читает страницу (extract.js) и закрывает вкладку.
// Идёт через настоящий браузер пользователя, как если бы он сам открыл ссылку: никаких обходов защиты сайта, ни капчи, ни паролей.
importScripts('helpers.js');

const OPEN_TIMEOUT_MS = 30000;
const RENDER_WAIT_MS = 8000;
const PAUSE_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('ЕИС не открылся за 30 секунд.'));
    }, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    // вкладка могла загрузиться до подписки
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === 'complete') listener(tabId, { status: 'complete' });
    }).catch(() => {});
  });
}

async function readPage(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitComplete(tab.id, OPEN_TIMEOUT_MS);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['extract.js'] });
    // Список рисуется сразу, но подождём, пока блоки появятся или станет ясно, что их нет.
    const until = Date.now() + RENDER_WAIT_MS;
    for (;;) {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.__tlEisExtract(document) });
      const empty = typeof result === 'string' && result.charAt(0) === '!';
      if (!empty || Date.now() > until) return typeof result === 'string' ? result : '!Страница не прочиталась.';
      await sleep(500);
    }
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function search(url, pagesWanted) {
  if (!self.TLEIS.isAllowedUrl(url)) throw new Error('Этот адрес расширение не открывает: только поиск закупок на zakupki.gov.ru.');
  const pages = self.TLEIS.clampPages(pagesWanted);
  const tables = [];
  for (let n = 1; n <= pages; n++) {
    if (n > 1) await sleep(PAUSE_MS);
    const table = await readPage(self.TLEIS.pageUrl(url, n));
    tables.push(table);
    if (!self.TLEIS.pageIsFull(table)) break;
  }
  const merged = self.TLEIS.mergePages(tables);
  if (merged === null) {
    const msg = tables.find((t) => typeof t === 'string' && t.charAt(0) === '!');
    throw new Error(msg ? msg.slice(1) : 'ЕИС ничего не вернул.');
  }
  return { tsv: merged, pages: tables.length, count: self.TLEIS.rowsOf(merged).length };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'TL_EIS_SEARCH') return false;
  // Принимаем только от вкладок приложения (content.js стоит только на его адресах).
  if (!sender.tab) return false;
  search(message.url, message.pages).then(
    (r) => sendResponse(r),
    (e) => sendResponse({ error: String((e && e.message) || e) }),
  );
  return true;
});
