"""Разбор карточек сайта. Раскладка повторяет настоящие карточки ЕИС (проверено 20.10.2026), данные ВЫДУМАНЫ."""
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lead_collector import db, pipeline  # noqa: E402
from lead_collector.cards import normalize_phone, parse_card, parse_list_page, region_from_address  # noqa: E402
from lead_collector.web import BlockedError, WebClient, search_params  # noqa: E402

HEAD = """<html><body>
<div class="cardMainInfo"><div>Контракт</div><div>№ 0000000000000000001</div><div>Цена контракта</div><div>914 880,14 ₽</div></div>
<h2>Общая информация</h2>
<div>Реестровый номер контракта</div><div>00000000000 26 000001</div>
<div>Полное наименование заказчика</div><div>МБУ ТЕСТОВАЯ ШКОЛА</div>
<h2>Общие данные</h2>
<div>Дата заключения контракта</div><div>13.07.2026</div>
<div>Номер контракта</div><div>К-15/26</div>
<div>Предмет контракта</div><div>Поставка тестовых товаров</div>
<h2 class="blockInfo__title">Информация о поставщиках</h2>
<div class="participantsInnerHtml"><table class="blockInfo__table"><thead><tr>
<th>Организация</th><th>Страна, код</th><th>Адрес места нахождения</th>%s<th>Телефон, электронная почта</th><th>Статус</th>
</tr></thead><tbody>%s</tbody></table></div></body></html>"""

POSTAL_TH = "<th>Почтовый адрес</th>"

ROW_OOO = """<tr><td><div>ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "РОМАШКА" (ООО "РОМАШКА")</div><div>ИНН: 6154000001</div><div>КПП: 615401001</div></td>
<td>Российская Федерация<br>643</td><td>347909, РОСТОВСКАЯ ОБЛАСТЬ, Г ТАГАНРОГ, УЛ ТЕСТОВАЯ, Д. 85-А</td><td>347909 почтовый</td>
<td><div>7 8634000001</div><div>Info@Romashka.Test</div></td><td>субъект малого предпринимательства</td></tr>"""
ROW_IP = """<tr><td><div>ТЕСТОВ ТЕСТ ТЕСТОВИЧ</div><div>Индивидуальный предприниматель</div><div>ИНН: 183500000012</div></td>
<td>Российская Федерация<br>643</td><td>426076, УДМУРТСКАЯ РЕСПУБЛИКА, Г. ИЖЕВСК, УЛ. ТЕСТОВАЯ, Д.1</td><td>426076 почтовый</td>
<td><div>7 9120000000</div><div>ip@test.example</div></td><td>субъект малого предпринимательства</td></tr>"""
ROW_FOREIGN = """<tr><td><div>FOREIGN LTD</div></td><td>Китай<br>156</td><td>Beijing</td><td>x</td><td>+86 1</td><td></td></tr>"""


def card(*rows, postal=True):
    html = HEAD % (POSTAL_TH if postal else "", "".join(rows))
    if not postal:
        for r in rows:
            html = html.replace(r, r.replace("<td>347909 почтовый</td>", "").replace("<td>426076 почтовый</td>", ""))
    return html


