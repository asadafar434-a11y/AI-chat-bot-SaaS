import { trainingCalculator } from "./training.ts";
import { sampleExecutionCostInput, testStandardCalculator } from "./test-helpers.ts";
import { validTrainingInput } from "../modules/training/fixtures.ts";

testStandardCalculator("training", trainingCalculator, validTrainingInput.data, sampleExecutionCostInput);
