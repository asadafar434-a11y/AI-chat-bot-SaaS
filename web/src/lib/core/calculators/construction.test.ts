import { constructionCalculator } from "./construction.ts";
import { sampleExecutionCostInput, testStandardCalculator } from "./test-helpers.ts";
import { validConstructionInput } from "../modules/construction/fixtures.ts";

testStandardCalculator("construction", constructionCalculator, validConstructionInput.data, sampleExecutionCostInput);
