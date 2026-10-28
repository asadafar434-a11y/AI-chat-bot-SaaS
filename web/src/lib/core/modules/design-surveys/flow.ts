import { createServiceModule } from "../../common/service-module.ts";
import { designSurveysRules } from "./rules.ts";

export const designSurveysModule = createServiceModule({
  key: "design-surveys",
  name: "Проектирование и изыскания",
  version: "0.1.0",
  serviceKind: "design_surveys",
  serviceLabel: "проектирование и изыскания",
  template: "design-surveys-application",
  extraFields: [
    "sroRequired",
    "sroConfirmed",
    "projectExperienceRequired",
    "projectExperienceConfirmed",
    "approvalsRequired",
    "approvalsConfirmed",
  ],
  extraRules: designSurveysRules,
  extraChecks: [
    {
      id: "check.sro",
      ruleId: "design-surveys.sro",
      label: "Проверка членства в СРО",
      failTo: "reject",
    },
    {
      id: "check.project_experience",
      ruleId: "design-surveys.project_experience",
      label: "Проверка опыта проектов",
      failTo: "report",
    },
    {
      id: "check.approvals",
      ruleId: "design-surveys.approvals",
      label: "Проверка согласований",
      failTo: "report",
    },
  ],
});
