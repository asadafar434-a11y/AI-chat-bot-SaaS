import { itCommunicationsCalculator } from "./it-communications.ts";
import { sampleExecutionCostInput, testStandardCalculator } from "./test-helpers.ts";
import { validItCommunicationsInput } from "../modules/it-communications/fixtures.ts";

testStandardCalculator("it-communications", itCommunicationsCalculator, validItCommunicationsInput.data, sampleExecutionCostInput);
