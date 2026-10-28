import { workwearCalculator } from "./workwear.ts";
import { sampleLogisticsInput, testStandardCalculator } from "./test-helpers.ts";
import { validWorkwearInput } from "../modules/workwear/fixtures.ts";

testStandardCalculator("workwear", workwearCalculator, validWorkwearInput.data, sampleLogisticsInput);
