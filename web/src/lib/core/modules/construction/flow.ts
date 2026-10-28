import { createServiceModule } from "../../common/service-module.ts";
import { constructionRules } from "./rules.ts";

export const constructionModule = createServiceModule({
  key: "construction",
  name: "Строительные работы",
  version: "0.1.0",
  serviceKind: "construction",
  serviceLabel: "строительные работы",
  template: "construction-application",
  extraFields: ["sroRequired", "sroConfirmed", "permitsRequired", "permitsConfirmed", "safetyRequired", "safetyConfirmed"],
  extraRules: constructionRules,
  extraChecks: [
    {
      id: "check.sro",
      ruleId: "construction.sro",
      label: "Проверка членства в СРО",
      failTo: "reject",
    },
    {
      id: "check.permits",
      ruleId: "construction.permits",
      label: "Проверка разрешений и согласований",
      failTo: "report",
    },
    {
      id: "check.safety",
      ruleId: "construction.safety",
      label: "Проверка плана безопасности",
      failTo: "report",
    },
  ],
});
