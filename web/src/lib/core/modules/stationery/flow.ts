import { createGoodsModule } from "../../common/goods-module.ts";

export const stationeryModule = createGoodsModule({
  key: "stationery",
  name: "Канцтовары",
  version: "0.1.0",
  productKind: "stationery",
  productLabel: "канцтовары",
  template: "stationery-application",
});
