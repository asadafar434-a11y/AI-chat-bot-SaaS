import { toroCalculator } from "./toro.ts";
import { sampleExecutionCostInput, testStandardCalculator } from "./test-helpers.ts";
import { validToroInput } from "../modules/toro/fixtures.ts";

testStandardCalculator("toro", toroCalculator, validToroInput.data, sampleExecutionCostInput);
