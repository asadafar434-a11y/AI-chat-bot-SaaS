import { buildingMaterialsCalculator } from "./building-materials.ts";
import { sampleLogisticsInput, testStandardCalculator } from "./test-helpers.ts";
import { validBuildingMaterialsInput } from "../modules/building-materials/fixtures.ts";

testStandardCalculator("building-materials", buildingMaterialsCalculator, validBuildingMaterialsInput.data, sampleLogisticsInput);
