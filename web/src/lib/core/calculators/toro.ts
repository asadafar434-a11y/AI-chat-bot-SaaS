import type { CalculatorDescriptor } from "./types.ts";
import { createExecutionCostCalculator, createStandardCalculators } from "./common.ts";

const SPHERE_KEY = "toro";
const SUB_SPHERE_KEY = "general";
const SPHERE_LABEL = "ТОРО";

export const toroCalculator: CalculatorDescriptor = createStandardCalculators(
  { sphereKey: SPHERE_KEY, subSphereKey: SUB_SPHERE_KEY, sphereLabel: SPHERE_LABEL, kind: "service" },
  [{ section: "executionCost", descriptor: createExecutionCostCalculator({ sphereKey: SPHERE_KEY, subSphereKey: SUB_SPHERE_KEY, sphereLabel: SPHERE_LABEL }) }],
);
