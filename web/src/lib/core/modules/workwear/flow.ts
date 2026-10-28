import { createGoodsModule } from "../../common/goods-module.ts";
import { workwearRules } from "./rules.ts";

export const workwearModule = createGoodsModule({
  key: "workwear",
  name: "Спецодежда и СИЗ",
  version: "0.1.0",
  productKind: "workwear",
  productLabel: "спецодежда и СИЗ",
  template: "workwear-application",
  extraFields: [
    "conformityRequired",
    "conformityDocument",
    "sizeRangeRequired",
    "sizeRangeCovered",
    "labelingRequired",
    "labelingConfirmed",
  ],
  extraRules: workwearRules,
  extraChecks: [
    {
      id: "check.conformity",
      ruleId: "workwear.conformity",
      label: "Проверка сертификата или декларации",
      failTo: "reject",
    },
    {
      id: "check.sizing",
      ruleId: "workwear.sizing",
      label: "Проверка размерного ряда",
      failTo: "report",
    },
    {
      id: "check.labeling",
      ruleId: "workwear.labeling",
      label: "Проверка маркировки и упаковки",
      failTo: "report",
    },
  ],
});
