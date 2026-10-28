import { utilitiesCalculator } from "./utilities.ts";
import { sampleExecutionCostInput, testStandardCalculator } from "./test-helpers.ts";
import { validUtilitiesInput } from "../modules/utilities/fixtures.ts";

testStandardCalculator("utilities", utilitiesCalculator, validUtilitiesInput.data, sampleExecutionCostInput);
