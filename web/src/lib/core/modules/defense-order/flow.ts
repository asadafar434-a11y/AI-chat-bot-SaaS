import { createServiceModule } from "../../common/service-module.ts";
import { defenseOrderRules } from "./rules.ts";

export const defenseOrderModule = createServiceModule({
  key: "defense-order",
  name: "ГОЗ",
  version: "0.1.0",
  serviceKind: "defense_order",
  serviceLabel: "ГОЗ",
  template: "defense-order-application",
  extraFields: [
    "licenseRequired",
    "licenseConfirmed",
    "secrecyRequired",
    "secrecyConfirmed",
    "separateAccountingRequired",
    "separateAccountingConfirmed",
  ],
  extraRules: defenseOrderRules,
  extraChecks: [
    {
      id: "check.license",
      ruleId: "defense-order.license",
      label: "Проверка лицензии на ГОЗ",
      failTo: "reject",
    },
    {
      id: "check.secrecy",
      ruleId: "defense-order.secrecy",
      label: "Проверка допуска к секретным сведениям",
      failTo: "reject",
    },
    {
      id: "check.separate_accounting",
      ruleId: "defense-order.separate_accounting",
      label: "Проверка раздельного учёта",
      failTo: "report",
    },
  ],
});
