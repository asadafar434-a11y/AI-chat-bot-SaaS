import type { FlowModule } from "../flow/types.ts";
import { furnitureModule } from "./furniture/flow.ts";
import { medicalModule } from "./medical/flow.ts";
import { officeModule } from "./office-equipment/flow.ts";

export const coreModules = {
  medical: medicalModule,
  "office-equipment": officeModule,
  furniture: furnitureModule,
} as const;

export type CoreModuleKey = keyof typeof coreModules;

export function findCoreModule(key: string): FlowModule | null {
  if (!Object.prototype.hasOwnProperty.call(coreModules, key)) return null;
  return coreModules[key as CoreModuleKey];
}
