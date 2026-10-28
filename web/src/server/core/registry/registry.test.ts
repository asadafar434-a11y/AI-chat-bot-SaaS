import assert from "node:assert/strict";
import { test } from "node:test";

import { checkMedicineRegistrationRecord } from "../../../lib/core/modules/medical/medicine-registration.ts";
import { checkRegistryRecord } from "../../../lib/core/modules/medical/registry.ts";
import { RegistryNotConfiguredError } from "../../../lib/core/ports/registry.ts";
import { createDisabledRegistry } from "./disabled.ts";
import { createRegistryPorts } from "./index.ts";
import { createStaticRegistry } from "./static.ts";

test("registry: disabled adapter не ходит в реестр и явно сообщает об этом", async () => {
  const ports = createDisabledRegistry();

  await assert.rejects(
    () => ports.devices.lookup({ registrationNumber: "РЗН 2024/12345" }),
    RegistryNotConfiguredError,
  );
  await assert.rejects(
    () => ports.medicines.lookup({ registrationNumber: "ЛП-000001" }),
    RegistryNotConfiguredError,
  );
});

test("registry: static adapter подтверждает активное медизделие", async () => {
  const ports = createStaticRegistry({
    devices: {
      "РЗН 2024/12345": {
        registrationNumber: "РЗН 2024/12345",
        status: "active",
        model: "Model X",
        manufacturer: "ООО Производитель",
        source: "static",
        checkedAt: "2026-10-27",
      },
    },
  });

  const record = await ports.devices.lookup({ registrationNumber: "рзн 2024/12345" });
  const result = checkRegistryRecord(record, {
    registrationNumber: "РЗН 2024/12345",
    model: "Model X",
    manufacturer: "ООО Производитель",
  });

  assert.equal(result.matched, true);
});

test("registry: static adapter возвращает not_found для неизвестного медизделия", async () => {
  const ports = createStaticRegistry();
  const record = await ports.devices.lookup({ registrationNumber: "РЗН 2024/00000" });
  const result = checkRegistryRecord(record, { registrationNumber: "РЗН 2024/00000" });

  assert.equal(record.status, "not_found");
  assert.equal(result.matched, false);
  assert.deepEqual(result.reasons, ["not_found"]);
});

test("registry: static adapter подтверждает лекарство", async () => {
  const ports = createStaticRegistry({
    medicines: {
      "ЛП-000001": {
        registrationNumber: "ЛП-000001",
        status: "active",
        name: "Препарат",
        form: "таблетки",
        dosage: "10 мг",
        manufacturer: "ООО Фарма",
        source: "static",
        checkedAt: "2026-10-27",
      },
    },
  });

  const record = await ports.medicines.lookup({ registrationNumber: "лп-000001" });
  const result = checkMedicineRegistrationRecord(record, {
    registrationNumber: "ЛП-000001",
    name: "Препарат",
    form: "таблетки",
    dosage: "10 мг",
    manufacturer: "ООО Фарма",
  });

  assert.equal(result.matched, true);
});

test("registry: factory по умолчанию отключён, static пуст, неизвестный провайдер отклоняется", async () => {
  const disabled = await createRegistryPorts("disabled");
  await assert.rejects(
    () => disabled.devices.lookup({ registrationNumber: "РЗН 2024/12345" }),
    RegistryNotConfiguredError,
  );

  const empty = await createRegistryPorts("static");
  const record = await empty.medicines.lookup({ registrationNumber: "ЛП-000001" });
  assert.equal(record.status, "not_found");

  await assert.rejects(() => createRegistryPorts("unknown"), /неизвестный провайдер/);
});
