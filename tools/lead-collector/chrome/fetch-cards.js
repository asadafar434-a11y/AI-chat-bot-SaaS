// Режим «VPN только в Chrome»: вставить в консоль (F12 → Console) на странице РЕЗУЛЬТАТОВ ПОИСКА реестра контрактов
// zakupki.gov.ru, когда в другом окне запущен приёмник:  python -m lead_collector receive
// Читает карточки со страницы поиска по одной, с паузой, и отправляет их на 127.0.0.1:8765 (только этот компьютер).
// Затем:  python -m lead_collector parse-folder data\inbox --min-amount 100000
// Ничего не обходит: при отказе/капче останавливается. Прогресс: window.__prog
const LIMIT = 40;        // сколько карточек за запуск
const PAUSE_MS = 3500;   // пауза между карточками (не уменьшать)
const nums = [...new Set([...document.querySelectorAll('a[href*=reestrNumber]')]
  .map(a => a.href.match(/reestrNumber=(\d{19})/)[1]))].slice(0, LIMIT);
window.__prog = { start: Date.now(), total: nums.length, done: 0, failed: 0, blocked: false, finished: false };
(async () => {
  for (const n of nums) {
    try {
      const r = await fetch('/epz/contract/contractCard/common-info.html?reestrNumber=' + n, { credentials: 'include' });
      const t = await r.text();
      if (r.status === 403 || r.status === 429 || /captcha/i.test(t.slice(0, 5000))) { window.__prog.blocked = true; break; }
      const p = await fetch('http://127.0.0.1:8765/card/' + n, { method: 'POST', headers: { 'Content-Type': 'text/html' }, body: t });
      p.status === 204 ? window.__prog.done++ : window.__prog.failed++;
    } catch (e) { window.__prog.failed++; }
    await new Promise(res => setTimeout(res, PAUSE_MS));
  }
  window.__prog.finished = true;
  window.__prog.seconds = (Date.now() - window.__prog.start) / 1000;
})();
