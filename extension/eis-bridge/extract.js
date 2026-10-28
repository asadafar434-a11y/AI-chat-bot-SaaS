// Файл собирается командой npm --prefix web run extension:build из web/src/lib/eis-copy-script.ts — руками не править.
globalThis.__tlEisExtract = function (doc) {
  var blocks = doc.querySelectorAll('.search-registry-entry-block');
  var clean = function (e) { return e ? String(e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim() : ''; };
  var cell = function (s) { return String(s).replace(/[\t\r\n]+/g, ' ').trim(); };
  var rows = [["Реестровый номер","Закон","Способ","Наименование","Заказчик","НМЦК","Дата размещения","Окончание подачи заявок","Ссылка"].join('\t')];
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
};
