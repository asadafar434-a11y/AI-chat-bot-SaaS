import { createServiceModule } from "../../common/service-module.ts";
import { legalServicesRules } from "./rules.ts";

export const legalServicesModule = createServiceModule({
  key: "legal-services",
  name: "Юридические услуги и аудит",
  version: "0.1.0",
  serviceKind: "legal_services",
  serviceLabel: "юридические услуги и аудит",
  template: "legal-services-application",
  extraFields: [
    "membershipRequired",
    "membershipConfirmed",
    "industryExperienceRequired",
    "industryExperienceConfirmed",
    "conflictCheckRequired",
    "conflictCheckConfirmed",
  ],
  extraRules: legalServicesRules,
  extraChecks: [
    {
      id: "check.membership",
      ruleId: "legal-services.membership",
      label: "Проверка членства в СРО или палате",
      failTo: "reject",
    },
    {
      id: "check.industry_experience",
      ruleId: "legal-services.industry_experience",
      label: "Проверка отраслевого опыта",
      failTo: "report",
    },
    {
      id: "check.conflicts",
      ruleId: "legal-services.conflicts",
      label: "Проверка конфликта интересов",
      failTo: "report",
    },
  ],
});
