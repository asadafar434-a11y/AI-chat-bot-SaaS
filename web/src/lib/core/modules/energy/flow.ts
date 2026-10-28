import { createServiceModule } from "../../common/service-module.ts";
import { energyRules } from "./rules.ts";

export const energyModule = createServiceModule({
  key: "energy",
  name: "Энергетика",
  version: "0.1.0",
  serviceKind: "energy",
  serviceLabel: "энергетика",
  template: "energy-application",
  extraFields: ["licenseRequired", "licenseConfirmed", "tariffRequired", "tariffConfirmed", "connectionRequired", "connectionConfirmed"],
  extraRules: energyRules,
  extraChecks: [
    {
      id: "check.license",
      ruleId: "energy.license",
      label: "Проверка лицензии поставщика",
      failTo: "reject",
    },
    {
      id: "check.tariff",
      ruleId: "energy.tariff",
      label: "Проверка тарифа",
      failTo: "report",
    },
    {
      id: "check.connection",
      ruleId: "energy.connection",
      label: "Проверка технологического присоединения",
      failTo: "report",
    },
  ],
});