class CardTests(unittest.TestCase):
    def test_ooo_fields(self):
        (rec,) = parse_card(card(ROW_OOO), "0000000000000000001", "")
        self.assertEqual(rec.inn, "6154000001")
        self.assertEqual(rec.kpp, "615401001")
        self.assertEqual(rec.kind, "ООО")
        self.assertIn("РОМАШКА", rec.name)
        self.assertEqual(rec.phone, "+78634000001")
        self.assertEqual(rec.email, "info@romashka.test")
        self.assertEqual(rec.region, "РОСТОВСКАЯ ОБЛАСТЬ")
        self.assertEqual(rec.reg_number, "0000000000000000001")
        self.assertEqual(rec.sign_date, "2026-07-13")
        self.assertEqual(rec.amount, 914880.14)
        self.assertEqual(rec.customer, "МБУ ТЕСТОВАЯ ШКОЛА")
        self.assertEqual(rec.subject, "Поставка тестовых товаров")

    def test_individual_entrepreneur(self):
        (rec,) = parse_card(card(ROW_IP), "0000000000000000001")
        self.assertEqual(rec.kind, "ИП")
        self.assertEqual(rec.name, "ТЕСТОВ ТЕСТ ТЕСТОВИЧ")
        self.assertEqual(rec.kpp, "")
        self.assertEqual(rec.inn, "183500000012")
        self.assertEqual(rec.region, "УДМУРТСКАЯ РЕСПУБЛИКА")

    def test_no_postal_column(self):
        (rec,) = parse_card(card(ROW_OOO, postal=False), "0000000000000000001")
        self.assertEqual(rec.phone, "+78634000001")
        self.assertEqual(rec.email, "info@romashka.test")

    def test_foreign_supplier_skipped_and_two_suppliers(self):
        recs = parse_card(card(ROW_OOO, ROW_FOREIGN, ROW_IP), "0000000000000000001")
        self.assertEqual([r.kind for r in recs], ["ООО", "ИП"])

    def test_no_supplier_block(self):
        self.assertEqual(parse_card("<html><body><p>нет</p></body></html>", "1"), [])

    def test_phone_and_region_helpers(self):
        self.assertEqual(normalize_phone("+7 (495) 789-30-40"), "+74957893040")
        self.assertEqual(normalize_phone("7 9017903210"), "+79017903210")
        self.assertEqual(region_from_address("111020, Г.МОСКВА, ВН.ТЕР.Г. ЛЕФОРТОВО, УЛ. СОЛДАТСКАЯ"), "МОСКВА")
        self.assertEqual(region_from_address("295015, РЕСПУБЛИКА КРЫМ, г.о. СИМФЕРОПОЛЬ"), "РЕСПУБЛИКА КРЫМ")
        self.assertEqual(region_from_address("352528, КРАСНОДАРСКИЙ КРАЙ, Лабинский район"), "КРАСНОДАРСКИЙ КРАЙ")
        self.assertEqual(region_from_address("неизвестно"), "")
        self.assertEqual(region_from_address("165000, АРХАНГЕЛЬСКАЯ ОБЛАСТЬ 29, Г X"), "АРХАНГЕЛЬСКАЯ ОБЛАСТЬ")
        self.assertEqual(region_from_address("165000, АРХАНГЕЛЬСКАЯ ОБЛАСТЬ ВЕЛЬСКИЙ, Г X"), "АРХАНГЕЛЬСКАЯ ОБЛАСТЬ")

    def test_list_page_numbers(self):
        html = '<a href="/x?reestrNumber=3615410729826000015">a</a><a href="/x?reestrNumber=3615410729826000015">b</a>' \
               '<a href="/y?reestrNumber=1234567890123456789">c</a><a href="/z?reestrNumber=12">d</a>'
        self.assertEqual(parse_list_page(html), ["3615410729826000015", "1234567890123456789"])


class FakeSession:
    def __init__(self, pages):
        self.pages, self.headers, self.calls = pages, {}, []

    def get(self, url, timeout=0):
        self.calls.append(url)

        class R:
            pass

        r = R()
        for key, (code, text) in self.pages.items():
            if key in url:
                r.status_code, r.text = code, text
                r.raise_for_status = lambda: None
                return r
        r.status_code, r.text, r.raise_for_status = 404, "", lambda: None
        return r


class WebFlowTests(unittest.TestCase):
    def test_collect_web_is_idempotent_and_skips_known(self):
        conn = db.connect(":memory:")
        num = "0000000000000000001"
        pages = {"results.html": (200, f'<a href="?reestrNumber={num}">x</a>'),
                 "contractCard": (200, card(ROW_OOO, ROW_IP))}
        for _ in range(2):
            web = WebClient(pause=0, max_cards=10, session=FakeSession(pages), sleep=lambda s: None)
            pipeline.collect_web(conn, web, date(2026, 7, 13), date(2026, 7, 13), "", 0)
        self.assertEqual(db.stats(conn)["всего"], 2)
        counts = [r[0] for r in conn.execute("SELECT contracts_count FROM suppliers")]
        self.assertEqual(counts, [1, 1])
        self.assertEqual(sum("contractCard" in c for c in web.http.calls), 0)  # второй запуск карточку не запрашивал

    def test_card_ceiling(self):
        conn = db.connect(":memory:")
        nums = ["0000000000000000001", "0000000000000000002"]
        pages = {"results.html": (200, "".join(f'<a href="?reestrNumber={n}">x</a>' for n in nums)),
                 "contractCard": (200, card(ROW_OOO))}
        web = WebClient(pause=0, max_cards=1, session=FakeSession(pages), sleep=lambda s: None)
        pipeline.collect_web(conn, web, date(2026, 7, 13), date(2026, 7, 13), "", 0)
        self.assertEqual(web.cards_fetched, 1)

    def test_blocked_stops(self):
        pages = {"results.html": (429, "")}
        web = WebClient(pause=0, session=FakeSession(pages), sleep=lambda s: None)
        with self.assertRaises(BlockedError):
            web.day_numbers(date(2026, 7, 13), 0, "")

    def test_search_params(self):
        p = search_params(date(2026, 10, 19), 100000, "", 2)
        self.assertEqual(p["publishDateFrom"], "19.10.2026")
        self.assertNotIn("contractStageList", p)  # с фильтром стадии сайт отвечал пустым списком
        self.assertEqual(search_params(date(2026, 10, 19), 0, "", 1, "signed")["contractDateTo"], "19.10.2026")
        self.assertEqual(p["contractPriceFrom"], "100000")
        self.assertNotIn("customerPlaceCodes", p)

    def test_parse_saved_html_folder(self):
        conn = db.connect(":memory:")
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "a.html").write_text(card(ROW_OOO), encoding="utf-8")
            rep = pipeline.parse_folder(conn, Path(tmp), "", 0)
        self.assertEqual(rep.new_contracts, 1)


if __name__ == "__main__":
    unittest.main()
