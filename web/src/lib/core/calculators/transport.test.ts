import { transportCalculator } from "./transport.ts";
import { sampleExecutionCostInput, testStandardCalculator } from "./test-helpers.ts";
import { validTransportInput } from "../modules/transport/fixtures.ts";

testStandardCalculator("transport", transportCalculator, validTransportInput.data, sampleExecutionCostInput);
