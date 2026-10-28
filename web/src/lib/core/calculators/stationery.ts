import type { CalculatorDescriptor } from "./types.ts";
import { createDeliveryInstallationCalculator, createStandardCalculators } from "./common.ts";

const SPHERE_KEY = "stationery";
const SUB_SPHERE_KEY = "general";
const SPHERE_LABEL = "Канцтовары";

export const stationeryCalculator: CalculatorDescriptor = createStandardCalculators(
  { sphereKey: SPHERE_KEY, subSphereKey: SUB_SPHERE_KEY, sphereLabel: SPHERE_LABEL, kind: "goods" },
  [{ section: "logistics", descriptor: createDeliveryInstallationCalculator({ sphereKey: SPHERE_KEY, subSphereKey: SUB_SPHERE_KEY, sphereLabel: SPHERE_LABEL }) }],
);
