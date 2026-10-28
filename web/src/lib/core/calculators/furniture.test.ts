import { furnitureCalculator } from "./furniture.ts";
import { sampleLogisticsInput, testStandardCalculator } from "./test-helpers.ts";
import { validFurnitureInput } from "../modules/furniture/fixtures.ts";

testStandardCalculator("furniture", furnitureCalculator, validFurnitureInput.data, sampleLogisticsInput);
