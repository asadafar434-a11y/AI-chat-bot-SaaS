import { withRuleSourceUrls } from "../flow/source-url.ts";
import type { FlowModule } from "../flow/types.ts";
import { automobileModule } from "./automobiles/flow.ts";
import { buildingMaterialsModule } from "./building-materials/flow.ts";
import { constructionModule } from "./construction/flow.ts";
import { defenseOrderModule } from "./defense-order/flow.ts";
import { designSurveysModule } from "./design-surveys/flow.ts";
import { educationalEquipmentModule } from "./educational-equipment/flow.ts";
import { energyModule } from "./energy/flow.ts";
import { eventsModule } from "./events/flow.ts";
import { foodModule } from "./food/flow.ts";
import { furnitureModule } from "./furniture/flow.ts";
import { insuranceModule } from "./insurance/flow.ts";
import { itCommunicationsModule } from "./it-communications/flow.ts";
import { legalServicesModule } from "./legal-services/flow.ts";
import { medicalModule } from "./medical/flow.ts";
import { medicalServicesModule } from "./medical-services/flow.ts";
import { officeModule } from "./office-equipment/flow.ts";
import { realEstateModule } from "./real-estate/flow.ts";
import { scienceResearchModule } from "./science-research/flow.ts";
import { securityCleaningCateringModule } from "./security-cleaning-catering/flow.ts";
import { stationeryModule } from "./stationery/flow.ts";
import { toroModule } from "./toro/flow.ts";
import { trainingModule } from "./training/flow.ts";
import { transportModule } from "./transport/flow.ts";
import { utilitiesModule } from "./utilities/flow.ts";
import { workwearModule } from "./workwear/flow.ts";

export const coreModules = {
  medical: withRuleSourceUrls(medicalModule),
  "office-equipment": withRuleSourceUrls(officeModule),
  furniture: withRuleSourceUrls(furnitureModule),
  stationery: withRuleSourceUrls(stationeryModule),
  workwear: withRuleSourceUrls(workwearModule),
  automobiles: withRuleSourceUrls(automobileModule),
  "building-materials": withRuleSourceUrls(buildingMaterialsModule),
  "educational-equipment": withRuleSourceUrls(educationalEquipmentModule),
  insurance: withRuleSourceUrls(insuranceModule),
  "medical-services": withRuleSourceUrls(medicalServicesModule),
  training: withRuleSourceUrls(trainingModule),
  events: withRuleSourceUrls(eventsModule),
  "legal-services": withRuleSourceUrls(legalServicesModule),
  construction: withRuleSourceUrls(constructionModule),
  energy: withRuleSourceUrls(energyModule),
  transport: withRuleSourceUrls(transportModule),
  utilities: withRuleSourceUrls(utilitiesModule),
  "design-surveys": withRuleSourceUrls(designSurveysModule),
  "real-estate": withRuleSourceUrls(realEstateModule),
  "it-communications": withRuleSourceUrls(itCommunicationsModule),
  "science-research": withRuleSourceUrls(scienceResearchModule),
  "security-cleaning-catering": withRuleSourceUrls(securityCleaningCateringModule),
  toro: withRuleSourceUrls(toroModule),
  "defense-order": withRuleSourceUrls(defenseOrderModule),
  food: withRuleSourceUrls(foodModule),
} as const;

export type CoreModuleKey = keyof typeof coreModules;

export function findCoreModule(key: string): FlowModule | null {
  if (!Object.prototype.hasOwnProperty.call(coreModules, key)) return null;
  return coreModules[key as CoreModuleKey];
}
