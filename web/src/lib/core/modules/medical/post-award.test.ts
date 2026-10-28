import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPostAwardChecklist } from "./post-award.ts";

test("post-award: медизделие — базовые и профильные документы", () => {
  const items = buildPostAwardChecklist({ productKind: "device" });

  assert.deepEqual(
    items.map((item) => item.id),
    ["contract", "invoice", "acceptance", "device-passport", "device-manual"]
  );
});

test("post-award: медизделие — условные документы добавляются по требованиям", () => {
  const items = buildPostAwardChecklist({
    productKind: "device",
    warrantyRequired: true,
    installationRequired: true,
    verificationRequired: true,
    maintenanceRequired: true,
  });

  const ids = items.map((item) => item.id);
  assert.equal(ids.includes("device-warranty"), true);
  assert.equal(ids.includes("device-installation"), true);
  assert.equal(ids.includes("device-verification"), true);
  assert.equal(ids.includes("device-maintenance"), true);
});

test("post-award: лекарство — базовые и профильные документы", () => {
  const items = buildPostAwardChecklist({ productKind: "medicine" });

  assert.deepEqual(
    items.map((item) => item.id),
    ["contract", "invoice", "acceptance", "medicine-registration", "medicine-shelf-life"]
  );
});

test("post-award: лекарство — холодовая цепь и маркировка по требованиям", () => {
  const items = buildPostAwardChecklist({
    productKind: "medicine",
    coldChainRequired: true,
    markingRequired: true,
  });

  const ids = items.map((item) => item.id);
  assert.equal(ids.includes("medicine-cold-chain"), true);
  assert.equal(ids.includes("medicine-marking"), true);
});

test("post-award: выключенные требования не добавляют документы", () => {
  const items = buildPostAwardChecklist({
    productKind: "device",
    warrantyRequired: false,
    installationRequired: false,
    verificationRequired: false,
    maintenanceRequired: false,
  });

  assert.deepEqual(
    items.map((item) => item.id),
    ["contract", "invoice", "acceptance", "device-passport", "device-manual"]
  );
});
