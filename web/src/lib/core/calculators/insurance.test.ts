import { insuranceCalculator } from "./insurance.ts";
import { sampleExecutionCostInput, testStandardCalculator } from "./test-helpers.ts";
import { validInsuranceInput } from "../modules/insurance/fixtures.ts";

testStandardCalculator("insurance", insuranceCalculator, validInsuranceInput.data, sampleExecutionCostInput);
