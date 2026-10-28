import { createServiceModule } from "../../common/service-module.ts";
import { securityCleaningCateringRules } from "./rules.ts";

export const securityCleaningCateringModule = createServiceModule({
  key: "security-cleaning-catering",
  name: "Охрана, уборка, питание",
  version: "0.1.0",
  serviceKind: "security_cleaning_catering",
  serviceLabel: "охрана, уборка и питание",
  template: "security-cleaning-catering-application",
  extraFields: [
    "securityLicenseRequired",
    "securityLicenseConfirmed",
    "staffRequired",
    "staffConfirmed",
    "foodSafetyRequired",
    "foodSafetyConfirmed",
  ],
  extraRules: securityCleaningCateringRules,
  extraChecks: [
    {
      id: "check.security_license",
      ruleId: "security-cleaning-catering.security_license",
      label: "Проверка лицензии на охрану",
      failTo: "reject",
    },
    {
      id: "check.staff",
      ruleId: "security-cleaning-catering.staff",
      label: "Проверка персонала",
      failTo: "report",
    },
    {
      id: "check.food_safety",
      ruleId: "security-cleaning-catering.food_safety",
      label: "Проверка безопасности питания",
      failTo: "report",
    },
  ],
});
