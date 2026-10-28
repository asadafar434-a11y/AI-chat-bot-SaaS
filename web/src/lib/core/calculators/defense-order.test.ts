import { defenseOrderCalculator } from "./defense-order.ts";
import { sampleExecutionCostInput, testStandardCalculator } from "./test-helpers.ts";
import { validDefenseOrderInput } from "../modules/defense-order/fixtures.ts";

testStandardCalculator("defense-order", defenseOrderCalculator, validDefenseOrderInput.data, sampleExecutionCostInput);
