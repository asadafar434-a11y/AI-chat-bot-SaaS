import { createGoodsModule } from "../../common/goods-module.ts";

export const furnitureModule = createGoodsModule({
  key: "furniture",
  name: "Мебель",
  version: "0.1.0",
  productKind: "furniture",
  productLabel: "мебель",
  template: "furniture-application",
});
