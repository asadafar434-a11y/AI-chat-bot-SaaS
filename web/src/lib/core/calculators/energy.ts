import type { CalculatorDescriptor } from "./types.ts";
import { createExecutionCostCalculator, createStandardCalculators } from "./common.ts";

const SPHERE_KEY = "energy";
const SUB_SPHERE_KEY = "general";
const SPHERE_LABEL = "Энергетика";

export const energyCalculator: CalculatorDescriptor = createStandardCalculators(
  { sphereKey: SPHERE_KEY, subSphereKey: SUB_SPHERE_KEY, sphereLabel: SPHERE_LABEL, kind: "service" },
  [{ section: "executionCost", descriptor: createExecutionCostCalculator({ sphereKey: SPHERE_KEY, subSphereKey: SUB_SPHERE_KEY, sphereLabel: SPHERE_LABEL }) }],
);
