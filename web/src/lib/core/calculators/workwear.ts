import type { CalculatorDescriptor } from "./types.ts";
import { createDeliveryInstallationCalculator, createStandardCalculators } from "./common.ts";

const SPHERE_KEY = "workwear";
const SUB_SPHERE_KEY = "general";
const SPHERE_LABEL = "Спецодежда и СИЗ";

export const workwearCalculator: CalculatorDescriptor = createStandardCalculators(
  { sphereKey: SPHERE_KEY, subSphereKey: SUB_SPHERE_KEY, sphereLabel: SPHERE_LABEL, kind: "goods" },
  [{ section: "logistics", descriptor: createDeliveryInstallationCalculator({ sphereKey: SPHERE_KEY, subSphereKey: SUB_SPHERE_KEY, sphereLabel: SPHERE_LABEL }) }],
);
