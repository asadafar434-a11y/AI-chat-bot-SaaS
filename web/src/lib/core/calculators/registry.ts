import type { CalculatorDescriptor } from "./types.ts";
import { automobilesCalculator } from "./automobiles.ts";
import { buildingMaterialsCalculator } from "./building-materials.ts";
import { constructionCalculator } from "./construction.ts";
import { defenseOrderCalculator } from "./defense-order.ts";
import { designSurveysCalculator } from "./design-surveys.ts";
import { educationalEquipmentCalculator } from "./educational-equipment.ts";
import { energyCalculator } from "./energy.ts";
import { eventsCalculator } from "./events.ts";
import { foodCalculator } from "./food.ts";
import { furnitureCalculator } from "./furniture.ts";
import { insuranceCalculator } from "./insurance.ts";
import { itCommunicationsCalculator } from "./it-communications.ts";
import { legalServicesCalculator } from "./legal-services.ts";
import { medicalDeviceCalculator, medicalMedicineCalculator } from "./medical.ts";
import { medicalServicesCalculator } from "./medical-services.ts";
import { officeEquipmentCalculator } from "./office-equipment.ts";
import { realEstateCalculator } from "./real-estate.ts";
import { scienceResearchCalculator } from "./science-research.ts";
import { securityCleaningCateringCalculator } from "./security-cleaning-catering.ts";
import { stationeryCalculator } from "./stationery.ts";
import { toroCalculator } from "./toro.ts";
import { trainingCalculator } from "./training.ts";
import { transportCalculator } from "./transport.ts";
import { utilitiesCalculator } from "./utilities.ts";
import { workwearCalculator } from "./workwear.ts";

/**
 * Один калькулятор на пару «сфера + под-сфера» — ровно то, что выбирают CLI
 * (`core:calc -- --sphere --subsphere`) и экран `/core`. У 24 сфер без явного
 * разделения под-сфера называется "general"; у `medical` — "device" и "medicine".
 */
export const calculatorsBySphere: Record<string, CalculatorDescriptor[]> = {
  medical: [medicalDeviceCalculator, medicalMedicineCalculator],
  "office-equipment": [officeEquipmentCalculator],
  furniture: [furnitureCalculator],
  stationery: [stationeryCalculator],
  workwear: [workwearCalculator],
  automobiles: [automobilesCalculator],
  "building-materials": [buildingMaterialsCalculator],
  "educational-equipment": [educationalEquipmentCalculator],
  insurance: [insuranceCalculator],
  "medical-services": [medicalServicesCalculator],
  training: [trainingCalculator],
  events: [eventsCalculator],
  "legal-services": [legalServicesCalculator],
  construction: [constructionCalculator],
  energy: [energyCalculator],
  transport: [transportCalculator],
  utilities: [utilitiesCalculator],
  "design-surveys": [designSurveysCalculator],
  "real-estate": [realEstateCalculator],
  "it-communications": [itCommunicationsCalculator],
  "science-research": [scienceResearchCalculator],
  "security-cleaning-catering": [securityCleaningCateringCalculator],
  toro: [toroCalculator],
  "defense-order": [defenseOrderCalculator],
  food: [foodCalculator],
};

export const calculators: CalculatorDescriptor[] = Object.values(calculatorsBySphere).flat();

export function listCalculators(): { sphereKey: string; subSphereKey: string; title: string }[] {
  return calculators.map(({ sphereKey, subSphereKey, title }) => ({ sphereKey, subSphereKey, title }));
}

export function findCalculator(sphereKey: string, subSphereKey: string): CalculatorDescriptor | undefined {
  return calculators.find((descriptor) => descriptor.sphereKey === sphereKey && descriptor.subSphereKey === subSphereKey);
}

export function findCalculatorsBySphere(sphereKey: string): CalculatorDescriptor[] {
  return calculatorsBySphere[sphereKey] ?? [];
}
