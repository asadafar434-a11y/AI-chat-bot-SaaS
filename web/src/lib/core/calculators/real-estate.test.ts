import { realEstateCalculator } from "./real-estate.ts";
import { sampleExecutionCostInput, testStandardCalculator } from "./test-helpers.ts";
import { validRealEstateInput } from "../modules/real-estate/fixtures.ts";

testStandardCalculator("real-estate", realEstateCalculator, validRealEstateInput.data, sampleExecutionCostInput);
