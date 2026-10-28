import { createServiceModule } from "../../common/service-module.ts";
import { toroRules } from "./rules.ts";

export const toroModule = createServiceModule({
  key: "toro",
  name: "ТОРО",
  version: "0.1.0",
  serviceKind: "toro",
  serviceLabel: "ТОРО",
  template: "toro-application",
  extraFields: [
    "authorizationRequired",
    "authorizationConfirmed",
    "sparePartsRequired",
    "sparePartsConfirmed",
    "slaRequired",
    "slaConfirmed",
  ],
  extraRules: toroRules,
  extraChecks: [
    {
      id: "check.authorization",
      ruleId: "toro.authorization",
      label: "Проверка авторизации",
      failTo: "report",
    },
    {
      id: "check.spare_parts",
      ruleId: "toro.spare_parts",
      label: "Проверка запасных частей",
      failTo: "report",
    },
    {
      id: "check.sla",
      ruleId: "toro.sla",
      label: "Проверка SLA",
      failTo: "report",
    },
  ],
});
