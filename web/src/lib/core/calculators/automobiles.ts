import type { CalculatorDescriptor } from "./types.ts";
import { createBoundCalculator, createStandardCalculators } from "./common.ts";

const SPHERE_KEY = "automobiles";
const SPHERE_LABEL = "Автомобили";

export const automobilesCalculator: CalculatorDescriptor = createStandardCalculators(
  { sphereKey: SPHERE_KEY, subSphereKey: "general", sphereLabel: SPHERE_LABEL, kind: "goods" },
  [
    {
      section: "vehicleYear",
      descriptor: createBoundCalculator({
        sphereKey: SPHERE_KEY,
        subSphereKey: "general",
        title: "Год выпуска автомобиля",
        description: "Запас по году выпуска против минимально требуемого.",
        ruleId: "automobiles.year",
        boundField: "minYear",
        boundLabel: "Минимальный год выпуска",
        actualField: "vehicleYear",
        actualLabel: "Год выпуска",
        direction: "min",
      }),
    },
    {
      section: "vehicleMileage",
      descriptor: createBoundCalculator({
        sphereKey: SPHERE_KEY,
        subSphereKey: "general",
        title: "Пробег автомобиля",
        description: "Запас по пробегу против максимально допустимого.",
        ruleId: "automobiles.mileage",
        boundField: "maxMileage",
        boundLabel: "Максимальный пробег",
        actualField: "vehicleMileage",
        actualLabel: "Пробег",
        unit: "км",
        direction: "max",
      }),
    },
  ],
);
