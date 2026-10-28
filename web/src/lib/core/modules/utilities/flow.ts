import { createServiceModule } from "../../common/service-module.ts";
import { utilitiesRules } from "./rules.ts";

export const utilitiesModule = createServiceModule({
  key: "utilities",
  name: "Коммунальные услуги",
  version: "0.1.0",
  serviceKind: "utilities",
  serviceLabel: "коммунальные услуги",
  template: "utilities-application",
  extraFields: ["providerRequired", "providerConfirmed", "tariffRequired", "tariffConfirmed", "slaRequired", "slaConfirmed"],
  extraRules: utilitiesRules,
  extraChecks: [
    {
      id: "check.provider",
      ruleId: "utilities.provider",
      label: "Проверка статуса поставщика",
      failTo: "reject",
    },
    {
      id: "check.tariff",
      ruleId: "utilities.tariff",
      label: "Проверка тарифа",
      failTo: "report",
    },
    {
      id: "check.sla",
      ruleId: "utilities.sla",
      label: "Проверка качества и SLA",
      failTo: "report",
    },
  ],
});
