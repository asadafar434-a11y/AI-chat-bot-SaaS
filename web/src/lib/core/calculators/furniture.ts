import type { CalculatorDescriptor } from "./types.ts";
import { createDeliveryInstallationCalculator, createStandardCalculators } from "./common.ts";

const SPHERE_KEY = "furniture";
const SUB_SPHERE_KEY = "general";
const SPHERE_LABEL = "Мебель";

export const furnitureCalculator: CalculatorDescriptor = createStandardCalculators(
  { sphereKey: SPHERE_KEY, subSphereKey: SUB_SPHERE_KEY, sphereLabel: SPHERE_LABEL, kind: "goods" },
  [{ section: "logistics", descriptor: createDeliveryInstallationCalculator({ sphereKey: SPHERE_KEY, subSphereKey: SUB_SPHERE_KEY, sphereLabel: SPHERE_LABEL }) }],
);
