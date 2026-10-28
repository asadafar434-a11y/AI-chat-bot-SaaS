import { createServiceModule } from "../../common/service-module.ts";
import { trainingRules } from "./rules.ts";

export const trainingModule = createServiceModule({
  key: "training",
  name: "Обучение",
  version: "0.1.0",
  serviceKind: "training",
  serviceLabel: "обучение",
  template: "training-application",
  extraFields: [
    "licenseRequired",
    "licenseConfirmed",
    "programRequired",
    "programConfirmed",
    "teachersRequired",
    "teachersConfirmed",
  ],
  extraRules: trainingRules,
  extraChecks: [
    {
      id: "check.license",
      ruleId: "training.license",
      label: "Проверка лицензии",
      failTo: "reject",
    },
    {
      id: "check.program",
      ruleId: "training.program",
      label: "Проверка программы обучения",
      failTo: "report",
    },
    {
      id: "check.teachers",
      ruleId: "training.teachers",
      label: "Проверка квалификации преподавателей",
      failTo: "report",
    },
  ],
});
