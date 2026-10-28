import { createGoodsModule } from "../../common/goods-module.ts";
import { educationalEquipmentRules } from "./rules.ts";

export const educationalEquipmentModule = createGoodsModule({
  key: "educational-equipment",
  name: "Учебное оборудование",
  version: "0.1.0",
  productKind: "educational_equipment",
  productLabel: "учебное оборудование",
  template: "educational-equipment-application",
  extraFields: ["conformityRequired", "conformityDocument", "sanitaryRequired", "sanitaryConclusion"],
  extraRules: educationalEquipmentRules,
  extraChecks: [
    {
      id: "check.conformity",
      ruleId: "educational-equipment.conformity",
      label: "Проверка сертификата или декларации",
      failTo: "reject",
    },
    {
      id: "check.sanitary",
      ruleId: "educational-equipment.sanitary",
      label: "Проверка санитарно-эпидемиологического заключения",
      failTo: "report",
    },
  ],
});
