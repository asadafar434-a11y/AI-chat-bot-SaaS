import { createGoodsModule } from "../../common/goods-module.ts";
import { buildingMaterialsRules } from "./rules.ts";

export const buildingMaterialsModule = createGoodsModule({
  key: "building-materials",
  name: "Стройматериалы",
  version: "0.1.0",
  productKind: "building_materials",
  productLabel: "стройматериалы",
  template: "building-materials-application",
  extraFields: ["conformityRequired", "conformityDocument", "batchPassportRequired", "batchPassport"],
  extraRules: buildingMaterialsRules,
  extraChecks: [
    {
      id: "check.conformity",
      ruleId: "building-materials.conformity",
      label: "Проверка сертификата или декларации",
      failTo: "reject",
    },
    {
      id: "check.batch",
      ruleId: "building-materials.batch",
      label: "Проверка паспорта партии",
      failTo: "report",
    },
  ],
});
