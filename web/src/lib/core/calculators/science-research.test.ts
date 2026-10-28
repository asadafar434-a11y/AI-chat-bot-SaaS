import { scienceResearchCalculator } from "./science-research.ts";
import { sampleExecutionCostInput, testStandardCalculator } from "./test-helpers.ts";
import { validScienceResearchInput } from "../modules/science-research/fixtures.ts";

testStandardCalculator("science-research", scienceResearchCalculator, validScienceResearchInput.data, sampleExecutionCostInput);
