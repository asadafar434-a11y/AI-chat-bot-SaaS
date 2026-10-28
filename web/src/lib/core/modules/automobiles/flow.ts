import { createGoodsModule } from "../../common/goods-module.ts";
import { automobileRules } from "./rules.ts";

export const automobileModule = createGoodsModule({
  key: "automobiles",
  name: "Автомобили",
  version: "0.1.0",
  productKind: "automobile",
  productLabel: "автомобили",
  template: "automobile-application",
  extraFields: [
    "vinRequired",
    "vinConfirmed",
    "minYear",
    "vehicleYear",
    "maxMileage",
    "vehicleMileage",
    "legalStatusRequired",
    "legalStatusConfirmed",
  ],
  extraRules: automobileRules,
  extraChecks: [
    {
      id: "check.vin",
      ruleId: "automobiles.vin",
      label: "Проверка VIN",
      failTo: "reject",
    },
    {
      id: "check.year",
      ruleId: "automobiles.year",
      label: "Проверка года выпуска",
      failTo: "report",
    },
    {
      id: "check.mileage",
      ruleId: "automobiles.mileage",
      label: "Проверка пробега",
      failTo: "report",
    },
    {
      id: "check.legal_status",
      ruleId: "automobiles.legal_status",
      label: "Проверка правового статуса",
      failTo: "reject",
    },
  ],
});
