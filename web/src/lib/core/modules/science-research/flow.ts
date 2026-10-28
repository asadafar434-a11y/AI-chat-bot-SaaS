import { createServiceModule } from "../../common/service-module.ts";
import { scienceResearchRules } from "./rules.ts";

export const scienceResearchModule = createServiceModule({
  key: "science-research",
  name: "Наука и НИОКР",
  version: "0.1.0",
  serviceKind: "science_research",
  serviceLabel: "наука и НИОКР",
  template: "science-research-application",
  extraFields: [
    "qualificationRequired",
    "qualificationConfirmed",
    "methodologyRequired",
    "methodologyConfirmed",
    "ipRequired",
    "ipConfirmed",
  ],
  extraRules: scienceResearchRules,
  extraChecks: [
    {
      id: "check.qualification",
      ruleId: "science-research.qualification",
      label: "Проверка научной квалификации",
      failTo: "report",
    },
    {
      id: "check.methodology",
      ruleId: "science-research.methodology",
      label: "Проверка методики",
      failTo: "report",
    },
    {
      id: "check.ip",
      ruleId: "science-research.ip",
      label: "Проверка прав на результаты",
      failTo: "report",
    },
  ],
});
