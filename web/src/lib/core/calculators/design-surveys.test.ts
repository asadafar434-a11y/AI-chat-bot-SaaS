import { designSurveysCalculator } from "./design-surveys.ts";
import { sampleExecutionCostInput, testStandardCalculator } from "./test-helpers.ts";
import { validDesignSurveysInput } from "../modules/design-surveys/fixtures.ts";

testStandardCalculator("design-surveys", designSurveysCalculator, validDesignSurveysInput.data, sampleExecutionCostInput);
