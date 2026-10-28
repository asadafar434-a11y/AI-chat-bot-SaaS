import { createServiceModule } from "../../common/service-module.ts";
import { itCommunicationsRules } from "./rules.ts";

export const itCommunicationsModule = createServiceModule({
  key: "it-communications",
  name: "ИТ и связь",
  version: "0.1.0",
  serviceKind: "it_communications",
  serviceLabel: "ИТ и связь",
  template: "it-communications-application",
  extraFields: ["licenseRequired", "licenseConfirmed", "slaRequired", "slaConfirmed", "securityRequired", "securityConfirmed"],
  extraRules: itCommunicationsRules,
  extraChecks: [
    {
      id: "check.license",
      ruleId: "it-communications.license",
      label: "Проверка лицензии оператора связи",
      failTo: "reject",
    },
    {
      id: "check.sla",
      ruleId: "it-communications.sla",
      label: "Проверка SLA",
      failTo: "report",
    },
    {
      id: "check.security",
      ruleId: "it-communications.security",
      label: "Проверка защиты информации",
      failTo: "report",
    },
  ],
});
