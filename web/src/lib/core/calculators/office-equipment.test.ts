import { officeEquipmentCalculator } from "./office-equipment.ts";
import { sampleLogisticsInput, testStandardCalculator } from "./test-helpers.ts";
import { validOfficeInput } from "../modules/office-equipment/fixtures.ts";

testStandardCalculator("office-equipment", officeEquipmentCalculator, validOfficeInput.data, sampleLogisticsInput);
