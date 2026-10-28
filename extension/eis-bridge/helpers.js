// Чистые функции расширения: проверка адреса, постраничная сборка, склейка таблиц. Без обращения к chrome.*, поэтому проверяются тестами (web/src/lib/eis-extension.test.ts).
(function (root) {
  var SEARCH = /^https:\/\/zakupki\.gov\.ru\/epz\/order\/extendedsearch\/results\.html\?/;
  var MAX_PAGES = 3;
  var PER_PAGE = 50;

  // Открываем только поиск закупок ЕИС: другой адрес из страницы не принимается, как бы он ни был записан.
  function isAllowedUrl(url) {
    if (typeof url !== 'string' || url.length > 2000 || !SEARCH.test(url)) return false;
    try {
      var u = new URL(url);
      return u.protocol === 'https:' && u.hostname === 'zakupki.gov.ru' && u.pathname === '/epz/order/extendedsearch/results.html';
    } catch (e) {
      return false;
    }
  }

  function pageUrl(url, n) {
    return /[?&]pageNumber=\d+/.test(url) ? url.replace(/([?&]pageNumber=)\d+/, '$1' + n) : url + '&pageNumber=' + n;
  }

  function clampPages(n) {
    var v = Number(n);
    return Number.isFinite(v) && v >= 1 ? Math.min(MAX_PAGES, Math.floor(v)) : 1;
  }

  // Строки закупок страницы (без заголовка и служебных «#…»); сообщение об ошибке начинается с «!».
  function rowsOf(tsv) {
    return String(tsv).split('\n').slice(1).filter(function (l) { return l.trim() !== '' && l.charAt(0) !== '#'; });
  }

  // Склеивает таблицы страниц в одну: заголовок один, повторы номеров убираются.
  function mergePages(tables) {
    var header = null;
    var seen = {};
    var rows = [];
    tables.forEach(function (t) {
      if (typeof t !== 'string' || t.charAt(0) === '!') return;
      if (header === null) header = t.split('\n')[0];
      rowsOf(t).forEach(function (l) {
        var id = l.split('\t')[0];
        if (id && seen[id]) return;
        if (id) seen[id] = true;
        rows.push(l);
      });
    });
    return header === null ? null : [header].concat(rows).join('\n');
  }

  // Нужна ли следующая страница: эта оказалась полной.
  function pageIsFull(tsv) {
    return typeof tsv === 'string' && tsv.charAt(0) !== '!' && rowsOf(tsv).length >= PER_PAGE;
  }

  var api = { isAllowedUrl: isAllowedUrl, pageUrl: pageUrl, clampPages: clampPages, mergePages: mergePages, pageIsFull: pageIsFull, rowsOf: rowsOf, MAX_PAGES: MAX_PAGES, PER_PAGE: PER_PAGE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TLEIS = api;
})(typeof self !== 'undefined' ? self : globalThis);
