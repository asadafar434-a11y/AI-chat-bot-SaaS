import { createServiceModule } from "../../common/service-module.ts";
import { transportRules } from "./rules.ts";

export const transportModule = createServiceModule({
  key: "transport",
  name: "Транспортные услуги",
  version: "0.1.0",
  serviceKind: "transport",
  serviceLabel: "транспортные услуги",
  template: "transport-application",
  extraFields: ["licenseRequired", "licenseConfirmed", "fleetRequired", "fleetConfirmed", "insuranceRequired", "insuranceConfirmed"],
  extraRules: transportRules,
  extraChecks: [
    {
      id: "check.license",
      ruleId: "transport.license",
      label: "Проверка лицензии на перевозки",
      failTo: "reject",
    },
    {
      id: "check.fleet",
      ruleId: "transport.fleet",
      label: "Проверка наличия транспорта",
      failTo: "report",
    },
    {
      id: "check.insurance",
      ruleId: "transport.insurance",
      label: "Проверка страхования перевозок",
      failTo: "report",
    },
  ],
});
