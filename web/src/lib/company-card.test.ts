import assert from "node:assert/strict";
import { test } from "node:test";
import { addItem, addOwn, CERTIFICATE_OPTIONS, EMPTY_CARD, INDUSTRY_OPTIONS, LICENSE_OPTIONS, ownItems, profileStrength, readCard, removeOwn, rublesText, toggleItem } from "@/lib/company-card";
import { EMPTY_PROFILE, PROFILE_KEYS } from "@/lib/profile";
import { parseBackup } from "@/lib/backup-format";

const fullProfile = Object.fromEntries(PROFILE_KEYS.map((k) => [k, "x"])) as typeof EMPTY_PROFILE;

test("сила профиля: пустой профиль — 0 %, всё заполнено — 100 %", () => {
  assert.equal(profileStrength(EMPTY_PROFILE, EMPTY_CARD).percent, 0);
  const card = readCard({
    experience: { years: "10", contractsWon: "50", employees: "25", turnover: "10000000", maxContract: "5000000", foundedYear: "2010" },
    industries: ["Поставка товаров"],
    licenses: ["Медицинская лицензия"],
    certificates: ["ISO 9001 (менеджмент качества)"],
  });
  assert.equal(profileStrength(fullProfile, card).percent, 100);
});

test("сила профиля: доли разделов — реквизиты 40, опыт 20, специализация 15, лицензии 15, сертификаты 10", () => {
  const industries = readCard({ industries: ["Экология"] });
  assert.equal(profileStrength(EMPTY_PROFILE, industries).percent, 15);
  assert.equal(profileStrength(fullProfile, EMPTY_CARD).percent, 40);
  const half = { ...fullProfile, ...Object.fromEntries(PROFILE_KEYS.slice(0, PROFILE_KEYS.length / 2).map((k) => [k, ""])) };
  assert.equal(profileStrength(half, EMPTY_CARD).percent, 20);
  const exp = readCard({ experience: { years: "10", contractsWon: "5", employees: "3" } });
  assert.equal(profileStrength(EMPTY_PROFILE, exp).percent, 10);
});

test("явное «нет» лицензий и сертификатов тоже ответ; допуск без лицензии считается как лицензии", () => {
  assert.equal(profileStrength(EMPTY_PROFILE, readCard({ noLicenses: true, noCertificates: true })).percent, 25);
  const parts = profileStrength(EMPTY_PROFILE, readCard({ permits: ["Работы на высоте"], noCertificates: true })).parts;
  assert.equal(parts.find((p) => p.key === "licenses")?.done, true);
  assert.equal(parts.find((p) => p.key === "licenses")?.detail, "выбрано 1");
  assert.equal(parts.find((p) => p.key === "certificates")?.detail, "нет");
});

test("карточка из браузера: мусор отбрасывается, числа — только цифры, повторы убираются", () => {
  const card = readCard({ experience: { years: "10 лет", turnover: "1 000 000 ₽", foundedYear: 2010 }, industries: ["А", "А", " ", 5, "Б"], noLicenses: "да" });
  assert.equal(card.experience.years, "10");
  assert.equal(card.experience.turnover, "1000000");
  assert.equal(card.experience.foundedYear, "2010");
  assert.deepEqual(card.industries, ["А", "Б"]);
  assert.equal(card.noLicenses, false);
  assert.deepEqual(readCard(null), EMPTY_CARD);
  assert.deepEqual(readCard("строка"), EMPTY_CARD);
});

test("выбор плашек: нажатие включает и выключает; свой пункт без повторов", () => {
  assert.deepEqual(toggleItem(["А"], "Б"), ["А", "Б"]);
  assert.deepEqual(toggleItem(["А", "Б"], "А"), ["Б"]);
  assert.deepEqual(addItem(["Лицензия"], "  лицензия "), ["Лицензия"]);
  assert.deepEqual(addItem([], "  Свой   сертификат "), ["Свой сертификат"]);
  assert.deepEqual(addItem(["А"], "   "), ["А"]);
});

test("списки без повторов; сумма в рублях с пробелами", () => {
  for (const options of [INDUSTRY_OPTIONS, LICENSE_OPTIONS, CERTIFICATE_OPTIONS]) assert.equal(new Set(options).size, options.length);
  assert.equal(rublesText("10000000"), "10 000 000 ₽");
  assert.equal(rublesText(""), "");
});

test("карточка входит в копию данных и читается обратно", () => {
  const card = { v: 1, ...readCard({ industries: ["Экология"] }) };
  const parsed = parseBackup({
    format: "tender-lawyer-backup",
    version: 1,
    savedAt: "2026-11-03T00:00:00.000Z",
    purchases: [],
    documents: [],
    samples: [],
    facts: [],
    settings: [["company-card", card]],
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.dump.settings[0][0], "company-card");
});

test("свой пункт: добавился выбранным; снять выбор — пункт остаётся; крестик — пункт удалён", () => {
  let card = addOwn(EMPTY_CARD, "licenses", "  Своя   лицензия ");
  assert.deepEqual(card.licenses, ["Своя лицензия"]);
  assert.deepEqual(card.custom.licenses, ["Своя лицензия"]);
  assert.equal(addOwn(card, "licenses", "своя лицензия"), card, "повтор не добавляется");
  card = { ...card, licenses: toggleItem(card.licenses, "Своя лицензия") };
  assert.deepEqual(card.licenses, []);
  assert.deepEqual(ownItems(card, "licenses", LICENSE_OPTIONS), ["Своя лицензия"], "после снятия выбора пункт всё ещё на экране");
  assert.deepEqual(ownItems(card, "industries", INDUSTRY_OPTIONS), [], "в другой группе его нет");
  card = removeOwn(card, "licenses", "Своя лицензия");
  assert.deepEqual(ownItems(card, "licenses", LICENSE_OPTIONS), []);
  assert.deepEqual(removeOwn(addOwn(EMPTY_CARD, "permits", "Допуск"), "permits", "Допуск").permits, []);
});

test("свои пункты читаются из браузера без мусора; у старой записи без них — пустые списки", () => {
  assert.deepEqual(readCard({ custom: { licenses: ["А", "А", 5], industries: "строка" } }).custom, { industries: [], licenses: ["А"], permits: [], certificates: [] });
  assert.deepEqual(readCard({ industries: ["Экология"] }).custom, EMPTY_CARD.custom);
});
