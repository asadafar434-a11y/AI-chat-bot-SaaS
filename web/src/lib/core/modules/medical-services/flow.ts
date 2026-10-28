import { createServiceModule } from "../../common/service-module.ts";
import { medicalServicesRules } from "./rules.ts";

export const medicalServicesModule = createServiceModule({
  key: "medical-services",
  name: "Медицинские услуги",
  version: "0.1.0",
  serviceKind: "medical_services",
  serviceLabel: "медицинские услуги",
  template: "medical-services-application",
  extraFields: [
    "licenseRequired",
    "licenseConfirmed",
    "staffRequired",
    "staffConfirmed",
    "sanitaryRequired",
    "sanitaryConfirmed",
  ],
  extraRules: medicalServicesRules,
  extraChecks: [
    {
      id: "check.license",
      ruleId: "medical-services.license",
      label: "Проверка лицензии",
      failTo: "reject",
    },
    {
      id: "check.staff",
      ruleId: "medical-services.staff",
      label: "Проверка квалификации персонала",
      failTo: "report",
    },
    {
      id: "check.sanitary",
      ruleId: "medical-services.sanitary",
      label: "Проверка санитарных требований",
      failTo: "report",
    },
  ],
});
