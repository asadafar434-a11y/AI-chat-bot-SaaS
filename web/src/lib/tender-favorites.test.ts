import assert from "node:assert/strict";
import { test } from "node:test";
import { isFavorite, normalizeFavorites, toggleFavorite, type Favorite } from "@/lib/tender-favorites";
import type { TenderListing } from "@/lib/tender-search";

const listing = (id: string, title = `Закупка ${id}`): TenderListing => ({ id, law: "44-ФЗ", title, customer: "ГКУ «Дирекция»", price: 1000, publishedAt: "2026-11-01", deadline: "2026-11-20", region: "Москва", method: null, url: null });

test("сердечко: закупки нет в избранном — добавляется сверху с временем отметки, есть — убирается", () => {
  const a = toggleFavorite([], listing("1"), "2026-11-07T10:00:00.000Z");
  assert.deepEqual(a.map((f) => f.listing.id), ["1"]);
  const b = toggleFavorite(a, listing("2"), "2026-11-07T11:00:00.000Z");
  assert.deepEqual(b.map((f) => f.listing.id), ["2", "1"], "новая отметка — сверху");
  assert.equal(isFavorite(b, "1"), true);
  const c = toggleFavorite(b, listing("1"), "2026-11-07T12:00:00.000Z");
  assert.deepEqual(c.map((f) => f.listing.id), ["2"]);
  assert.equal(isFavorite(c, "1"), false);
});

test("из хранилища: испорченные записи пропускаются, повторы схлопываются, порядок — по времени отметки, новые сверху", () => {
  const raw = {
    items: [
      { listing: listing("1"), addedAt: "2026-11-01T10:00:00.000Z" },
      { listing: { title: "без номера" }, addedAt: "2026-11-02T10:00:00.000Z" },
      null,
      { listing: listing("2"), addedAt: "2026-11-03T10:00:00.000Z" },
      { listing: listing("1", "повтор"), addedAt: "2026-11-04T10:00:00.000Z" },
      { listing: listing("3"), addedAt: 5 },
    ],
  };
  const out: Favorite[] = normalizeFavorites(raw);
  assert.deepEqual(out.map((f) => f.listing.id), ["2", "1", "3"]);
  assert.equal(out[1].listing.title, "Закупка 1", "из повторов остаётся первая запись");
  assert.equal(out[2].addedAt, "", "время отметки не число — пустое, а не поломка");
  assert.deepEqual(normalizeFavorites(undefined), []);
  assert.deepEqual(normalizeFavorites({ items: "не список" }), []);
});
