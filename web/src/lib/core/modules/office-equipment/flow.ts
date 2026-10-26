import { createGoodsModule } from "../../common/goods-module.ts";

export const officeModule = createGoodsModule({
  key: "office-equipment",
  name: "Оргтехника",
  version: "0.2.0",
  productKind: "office_equipment",
  productLabel: "оргтехника",
  template: "office-application",
});
