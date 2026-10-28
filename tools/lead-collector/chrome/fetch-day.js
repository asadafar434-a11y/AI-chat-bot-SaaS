// Весь день в режиме «VPN только в Chrome». Вставить в консоль Chrome на странице zakupki.gov.ru
// (приёмник должен работать:  python -m lead_collector receive).
// Сайт показывает не больше 1000 результатов на запрос, поэтому день режется на ценовые диапазоны.
// Устойчив к обрывам: список контрактов сохраняется в localStorage, полученные карточки пропускаются
// (спрашиваем у приёмника), при недоступности сайта ждёт и повторяет, у каждого запроса тайм-аут 60 с.
// Остановка: window.__stop = true. Прогресс: window.__prog. Пауза между запросами — не уменьшать.
(() => {
  const DAY = '19.10.2026';     // дата размещения контракта в реестре, ДД.ММ.ГГГГ
  const MIN_PRICE = 500000;     // минимальная сумма контракта, ₽
  const PAUSE_MS = 3500, PER_PAGE = 50, SITE_CAP = 1000;
  const KEY = `lc_found_${DAY}_${MIN_PRICE}`;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const me = Symbol(); window.__run = me; window.__stop = false;
  const P = window.__prog = { phase: 'старт', ranges: 0, listed: 0, cards_todo: 0, done: 0, failed: 0, retries: 0, waiting: false, blocked: false, finished: false, start: Date.now() };
  const alive = () => !window.__stop && window.__run === me;

  async function tfetch(url, opts) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 60000);
    try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
  }
  async function get(url) {            // одна попытка; ошибка — наверх
    await sleep(PAUSE_MS);
    const r = await tfetch(url, { credentials: 'include' });
    const t = await r.text();
    if (r.status === 403 || r.status === 429 || /captcha/i.test(t.slice(0, 5000))) { P.blocked = true; throw new Error('blocked'); }
    if (r.status >= 500) throw new Error('http ' + r.status);
    return t;
  }
  let down = 0;
  async function getPatient(url) {      // ждёт, пока сайт снова ответит (VPN, сеть), но не обходит блокировку
    for (;;) {
      if (!alive()) throw new Error('stopped');
      try { const t = await get(url); down = 0; P.waiting = false; return t; }
      catch (e) {
        if (P.blocked) throw e;
        down++; P.retries++;
        if (down >= 3) { P.waiting = true; await sleep(120000); } else await sleep(PAUSE_MS * 2 * down);
      }
    }
  }
  const listUrl = (from, to, page) => '/epz/contract/search/results.html?morphology=on&fz44=on&sortBy=PUBLISH_DATE&sortDirection=false'
    + `&pageNumber=${page}&recordsPerPage=_${PER_PAGE}&publishDateFrom=${DAY}&publishDateTo=${DAY}&contractPriceFrom=${from}` + (to ? `&contractPriceTo=${to}` : '');
  const numbers = html => [...html.matchAll(/reestrNumber=(\d{19})/g)].map(m => m[1]);
  const countOf = html => {
    const h = html.replace(/ /g, ' ');
    const m = h.match(/Результаты поиска\s*<[^]*?>?\s*((?:более\s+)?[\d\s]+)\s*записей/i) || h.match(/((?:более\s+)?[\d ]+)\s*записей/i);
    return m ? { n: parseInt(m[1].replace(/\D/g, ''), 10), more: /более/.test(m[1]) } : null;
  };

  const found = window.__found = new Set();
  async function enumerate(from, to) {
    if (!alive()) return;
    const first = await getPatient(listUrl(from, to, 1));
    const c = countOf(first) || { n: numbers(first).length, more: false };
    if (c.n === 0) return;
    if ((c.n > SITE_CAP || (c.more && c.n >= SITE_CAP)) && (to === null || to - from > 1)) {
      const mid = to === null ? from * 2 : Math.floor((from + to) / 2);
      await enumerate(from, mid); await enumerate(mid, to); return;
    }
    P.ranges++;
    numbers(first).forEach(n => found.add(n));
    const pages = Math.min(Math.ceil(c.n / PER_PAGE), SITE_CAP / PER_PAGE);
    for (let p = 2; p <= pages && alive(); p++) numbers(await getPatient(listUrl(from, to, p))).forEach(n => found.add(n));
    P.listed = found.size;
  }

  (async () => {
    try {
      let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
      if (saved && saved.length) { saved.forEach(n => found.add(n)); P.phase = 'список из памяти'; }
      else {
        P.phase = 'список';
        const bands = [[MIN_PRICE, 600000], [600000, 800000], [800000, 1000000], [1000000, 1500000], [1500000, 2500000],
                       [2500000, 5000000], [5000000, 10000000], [10000000, 50000000], [50000000, null]].filter(b => b[1] === null || b[1] > MIN_PRICE);
        for (const [a, b] of bands) await enumerate(a, b);
        if (alive()) try { localStorage.setItem(KEY, JSON.stringify([...found])); } catch (e) {}
      }
      const have = new Set(await (await tfetch('http://127.0.0.1:8765/have')).json());
      const queue = [...found].filter(n => !have.has(n));
      P.cards_todo = found.size; P.phase = 'карточки';
      while (queue.length && alive()) {
        const n = queue.shift();
        try {
          const html = await getPatient('/epz/contract/contractCard/common-info.html?reestrNumber=' + n);
          const r = await tfetch('http://127.0.0.1:8765/card/' + n, { method: 'POST', headers: { 'Content-Type': 'text/html' }, body: html });
          if (r.status === 204) P.done++; else { P.failed++; queue.push(n); }
        } catch (e) { if (P.blocked || !alive()) break; P.failed++; queue.push(n); }
      }
      P.phase = P.blocked ? 'блокировка сайта' : (!alive() ? 'остановлено' : 'готово');
    } catch (e) { P.phase = P.blocked ? 'блокировка сайта' : 'ошибка: ' + e.message; }
    P.finished = true; P.seconds = (Date.now() - P.start) / 1000;
  })();
})();
