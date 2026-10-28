import { educationalEquipmentCalculator } from "./educational-equipment.ts";
import { sampleLogisticsInput, testStandardCalculator } from "./test-helpers.ts";
import { validEducationalEquipmentInput } from "../modules/educational-equipment/fixtures.ts";

testStandardCalculator("educational-equipment", educationalEquipmentCalculator, validEducationalEquipmentInput.data, sampleLogisticsInput);
