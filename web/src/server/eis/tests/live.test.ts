// EIS Collector v1: OPTIONAL live smoke test.
// По умолчанию ВЫКЛЮЧЕН: запуск только при EIS_LIVE_TEST=1.
// Не входит в обычный CI (`npm test` — всегда зелёный без сети).
// Проверяет достижимость официальной XSD СОИ и сверяет UNCONFIRMED-допущения
// (имена методов/токена) с актуальной схемой. Подробности: ../README.md.
import assert from "node:assert/strict";
import { test } from "node:test";

const XSD_URL = "https://int44.zakupki.gov.ru/eis-integration/services/getDocsIP?xsd=getDocsIP-ws-api.xsd";

test("live smoke (optional): официальная XSD СОИ доступна и содержит методы", async () => {
  if (process.env["EIS_LIVE_TEST"] !== "1") {
    console.log("[eis] live smoke пропущен: задайте EIS_LIVE_TEST=1 для проверки против live ЕИС.");
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(XSD_URL, { signal: controller.signal });
    assert.equal(res.status, 200, `XSD endpoint вернул HTTP ${res.status} — сверить endpoint с официальной документацией`);
    const text = await res.text();
    // Сверка UNCONFIRMED-допущений v1 с актуальной схемой (не фейлит жёстко — фиксирует факт):
    const checks: Record<string, boolean> = {
      getDocsByOrgRegionRequest: text.includes("getDocsByOrgRegionRequest"),
      getDocsByReestrNumberRequest: text.includes("getDocsByReestrNumberRequest"),
      individualPerson_token: text.includes("individualPerson_token"),
      documentType44: text.includes("documentType44"),
    };
    console.log(`[eis] live XSD checks: ${JSON.stringify(checks)}`);
    for (const [name, ok] of Object.entries(checks)) {
      if (!ok) console.log(`[eis] live WARNING: в XSD не найдено ${name} — обновить допущения и README.`);
    }
    assert.ok(text.length > 1000, "XSD подозрительно короткая");
  } finally {
    clearTimeout(timer);
  }
});
