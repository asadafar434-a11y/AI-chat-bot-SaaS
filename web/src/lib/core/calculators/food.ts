import type { CalculatorDescriptor } from "./types.ts";
import { createBoundCalculator, createDeliveryInstallationCalculator, createStandardCalculators } from "./common.ts";

const SPHERE_KEY = "food";
const SPHERE_LABEL = "Продукты питания";

export const foodCalculator: CalculatorDescriptor = createStandardCalculators(
  { sphereKey: SPHERE_KEY, subSphereKey: "general", sphereLabel: SPHERE_LABEL, kind: "goods" },
  [
    {
      section: "shelfLife",
      descriptor: createBoundCalculator({
        sphereKey: SPHERE_KEY,
        subSphereKey: "general",
        title: "Остаточный срок годности продукта",
        description: "Запас по остаточному сроку годности против требуемого.",
        ruleId: "food.shelf_life",
        boundField: "shelfLifeRequiredDays",
        boundLabel: "Требуемый остаточный срок",
        actualField: "offeredShelfLifeDays",
        actualLabel: "Остаточный срок",
        unit: "дн.",
        direction: "min",
      }),
    },
    {
      section: "logistics",
      descriptor: createDeliveryInstallationCalculator({ sphereKey: SPHERE_KEY, subSphereKey: "general", sphereLabel: SPHERE_LABEL }),
    },
  ],
);
