// Мост между страницей «Тендерного юриста» и расширением. Страница просит поиск сообщением, расширение отвечает таблицей.
// Стоит только на адресах приложения (manifest.json). Страница узнаёт о расширении по атрибуту data-tl-eis-extension на <html>.
(function () {
  var version = chrome.runtime.getManifest().version;
  document.documentElement.setAttribute('data-tl-eis-extension', version);

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (e.source !== window || !d || d.type !== 'TL_EIS_SEARCH' || typeof d.requestId !== 'string') return;
    chrome.runtime.sendMessage({ type: 'TL_EIS_SEARCH', url: d.url, pages: d.pages }, function (resp) {
      var err = chrome.runtime.lastError;
      var out = err ? { error: err.message } : resp || { error: 'Расширение не ответило.' };
      window.postMessage(Object.assign({ type: 'TL_EIS_RESULT', requestId: d.requestId }, out), location.origin);
    });
  });
})();
