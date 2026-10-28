import { createGoodsModule } from "../../common/goods-module.ts";
import { foodRules } from "./rules.ts";

export const foodModule = createGoodsModule({
  key: "food",
  name: "Продукты питания",
  version: "0.1.0",
  productKind: "food",
  productLabel: "продукты питания",
  template: "food-application",
  extraFields: [
    "conformityRequired",
    "conformityDocument",
    "shelfLifeRequiredDays",
    "offeredShelfLifeDays",
    "storageRequired",
    "storageConfirmed",
    "veterinaryRequired",
    "veterinaryConfirmed",
  ],
  extraRules: foodRules,
  extraChecks: [
    {
      id: "check.conformity",
      ruleId: "food.conformity",
      label: "Проверка соответствия",
      failTo: "reject",
    },
    {
      id: "check.shelf_life",
      ruleId: "food.shelf_life",
      label: "Проверка срока годности",
      failTo: "report",
    },
    {
      id: "check.storage",
      ruleId: "food.storage",
      label: "Проверка условий хранения",
      failTo: "report",
    },
    {
      id: "check.veterinary",
      ruleId: "food.veterinary",
      label: "Проверка ветеринарных документов",
      failTo: "report",
    },
  ],
});
