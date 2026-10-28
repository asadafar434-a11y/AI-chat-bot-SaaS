import { createServiceModule } from "../../common/service-module.ts";
import { realEstateRules } from "./rules.ts";

export const realEstateModule = createServiceModule({
  key: "real-estate",
  name: "Недвижимость",
  version: "0.1.0",
  serviceKind: "real_estate",
  serviceLabel: "недвижимость",
  template: "real-estate-application",
  extraFields: [
    "legalStatusRequired",
    "legalStatusConfirmed",
    "cadastreRequired",
    "cadastreConfirmed",
    "technicalRequired",
    "technicalConfirmed",
  ],
  extraRules: realEstateRules,
  extraChecks: [
    {
      id: "check.legal_status",
      ruleId: "real-estate.legal_status",
      label: "Проверка правового статуса",
      failTo: "reject",
    },
    {
      id: "check.cadastre",
      ruleId: "real-estate.cadastre",
      label: "Проверка кадастровых документов",
      failTo: "report",
    },
    {
      id: "check.technical",
      ruleId: "real-estate.technical",
      label: "Проверка технического состояния",
      failTo: "report",
    },
  ],
});
