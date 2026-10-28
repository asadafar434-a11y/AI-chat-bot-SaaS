import { createServiceModule } from "../../common/service-module.ts";
import { insuranceRules } from "./rules.ts";

export const insuranceModule = createServiceModule({
  key: "insurance",
  name: "Страхование",
  version: "0.1.0",
  serviceKind: "insurance",
  serviceLabel: "страхование",
  template: "insurance-application",
  extraFields: [
    "licenseRequired",
    "licenseConfirmed",
    "insuranceRulesRequired",
    "insuranceRulesConfirmed",
    "reinsuranceRequired",
    "reinsuranceConfirmed",
  ],
  extraRules: insuranceRules,
  extraChecks: [
    {
      id: "check.license",
      ruleId: "insurance.license",
      label: "Проверка лицензии страховщика",
      failTo: "reject",
    },
    {
      id: "check.insurance_rules",
      ruleId: "insurance.rules",
      label: "Проверка правил страхования",
      failTo: "report",
    },
    {
      id: "check.reinsurance",
      ruleId: "insurance.reinsurance",
      label: "Проверка перестрахования",
      failTo: "report",
    },
  ],
});
