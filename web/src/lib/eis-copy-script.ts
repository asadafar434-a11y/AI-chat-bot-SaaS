// «Скопировать закупки из ЕИС»: закладка для браузера участника. Открыв результаты поиска на zakupki.gov.ru, участник нажимает закладку, и страница (до 50 закупок) копируется таблицей в буфер;
// таблица вставляется в «Поиск закупок» и читается tender-import.ts. Работает в браузере самого участника на странице, которую он уже открыл: с нашего сервера в ЕИС ничего не уходит, защиту сайта мы не обходим.
// Разметка результатов (сверена с настоящей страницей 27.10.2026): блок .search-registry-entry-block; в нём .registry-entry__header-top__title («223-ФЗ Иной способ»), .registry-entry__header-mid__number a (номер и ссылка),
// .registry-entry__body-title + соседний элемент («Объект закупки», «Заказчик» / «Организация, осуществляющая размещение»), .price-block__value, .data-block__title + соседний («Размещено», «Окончание подачи заявок»).
// Если ЕИС поменяет разметку, закладка скажет об этом словами и ничего не выдумает.

export const EIS_COPY_HEADERS = ["Реестровый номер", "Закон", "Способ", "Наименование", "Заказчик", "НМЦК", "Дата размещения", "Окончание подачи заявок", "Ссылка"];

/** Функция (в виде текста): принимает document страницы ЕИС, возвращает таблицу через табуляцию или строку-пояснение, начинающуюся с «!». Только то, что есть на странице. */
export const EIS_EXTRACT = String.raw`function (doc) {
  var blocks = doc.querySelectorAll('.search-registry-entry-block');
  var clean = function (e) { return e ? String(e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim() : ''; };
  var cell = function (s) { return String(s).replace(/[\t\r\n]+/g, ' ').trim(); };
  var rows = [${JSON.stringify(EIS_COPY_HEADERS)}.join('\t')];
  if (!blocks.length) {
    // Пустой результат («0 записей», «ничего не найдено») — это ответ, а не ошибка: только заголовок. Страницу, которую не поняли, называем словами.
    var total = clean(doc.querySelector('.search-results__total'));
    var text = clean(doc.body);
    if (/^0\s+запис/i.test(total) || /ничего\s+не\s+найден|не\s+найден[оы]\s|нет\s+результатов/i.test(text)) return rows.join('\n');
    return '!На странице нет списка закупок. Откройте результаты поиска на zakupki.gov.ru и нажмите закладку ещё раз.';
  }
  var skipped = 0;
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    var head = clean(b.querySelector('.registry-entry__header-top__title'));
    var lawMatch = /(44|223)-ФЗ/.exec(head);
    var link = b.querySelector('.registry-entry__header-mid__number a');
    var num = clean(link).replace(/[^0-9]/g, '');
    var title = '', customer = '', published = '', deadline = '';
    var labels = b.querySelectorAll('.registry-entry__body-title');
    for (var j = 0; j < labels.length; j++) {
      var name = clean(labels[j]).toLowerCase();
      var value = clean(labels[j].nextElementSibling);
      if (/объект/.test(name)) title = value;
      else if (/заказчик|организаци/.test(name)) customer = value;
    }
    var dates = b.querySelectorAll('.data-block__title');
    for (var k = 0; k < dates.length; k++) {
      var dn = clean(dates[k]).toLowerCase();
      var dv = clean(dates[k].nextElementSibling);
      if (/размещено/.test(dn)) published = dv;
      else if (/окончание подачи/.test(dn)) deadline = dv;
    }
    if (!num && !title) { skipped++; continue; }
    var price = clean(b.querySelector('.price-block__value')).replace(/[^0-9,]/g, '');
    rows.push([num, lawMatch ? lawMatch[0] : '', lawMatch ? head.replace(lawMatch[0], '').trim() : head, title, customer, price, published, deadline, link ? link.href : ''].map(cell).join('\t'));
  }
  if (rows.length === 1) return '!Закупки на странице есть, но прочитать их не вышло: ЕИС, видимо, изменил разметку. Напишите нам — поправим.';
  return rows.join('\n') + (skipped ? '\n#пропущено без номера и названия: ' + skipped : '');
}`;

/** Закладка: читает страницу, копирует таблицу в буфер; если браузер не дал, показывает текстовое поле, где всё уже выделено — останется нажать Ctrl+C. */
// Адрес закладки — одна строка: переводы строк и отступы функции сворачиваем в пробелы (комментариев с «//» в функции нет).
const ONE_LINE = EIS_EXTRACT.replace(/\s*\n\s*/g, " ");
export const EIS_BOOKMARKLET = `javascript:(function(){var f=${ONE_LINE};var t=f(document);if(t.charAt(0)==='!'){alert(t.slice(1));return;}var n=t.split('\\n').filter(function(l){return l.charAt(0)!=='#';}).length-1;function show(){var a=document.createElement('textarea');a.value=t;a.style.cssText='position:fixed;z-index:2147483647;left:10%;top:10%;width:80%;height:60%;font:12px monospace';document.body.appendChild(a);a.focus();a.select();alert('Закупок: '+n+'. Нажмите Ctrl+C, затем вставьте в «Поиск закупок».');}if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(function(){alert('Скопировано закупок: '+n+'. Вставьте их в «Поиск закупок».');},show);}else{show();}})();`;
